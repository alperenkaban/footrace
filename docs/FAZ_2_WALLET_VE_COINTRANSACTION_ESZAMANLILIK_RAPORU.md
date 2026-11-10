# 🛡️ Faz 2: Wallet ve CoinTransaction Eşzamanlılık Denetim ve Doğrulama Raporu

- **Faz ID:** `p2`
- **Attempt ID:** `p2_att_1794183802737_on61k`
- **Tarih:** 2026-11-09
- **Denetçi / İcra Eden:** Nova
- **Durum:** ✅ Tamamlandı (%100 Başarılı)
- **Doğrulama Motoru:** `npm --prefix backend test && npm --prefix backend run build` (25 test dosyası, 285 test geçti, 0 hata)

---

## 1. Yönetici Özeti (Executive Summary)

Faz 2 kapsamında Footrace cüzdan altyapısı (`WalletService`), muhasebe defteri (`CoinTransaction`), geçici blokajlar (`MatchHold`), Prisma transaction yönetimi ve Redis dağıtık kilit mekanizmaları uçtan uca incelenmiş; tespit edilen fonksiyonel eksiklikler giderilmiş ve gerçek PostgreSQL (port 5434 / `footquiz_test`) ile gerçek Redis (port 6380) servisleri üzerinde yoğun eşzamanlılık (concurrency) stres testleriyle %100 doğrulanmıştır.

### Doğrulanan Temel Finansal Garantiler:
1. **Negatif Bakiye İmkânsızlığı:** `balance >= 0` ve `heldBalance >= 0` kuralları PostgreSQL `FOR UPDATE` satır kilidi ve atomik kontrollerle garanti altına alınmıştır.
2. **Çift Harcama (Double Spending) Engeli:** 100 coin bakiyesi olan kullanıcıya aynı anda gelen 10 adet 100 coinlik paralel harcama veya blokaj isteğinden tam olarak 1 tanesi kabul edilmiş, 9 tanesi kontrollü olarak reddedilmiştir.
3. **Çift Ödül (Double Reward) ve İdempotency Koruması:** Aynı makbuz veya sipariş ID'siyle gelen mükerrer `creditCoins` ve `settleMatch` isteklerinde cüzdan yalnızca 1 kez güncellenmiş; `CoinTransaction` bileşik unique indeksi (`[userId, type, referenceId]`) mükerrerliği fiziksel olarak engellemiştir.
4. **Sıfır Kayıp Transaction ve Tam Ledger Mutabakatı:** 20 paralel kredi ve 10 paralel harcama sonucunda oluşturulan 30 transaction'ın tamamında `balanceBefore + amount === balanceAfter` eşitliği sağlanmış; kullanıcının anlık bakiyesi ile ledger toplamı kuruşu kuruşuna örtüşmüştür.
5. **Redis Kesintisi ve TTL Aşımında Dayanıklılık (Outage Resilience):** Redis tamamen kapandığında veya lock TTL'i dolduğunda servis çökmemiş; PostgreSQL ACID seviyesindeki `SELECT ... FOR UPDATE` satır kilidi devreye girerek sıfır veri kaybı ve sıfır yarış durumu sağlamıştır.

---

## 2. Denetim Bulguları ve Uygulanan Geliştirmeler

### A. Harcama Metodu Eksikliği ve `spendCoins` / `debitCoins` Eklenmesi
- **Bulgu:** `WalletService` içerisinde giriş ücreti bloke etme (`holdEntryFee`) ve kredi yükleme (`creditCoins`) mevcutken; mağaza kozmetik alımları veya ipucu harcamaları için doğrudan bakiyeden düşüm yapan ve muhasebe defterine negatif tutarlı `CoinTransaction` yazan bir harcama metodu bulunmamaktaydı.
- **Çözüm:** `spendCoins` ve `debitCoins` metotları eklendi:
  - Tutar kontrolü (`amount > 0`).
  - `withUserLock` ve Redis dağıtık kilit koruması.
  - PostgreSQL `SELECT balance, "heldBalance" FROM "PlayerProfile" WHERE "userId" = $1 FOR UPDATE` satır kilidi.
  - Idempotency kontrolü: `[userId, type, referenceId]` kombinasyonu daha önce işlenmişse mükerrer düşüm yapmadan mevcut bakiyeyi döner.
  - Yetersiz bakiye kontrolü: `profile.balance < amount` durumunda `BadRequestException('Bakiye yetersiz')` fırlatır.
  - `PlayerProfile.balance` düşümü ve negatif tutarlı (`amount: -amount`) `CoinTransaction` kaydı oluşturulması.
  - `balanceBefore + amount === balanceAfter` muhasebe kuralının sağlanması.

