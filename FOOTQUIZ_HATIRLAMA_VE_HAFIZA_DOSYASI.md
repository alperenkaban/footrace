# FOOTQUIZ — PROJE HAFIZA VE HATIRLAMA DOSYASI (CHECKPOINT)

> **Asistan:** Nova  
> **Tarih:** 26 Ekim 2026  
> **Konum:** Kök Dizin (`c:\Users\Alperen\Desktop\Footrace\FOOTQUIZ_HATIRLAMA_VE_HAFIZA_DOSYASI.md`)  
> **Bağlı Mimari Rapor:** `c:\Users\Alperen\Desktop\Footrace\FOOTQUIZ_MIMARI_VE_PROJE_RAPORU.txt`  
> **Mevcut Sürüm Durumu:** Sürüm 1.5.0 — Google Play & App Store IAP, Kademeli Bütçe Lobileri (500 Giriş / 4500 Ödül), Canlı Testler ve Vercel Güncellemesi

---

## 1. Proje Kimliği ve Temel Vizyon

FootQuiz, futbol tutkunlarının canlı (real-time) bilgi yarışmalarında yarıştığı, çok oyunculu, mikro-bahis (entry fee ve ödül potu) mekaniğine sahip, Elo/RP rating ve liderlik tablosu barındıran WebSocket tabanlı bir web platformudur.

- **Frontend:** Next.js 16 (App Router), React 19, TailwindCSS v4, Zustand, Socket.io-client
- **Backend:** NestJS 12, Socket.io, Prisma ORM 5.22, ioredis 6
- **Veritabanı & Önbellek:** PostgreSQL 15 (Docker: `localhost:5433`), Redis 7 (Docker: `localhost:6379`)

---

## 2. Kritik Ekonomi ve Mimari Değişmezleri (Invariants)

Bu değişmezler asla ihlal edilemez ve her geliştirmede korunmalıdır:

1. **MatchHold Yaşam Döngüsü:**
   - Kullanıcı kuyruğa girerken `holdEntryFee` ile bakiye düşülür, `heldBalance` artırılır ve durum `HELD` olur.
   - Hold tek yönlü geçiş yapar: ya `REFUNDED` olur ya da `SETTLED`. Asla ikisi birden olamaz.
   - İade veya sonuçlandırma işleminde `WHERE status = 'HELD'` filtresi zorunludur.

2. **Ledger (CoinTransaction) Bütünlüğü:**
   - Her bakiye hareketinde `CoinTransaction` kaydı oluşturulur.
   - `@@unique([userId, type, referenceId])` bileşik unique indeksi sayesinde aynı referans için mükerrer ödül veya iade kaydı yazılamaz.
   - PostgreSQL 25P02 transaction abort hatasını önlemek için `create` öncesinde `findUnique` kontrolü yapılır.

3. **Çoklu Süreç (Cross-Process / Multi-Instance) Koruması:**
   - `settleMatch` ve `reconcileStaleMatches` fonksiyonlarında transaction başında PostgreSQL satır kilidi (`SELECT status, "settledAt" FROM "Match" WHERE id = $1 FOR UPDATE`) alınır.
   - Birden fazla backend worker aynı anda çalışsa dahi yarış durumu oluşamaz.

4. **PvE Bot Maçları Kuralı:**
   - Bot içeren maçlar antrenman maçıdır.
   - Maç başlarken gerçek oyuncunun 100 coin blokesi derhal iade edilir (`refundMatchHolds`).
   - Maç bittiğinde 0 coin ödül verilir, 0 rating değişir. Sistem dışından karşılıksız coin üretilmez.

5. **Liveness (Canlılık) ve 15 Dakika Kuralı:**
   - Bir maç 15 dakikadan eski olsa dahi hemen iptal edilmez.
   - Soru başlangıcı, cevap gönderimi, countdown ve reconnect sırasında `updateMatchActivity` çağrılır.
   - `updateMatchActivity` hem Redis'e hem de PostgreSQL'deki `MatchHold.updatedAt` damgasına nabız yazar.
   - Redis kapansa veya anahtar silinse bile PostgreSQL canlılık nabzı maçı korur.

---

## 3. Veritabanı ve Migration Durumu

- **Aktif Veritabanı:** `footquiz` (PostgreSQL localhost:5433)
- **Migration Zinciri:**
  1. `20261011000000_init`: Tüm temel tablolar, enum'lar ve indeksler.
  2. `20261012_p0_match_hold_and_ledger`: `MatchHold` tablosu, composite unique ledger indeksi.
- **Migration Durumu:** `npx prisma migrate status` -> `Database schema is up to date!`
- **Boş Veritabanı Doğrulaması:** Boş test veritabanında migration zinciri baştan çalıştırıldı ve `prisma migrate diff` ile tam uyum ("No difference detected") kanıtlandı.

