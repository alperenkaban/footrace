# FOOTQUIZ — PROJE HAFIZA VE HATIRLAMA DOSYASI (CHECKPOINT)

> **Asistan:** Nova  
> **Tarih:** 12 Ekim 2026  
> **Konum:** Kök Dizin (`c:\Users\Alperen\Desktop\Footquiz\FOOTQUIZ_HATIRLAMA_VE_HAFIZA_DOSYASI.md`)  
> **Bağlı Mimari Rapor:** `c:\Users\Alperen\Desktop\Footquiz\FOOTQUIZ_MIMARI_VE_PROJE_RAPORU.txt`  
> **Git Deposu:** `https://github.com/alperenkaban/footrace.git` (Branch: `main`)  
> **Mevcut Sürüm Durumu:** Sürüm 1.4.0 — Sınırlı Beta İçin Hazır (Limited Beta Ready)

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
| **Gerçek Altyapı Eşzamanlılık Testleri** | [backend/test-real-infra.ts](file:///c:/Users/Alperen/Desktop/Footquiz/backend/test-real-infra.ts) | **20 / 20** | **%100** |
| **Uçtan Uca MVP Kabul Testleri** | [backend/test-e2e-mvp-audit.ts](file:///c:/Users/Alperen/Desktop/Footquiz/backend/test-e2e-mvp-audit.ts) | **10 / 10** | **%100** |
| **Vitest Birim ve Eşzamanlılık Testleri** | `npm test` (8 test dosyası) | **61 / 61** | **%100** |
| **Derleme Doğrulaması** | `npm run build` | **0 Hata** | **%100** |

---

## 5. Açık Bulgular ve Sıradaki Görevler (Backlog)

Kamuya açık genel canlı lansmandan önce çözülmesi gereken maddeler:

- [ ] **[P1] WebSocket `join_room` Yetkilendirmesi:** `GameGateway.handleJoinRoom` içine `const userRoom = await this.matchmakingService.getPlayerRoom(userId); if (userRoom !== data.roomId) return;` kontrolü eklenmeli.
- [ ] **[P1] HTTP Rate Limiting:** `@nestjs/throttler` paketi kurulup `/auth/guest` ve login endpoint'lerine brute-force koruması eklenmeli.
- [ ] **[P1] Global ValidationPipe:** `main.ts` içine `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))` eklenmeli.
- [ ] **[P1] CORS Sınırlandırması:** `main.ts` ve `game.gateway.ts` içindeki `origin: '*'` değeri `process.env.FRONTEND_URL` ile sınırlandırılmalı.
- [ ] **[P2] JWT_SECRET Fail-Fast:** Ortam değişkeni tanımlanmadığında uygulamanın ayağa kalkması engellenmeli.
- [ ] **[P2] Health Check Endpoint:** `/health` endpoint'i eklenerek DB ve Redis ping kontrolleri sağlanmalı.
- [ ] **[P2] Backup & Rollback Runbook:** Günlük `pg_dump` cron'u ve migration geri alma kılavuzu hazırlanmalı.

---

## 6. Proje Dizin Yapısı Hatırlatması

```text
Footquiz/
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
│   │   ├── bot/                              <- BotService (20 bot profili, simüle cevaplar)
│   │   └── redis/                            <- RedisService (ioredis wrapper)
│   ├── test-real-infra.ts                    <- 20 senaryolu gerçek PostgreSQL + Redis testi
│   └── test-e2e-mvp-audit.ts                 <- 10 senaryolu gerçek uçtan uca MVP testi
└── frontend/
    ├── src/app/                              <- Next.js App Router (lobby, game/[roomId], login)
    └── src/store/                            <- Zustand useAuthStore
```

===============================================================================
[HAFIZA DOSYASI SONU — NOVA — SÜRÜM 1.4.0 — CHECKPOINT KAYDEDİLDİ]
===============================================================================