### B. Dağıtık Redis Kilit (Distributed Mutex) Entegrasyonu
- **Bulgu:** `WalletService` içerisindeki `withUserLock` ve `withMatchLock` yalnızca process içi JavaScript bellek haritası (`Map<string, Promise<void>>`) kullanıyordu. Bu durum çoklu pod veya çoklu instance yapısında farklı process'lerin eşzamanlı çalışmasında yetersiz kalabilirdi.
- **Çözüm:**
  - `withUserLock` ve `withMatchLock` içerisine `RedisService.setNX` ile dağıtık kilit alındı (`wallet_user_lock:${userId}`, `wallet_match_lock:${matchId}`).
  - Kilidin serbest bırakılması yalnızca token doğrulamasıyla (`val === lockToken`) güvenle yapıldı.
  - **Fallback Koruması:** Redis servisinin kapalı olması, ağ hatası vermesi veya bağlantının kopması durumunda hata yakalanarak loglandı ve PostgreSQL ACID `FOR UPDATE` satır kilidine güvenli geçiş sağlandı.

### C. `getBalance` Yardımcı Metodunun Eklenmesi
- Kullanıcının `balance` ve `heldBalance` durumunu tip güvenli şekilde getiren `getBalance(userId)` fonksiyonu eklendi.

---

## 3. Gerçek Altyapı Eşzamanlılık Test Paketi (`backend/test/wallet-concurrency-audit.spec.ts`)

Testler port 5434'teki izole `footquiz_test` PostgreSQL veritabanı ve port 6380'deki izole Redis konteyneri üzerinde icra edilmiştir.

| No | Senaryo Adı | İşlem Detayı | Beklenen Sonuç | Durum |
|---|---|---|---|---|
| 1 | **Eşzamanlı Mixed Cüzdan İşlemleri** | Aynı kullanıcı için paralel 10 Hold (100 coin), 10 Spend (50 coin), 10 Credit (100 coin) | Bakiye >= 0, held >= 0, balance-ledger kuruşu kuruşuna mutabık | ✅ GEÇTİ |
| 2 | **Yüksek Eşzamanlılıkta Çift Harcama** | 100 coin bakiyesi olan kullanıcıya 10 adet paralel 100 coin harcama | Tam 1 başarılı, 9 yetersiz bakiye reddi, son bakiye kesinlikle 0 | ✅ GEÇTİ |
| 3 | **Eşzamanlı Çift Blokaj (Hold)** | 100 coin bakiyesi olan kullanıcıya 10 adet paralel 100 coin hold | Tam 1 başarılı, 9 ret, son bakiye 0, heldBalance 100 | ✅ GEÇTİ |
| 4 | **Çift Ödül ve İdempotency** | Aynı makbuz `referenceId` ile paralel 10 adet 500 coin yükleme | Yalnızca 1 kez 500 coin artış, tek CoinTransaction satırı | ✅ GEÇTİ |
| 5 | **Çoklu Pod Maç Settlement Yarışı** | İki farklı WalletService instance'ı üzerinden aynı anda 4 paralel settleMatch | Maç 1 kez SETTLED, kazanan 1 kez ödül alır, tek MATCH_REWARD | ✅ GEÇTİ |
| 6 | **Kayıp Transaction ve Ledger Audit** | 20 paralel kredi (+100) ve 10 paralel harcama (-50) | Tam 30 transaction, bakiye tam 1500, sıfır kayıp işlem | ✅ GEÇTİ |
| 7 | **balance & heldBalance Yaşam Döngüsü** | Hold -> Hold -> Refund -> Release adımları | Her adımda balance ve heldBalance matematiksel olarak tam ve doğru | ✅ GEÇTİ |
| 8 | **Redis Kesintisinde Fallback (Resilience)** | Redis kapalı/çökmüş durumda 5 eşzamanlı harcama | Servis çökmez, DB row lock ile tam 1 başarılı, 4 ret, bakiye 0 | ✅ GEÇTİ |
| 9 | **Redis Lock TTL Aşımı Koruması** | Redis lock süresi dolduğunda eşzamanlı ikinci istek | PostgreSQL row lock devreye girer, çift harcama engellenir | ✅ GEÇTİ |
| 10 | **Çoklu Örnek Pod Yarışı (Multi-Instance)** | Instance A ve Instance B üzerinden karışık 6 x 100 coin harcama (Bakiye: 300) | Tam 3 başarılı, 3 ret, son bakiye 0, sıfır yarış durumu | ✅ GEÇTİ |

---

## 4. Doğrulama Motoru Çıktısı (VerificationEngine)

```bash
$ npm --prefix backend test && npm --prefix backend run build

Test Files  25 passed (25)
     Tests  285 passed (285)
  Duration  8.84s

> backend@0.0.1 build
> prisma generate && nest build

Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma

✔ Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client in 156ms
Build completed successfully (0 errors).
```

## 5. Sonuç ve Sonraki Adım

Cüzdan, muhasebe defteri ve para akışının eşzamanlılık altındaki tutarlılığı, izole PostgreSQL ve Redis entegrasyonu ile kanıtlanmıştır. [Faz 2] başarıyla tamamlanmıştır.