---

## 4. Doğrulanmış Test Metrikleri ve Kanıt Standardı

| Test Kategorisi | Test Dosyası | Başarılı / Toplam | Başarı Oranı |
| :--- | :--- | :--- | :--- |
| **Gerçek Altyapı Eşzamanlılık Testleri** | [backend/test-real-infra.ts](file:///c:/Users/Alperen/Desktop/Footrace/backend/test-real-infra.ts) | **20 / 20** | **%100** |
| **Uçtan Uca MVP Kabul Testleri** | [backend/test-e2e-mvp-audit.ts](file:///c:/Users/Alperen/Desktop/Footrace/backend/test-e2e-mvp-audit.ts) | **10 / 10** | **%100** |
| **Vitest Birim ve Eşzamanlılık Testleri** | `npm test` (8 test dosyası) | **61 / 61** | **%100** |
| **Derleme Doğrulaması** | `npm run build` | **0 Hata** | **%100** |


---

## 5. Açık Bulgular ve Sıradaki Görevler (P1 Güvenlik Aksiyon Planı)

Kamuya açık genel canlı lansmandan önce çözülecek maddeler ve hazır uygulama reçeteleri:

### 📌 P1.1: WebSocket `join_room` Yetkilendirmesi (Oda İzolasyonu)
- **Hedef Dosya:** `backend/src/gateway/game.gateway.ts` (satır 86-96)
- **Mevcut Durum:** İstemciden gelen `data.roomId` parametresi kontrol edilmeden `client.join(data.roomId)` yapılıyor.
- **Çözüm:**
  ```typescript
  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.clientMapping.get(client.id);
    if (!userId || !data.roomId) return;
    
    // Oyuncunun Redis'teki resmi odasını doğrula
    const assignedRoom = await this.matchmakingService.getPlayerRoom(userId);
    if (assignedRoom !== data.roomId) {
      this.logger.warn(`Yetkisiz oda katılım girişimi: User ${userId} -> Room ${data.roomId}`);
      client.emit('error', { code: 'UNAUTHORIZED_ROOM', message: 'Bu odaya katılma yetkiniz yok.' });
      return;
    }
    
    client.join(data.roomId);
    await this.gamesService.updateMatchActivity(data.roomId);
  }
  ```

### 📌 P1.2: HTTP API Rate Limiting (DDoS & Brute-Force Koruması)
- **Hedef Paket:** `@nestjs/throttler`
- **Hedef Dosyalar:** `backend/src/app.module.ts`, `backend/src/auth/auth.controller.ts`
- **Çözüm:** `ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])` eklenerek genel API dakikada 60 istek ile sınırlandırılacak. Özellikle `POST /auth/guest` endpoint'ine dakikada 10 istek sınırı konularak misafir hesap spam'i engellenecek.

### 📌 P1.3: Global Input Doğrulama (ValidationPipe)
- **Hedef Paketler:** `class-validator`, `class-transformer`
- **Hedef Dosya:** `backend/src/main.ts`
- **Çözüm:**
  ```typescript
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  ```

### 📌 P1.4: CORS ve WebSocket Origin Sınırlandırması
- **Hedef Dosyalar:** `backend/src/main.ts`, `backend/src/gateway/game.gateway.ts`
- **Mevcut Durum:** `app.enableCors()` ve `cors: { origin: '*' }` (Wildcard açık).
- **Çözüm:** `process.env.FRONTEND_URL || 'http://localhost:3000'` üzerinden yalnızca frontend etki alanına izin verilecek.

### 📌 P2 Destekleyici Görevler
- [ ] `auth.module.ts`: `JWT_SECRET` ortam değişkeni tanımlı değilse sunucunun başlamasını engelleyen fail-fast kontrolü.
- [ ] `app.controller.ts`: PostgreSQL ve Redis ping atan `/health` endpoint'i.
- [ ] Operasyonel `pg_dump` cron yedekleme script'i ve migration rollback dokümanı.

---

## 6. Proje Dizin Yapısı Hatırlatması

```text
Footrace/
├── FOOTQUIZ_MIMARI_VE_PROJE_RAPORU.txt       <- Ayrıntılı mimari ve proje gelişim raporu
├── FOOTQUIZ_HATIRLAMA_VE_HAFIZA_DOSYASI.md   <- Bu hafıza ve checkpoint dosyası (KÖK DİZİNDE)
├── docker-compose.yml                        <- Postgres (5433) ve Redis (6379)
├── backend/
│   ├── prisma/                               <- schema.prisma, migrations/, seed.ts, questions.json
│   ├── src/
│   │   ├── auth/                             <- Guest login, JWT, OAuth strategies
│   │   ├── wallet/                           <- WalletService (hold, settle, refund, ledger)
│   │   ├── matchmaking/                      <- MatchmakingService (queues, bot backfill, locks)
│   │   ├── games/                            <- GamesService, QuestionSelector, ScoringEngine
│   │   ├── gateway/                          <- GameGateway (WebSockets)
│   │   ├── bot/                              <- BotService (20 bot profili, dinamik fallback)
│   │   ├── shop/                             <- ShopService & ShopController (IAP, VIP pass, restore)
│   │   ├── leaderboard/                      <- LeaderboardService (Haftalık kazananlar & RP)
│   │   ├── prisma/                           <- DbBootstrapService (Self-healing on startup)
│   │   └── redis/                            <- RedisService (ioredis wrapper)
│   ├── test-real-infra.ts                    <- 20 senaryolu gerçek PostgreSQL + Redis testi
│   └── test-e2e-mvp-audit.ts                 <- 10 senaryolu gerçek uçtan uca MVP testi
└── frontend/
    ├── src/app/                              <- Next.js App Router (lobby, game/[roomId], login, shop, leaderboard)
    ├── src/components/                       <- IapModal, LegalTermsModal, Navbar, QuestionCard
    └── src/store/                            <- Zustand useAuthStore
```

---

## 7. Sürüm 1.4.1 — 10 Kişilik Eşleştirme & Tepki Süresi Düzeltmeleri (15 Ekim 2026)

- **Tespit Edilen Kök Nedenler:**
  1. *İstemci Tepkisizliği:* `transports: ['websocket']` direkt WS zorlaması nedeniyle ilk el sıkışma 3-5 saniye gecikiyordu. Butonda `disabled={socketState !== 'CONNECTED'}` varken görsel bir disabled/spinner stili olmadığı için tıklamalar boşa düşüyor, bağlantı kurulunca 3-5. tıklamada yanıt veriyordu.
  2. *Anlık Geri Bildirim Eksikliği:* Tıklandığında istemci tarafında optimistik durum güncellenmiyor, sunucudan `matchmaking_status` gelene kadar buton normal duruyordu.
  3. *Render DB Şema / Seed Eksikliği:* `start:prod` komutunda `prisma migrate deploy` olmadığı için canlıda `MatchHold` tablosu eksikti. Ayrıca `classic_10` modu ve botlar canlı DB'de eksik olduğunda backfill sessizce çöküyor ve oyuncu sonsuza kadar "Rakip aranıyor..."da kalıyordu.
- **Uygulanan Çözümler:**
  - `DbBootstrapService`: Backend açılışında `MatchHold` tablosunu, `CoinTransaction` unique indeksini, `quick_2` ve `classic_10` modlarını, 20 botu ve soruları otomatik doğrulayıp eksikleri onaran kendini iyileştirme (self-healing) servisi eklendi.
  - `start:prod`: `prisma migrate deploy && node dist/main` zinciri kurularak canlı dağıtımlarda otomatik migration sağlandı.
  - `BotService.getAvailableBots`: Yetersiz bot durumunda anında dinamik bot üretme fallback'i eklendi (10 kişilik maçlar asla eksik kalmaz).
  - `SocketProvider`: `transports: ['polling', 'websocket']` yapılarak anında HTTP bağlantısı ve pürüzsüz WS yükseltmesi sağlandı.
  - `LobbyPage`: Butona `SUNUCUYA BAĞLANILIYOR...` spinner göstergesi, optimistik `Odaya bağlanılıyor...` anlık durum geçişi ve buton tıklama geribildirimi eklendi.

---

## 8. Sürüm 1.5.0 — Google Play & App Store IAP, Kademeli Bütçe Lobileri ve Vercel Güncellemesi (16 Ekim 2026)

- **Uygulama İçi Satın Alım (In-App Purchases - IAP):**
  - `ShopService` & `ShopController`: Google Play (`verifyGooglePlayPurchase`) ve Apple StoreKit 2 (`verifyAppleAppStorePurchase`) makbuz doğrulama mimarisi kuruldu.
  - İdempotency & Anti-Replay: `referenceId` ile çift harcama ve sahte makbuz koruması sağlandı.
  - VIP Pass Aboneliği: Redis tabanlı TTL abonelik yönetimi (`user_vip:${userId}`), 2x XP/RP, altın isim rozeti ve günlük +100 bonus coin eklendi.
  - Satın Alımları Geri Yükle (Restore Purchases): Apple App Store Guideline 3.1.1 şartı gereği `restorePurchases` akışı ve arayüz butonu eklendi.
  - Gerçekçi Mobil Arayüzler: iOS StoreKit 2 (Face ID / Apple ID sheet) ve Android Google Play Billing modal tasarımları oluşturuldu.
  - Yasal Uyumluluk (Legal & Compliance): Apple/Google yönergelerine uygun Kullanım Koşulları (EULA) ve Gizlilik Politikası modalı (`LegalTermsModal`) entegre edildi.
  - Ödüllü Reklam (Rewarded Ad): Reklam izleme simülasyonu ile +25 coin kazanma mekaniği eklendi.

- **Kademeli Bütçe Lobileri (Tiered Budget Lobbies):**
  - Kullanıcı isteği doğrultusunda 4 farklı giriş bütçesi ve ödül havuzu tanımlandı:
    * 🥉 **Bronz Lobi:** 100 Coin Giriş / 900 Coin Ödül (10 Oyunculu) | 100 Giriş / 180 Ödül (2 Oyunculu)
    * 🥈 **Gümüş Lobi:** 250 Coin Giriş / 2250 Coin Ödül (10 Oyunculu) | 250 Giriş / 450 Ödül (2 Oyunculu)
    * 🥇 **Altın Lobi:** 500 Coin Giriş / 4500 Coin Ödül (10 Oyunculu) | 500 Giriş / 900 Ödül (2 Oyunculu)
    * 💎 **Elmas Lobi:** 1000 Coin Giriş / 9000 Coin Ödül (10 Oyunculu) | 1000 Giriş / 1800 Ödül (2 Oyunculu)
  - `DbBootstrapService` & `seed.ts`: Tüm 8 oyun modu veritabanında dinamik bootstrap ile güvenceye alındı.
  - `MatchmakingService`: 15 saniye zaman aşımında botlarla otomatik tamamlama (`checkStaleQueues`) tüm modları kapsayacak şekilde optimize edildi.
  - `LobbyPage`: 10 Oyunculu ve 2 Oyunculu format seçicisi, 4 kademeli bütçe kartı ve bakiye yetersizliği uyarıları eklendi.

- **Çift Sekmeli Liderlik Tablosu (Leaderboard):**
  - "Haftalık Kazananlar (Coin)" ve "Genel Derece (RP)" olmak üzere çift sekmeli modern kart tasarımı.
  - Botlar rekabetçi liderlik tablosundan tamamen filtrelendi (`isBot: false`).

- **Test ve Kalite Güvencesi:**
  - 61 backend Vitest testi (%100 başarı) doğrulandı.
  - Frontend Turbopack production derlemesi (`npm run build`) sıfır hata ile tamamlandı.
  - Tarayıcı alt ajanı ile tüm lobi, mağaza, IAP modal ve liderlik tablosu akışları canlı DOM üzerinde test edildi (Kayıt: `test_footquiz_ui_1792103496189.webp`).

- **Dağıtım (Deployment):**
  - Kodlar `https://github.com/alperenkaban/footrace.git` `main` dalına pushlandı (Son commit: `1d57cef`).
  - Vercel GitHub entegrasyonu üzerinden otomatik derleme tetiklendi.

---

## 9. Gelecek Oturumlarda Yerel Başlatma ve Hızlı Sorun Giderme Rehberi

1. **Docker Servisleri (PostgreSQL & Redis):**
   ```powershell
   # Docker çalışmıyorsa önce Docker Desktop'ı başlatın:
   explorer.exe "C:\Program Files\Docker\Docker\Docker Desktop.exe"
   # Ardından servisleri kaldırın:
   docker compose up -d
   ```
   * PostgreSQL: Port 5433 (`localhost:5433`, db: `footquiz`)
   * Redis: Port 6379 (`localhost:6379`)

2. **Backend Başlatma:**
   ```powershell
   cd c:\Users\Alperen\Desktop\Footrace\backend
   npm run start:dev
   # Backend http://localhost:4000 üzerinde ayağa kalkar
   ```

3. **Frontend Başlatma:**
   ```powershell
   cd c:\Users\Alperen\Desktop\Footrace\frontend
   npm run dev
   # Frontend http://localhost:4001 üzerinde açılır
   ```

4. **"SUNUCUYA BAĞLANILIYOR..." veya Eşleşmeme Sorunu Çözümü:**
   - Lobi butonunda "SUNUCUYA BAĞLANILIYOR..." yazıyorsa ve tıklayınca uyarı veriyorsa, Docker servisleri veya port 4000'deki backend kapalıdır.
   - Çözüm: Yukarıdaki adımlarla Docker ve `npm run start:dev` başlatıldığında buton anında yeşile dönüp aktif hale gelir.

5. **Vercel Proje Ayarları (Monorepo):**
   - **Root Directory:** `frontend`
   - **Environment Variables:** `NEXT_PUBLIC_API_URL` -> Canlı backend URL'i (örn. `https://footrace-6lnc.onrender.com`).

===============================================================================
[HAFIZA DOSYASI SONU — NOVA — SÜRÜM 1.5.0 — CHECKPOINT KAYDEDİLDİ]
===============================================================================

