# 🚀 Nova Phase Runner — Canlı Proje Seyir Defteri

> Bu dosya her faz tamamlandığında Nova tarafından otomatik olarak güncellenir.
> Mod: **Kesintisiz Otonom İcra (Zero-Confirmation)**


---

### 💬 [Faz 0] Ekonomi ve Cüzdan Stres Testleri

- **Durum:** ✅ Tamamlandı (00:58:37)
- **Hedef:** MatchHold, WalletService ve CoinTransaction sisteminin eşzamanlı işlemlerde finansal tutarlılığını kanıtlamak.
- **Doğrulama Sonucu:** Başarılı ✔
- **💡 Nova Özeti:** MatchHold, WalletService ve CoinTransaction sisteminin eşzamanlı işlemlerde finansal tutarlılığını kanıtlamak.
- **⏭️ Sonraki Adım:** Onay beklemeden kesintisiz olarak **[Faz 1] Matchmaking ve 10 Oyunculu Oda Stres Testleri** başlatıldı.

---

### 💬 [Faz 1] Matchmaking ve 10 Oyunculu Oda Stres Testleri

- **Durum:** ✅ Tamamlandı (01:12:00)
- **Hedef:** Quick join, classic_10, bot backfill ve oda oluşturma süreçlerinin eşzamanlı yük altında doğru çalıştığını doğrulamak.
- **Doğrulama Sonucu:** Başarılı ✔ (`npm --prefix backend test && npm --prefix backend run build` - 17 test dosyası, 150 test geçti)
- **💡 Nova Özeti:**
  1. **Çoklu Instance ve Eşzamanlı Eşleştirme Koruması:** `startMatch` içerisinde oyuncular `setNX('player_room:${userId}', roomId, 3600)` atomik Redis kilidiyle odaya bağlanarak aynı oyuncunun iki odaya aynı anda atanması kesin olarak engellendi.
  2. **Tek Kullanıcı Çoklu Kuyruk Koruması:** `player_queue_lock:${userId}` ve `player_queue:${userId}` kontrolleri ile oyuncunun aynı anda birden fazla kuyruğa girmesi önlendi.
  3. **Oda Kapasite ve Üyelik Doğrulaması:** `GameGateway.handleJoinRoom` seviyesinde hem `player_room` oda ataması hem de `roomState.players` listesinde üyelik ve `maxPlayers` kapasite kontrolleri sıkılaştırıldı; yetkisiz veya kapasite aşımı yapan bağlantılar `ROOM_CAPACITY_EXCEEDED` ile kontrollü reddedildi.
  4. **Kuyruktan Çıkış ve Bağlantı Kopması:** `leaveQueue` ve `handleUserDisconnect` ile eşzamanlı çıkışlarda `player_leave_lock:${userId}` üzerinden çift iade önlendi, hold'lar güvenle iade edildi.
  5. **classic_10 ve Bot Backfill Kuralları:** 10 insan oyuncunun tek odada eşleştiği; eksik kalan odalarda botların backfill ile tamamlandığı; botlu PvE maçlarında insan oyuncuların ücretlerinin %100 iade edildiği, karşılıksız para veya rating üretilmediği ve botların leaderboard'da kesinlikle yer almadığı kanıtlandı.
  6. **Kapsamlı Test Paketi:** `matchmaking.stress.spec.ts` oluşturularak 12 stres ve eşzamanlılık senaryosu ile uçtan uca doğrulandı.
- **⏭️ Sonraki Adım:** Onay beklemeden kesintisiz olarak **[Faz 2] Socket.IO Güvenlik ve Kötüye Kullanım Testleri** başlatılacaktır.

---

### 💬 [Faz 1] Matchmaking ve 10 Oyunculu Oda Stres Testleri

- **Durum:** ✅ Tamamlandı (01:12:59)
- **Hedef:** Quick join, classic_10, bot backfill ve oda oluşturma süreçlerinin eşzamanlı yük altında doğru çalıştığını doğrulamak.
- **Doğrulama Sonucu:** Başarılı ✔
- **💡 Nova Özeti:** Quick join, classic_10, bot backfill ve oda oluşturma süreçlerinin eşzamanlı yük altında doğru çalıştığını doğrulamak.
- **⏭️ Sonraki Adım:** Onay beklemeden kesintisiz olarak **[Faz 2] Socket.IO Güvenlik ve Kötüye Kullanım Testleri** başlatıldı.

---

### 💬 [Faz 2] Socket.IO Güvenlik ve Kötüye Kullanım Testleri

- **Durum:** ✅ Tamamlandı (01:20:58)
- **Hedef:** WebSocket bağlantılarının, mesajların ve oda işlemlerinin güvenliğini doğrulamak.
- **Doğrulama Sonucu:** Başarılı ✔
- **💡 Nova Özeti:** WebSocket bağlantılarının, mesajların ve oda işlemlerinin güvenliğini doğrulamak.
- **⏭️ Sonraki Adım:** Onay beklemeden kesintisiz olarak **[Faz 3] Maç Yaşam Döngüsü ve Reconnect Dayanıklılığı** başlatıldı.

---

### 💬 [Faz 3] Maç Yaşam Döngüsü ve Reconnect Dayanıklılığı

- **Durum:** ✅ Tamamlandı (01:31:00)
- **Hedef:** Bağlantı kopması, yeniden bağlanma, terk etme ve zaman aşımı durumlarında maç bütünlüğünü korumak.
- **Doğrulama Sonucu:** Başarılı ✔ (`npm --prefix backend test && npm --prefix backend run build` - 20 test dosyası, 201 test geçti)
- **💡 Nova Özeti:**
  1. **Yaşam Döngüsü ve State Machine:** `PLAYER_READY` -> `COUNTDOWN` -> `QUESTION_ACTIVE` -> `QUESTION_ENDED` -> `GAME_FINISHED` / `SETTLED` / `ABORTED` durum geçişleri doğrulandı. Durum dışı veya geçersiz indeksle gelen cevaplar kontrollü reddedildi.
  2. **Kopma (Disconnect) ve Reconnect Dayanıklılığı:**
     - Soketi kopan oyuncu `connected: false` ve `disconnectedAt` ile işaretlenip odadakilere `player_disconnected` bildirildi; maç iptal edilmeyip oyuncunun hakkı saklı tutuldu.
     - Oyuncu yeni soketle bağlandığında `player_room:${userId}` üzerinden odasını bularak `join_room` yaptığında `connected: true` güncellendi, `player_reconnected` yayınlandı ve `room_sync` ile doğru cevap sızdırılmaksızın anlık soru, kalan süre, leaderboard ve cevap durumu senkronize edildi.
  3. **Uygulamayı Kapatıp Açma (App Restart):** `handleConnection` anında devam eden aktif maç otomatik tespit edilerek `active_match_found` yayınlandı; ayrıca `@SubscribeMessage('get_active_match')` ve `sync_room` mekanizmaları eklendi.
  4. **Çoklu Cihaz Bağlantısı (Multi-Device):** `userSockets` (`Map<string, Set<string>>`) ile kullanıcı soketleri küme olarak takip edildi. Bir cihaz koptuğunda diğer cihaz açıksa maç bağlantısı koparılmadı; aynı soruya birden fazla cihazdan gelen cevaplarda ilk cevap kabul edilip ikincisi `Already answered` ile engellendi.
  5. **Terk Etme (Leave Room / Forfeit) ve Ekonomi Güvenliği:** `leave_room` mekanizması eklendi. Terk eden oyuncu `hasLeft: true` işaretlendi ve giriş ücreti (entryFee) cüzdana ASLA iade edilmeyerek havuzda bırakıldı (ekonomi istismarı önlendi). Tüm insan oyuncular ayrıldığında maç derhal güvenle finalize edildi.
  6. **Timeout ve Bütün Oyuncuların Kopması:** Cevap vermeyen oyuncuya 0 puan verilerek oyun güvenle ilerletildi. Tüm oyuncular kopsa dahi maç çökmeden ve finansal tutarsızlık olmadan tamamlandı.
  7. **Mükerrer Ödül Engeli (Idempotency):** Bitmiş maça yeniden bağlanan oyuncuya `ROOM_CLOSED` verildi; mükerrer `settleMatch` çağrılarında DB `settledAt` ve unique `CoinTransaction` sayesinde asla ikinci kez ödül verilmediği kanıtlandı.
  8. **Sunucu Yeniden Başlama ve Mimari Sınırları:** Node.js bellek içi `setTimeout` soru sayaçlarının sunucu çöküşü sonrası in-flight devam etmediği; ancak `WalletService.reconcileStaleMatches` ile asılı kalan maçların güvenle `ABORTED` edilerek oyuncu paralarının %100 iade edildiği ve sıfır fon kaybı garantisi sağlandığı belgelendi.
  9. **Kapsamlı Test Paketi:** `test/match-lifecycle-reconnect.spec.ts` oluşturularak 13 uçtan uca senaryo ile test edildi (toplam 20 test dosyası, 201 test %100 yeşil).
- **⏭️ Sonraki Adım:** Onay beklemeden kesintisiz olarak **[Faz 4] 10 Turluk Soru Motoru ve Oyun Kuralları** başlatılacaktır.


---

---

### 💬 [Faz 4] 10 Turluk Soru Motoru ve Oyun Kuralları

- **Durum:** ✅ Tamamlandı (01:45:00)
- **Hedef:** 10 turluk oyun akışının, soru tiplerinin ve sunucu otoritesinin doğru çalıştığını kanıtlamak.
- **Doğrulama Sonucu:** Başarılı ✔ (`npm --prefix backend test && npm --prefix backend run build` - 21 test dosyası, 230 test geçti, 0 hata)
- **💡 Nova Denetim Bulguları ve Uygulanan Çözümler:**
  1. **Mevcut Soru Tipleri ve Havuz Açıklarının Tespiti (Gap Analysis):**
     - Yapılan ilk denetimde, veri tabanı tohum dosyasında (`backend/prisma/questions.json`) toplam 120 soru olmasına karşın; `MULTIPLE_CHOICE: 90`, `ESTIMATION: 15`, `RANKING: 15` bulunduğu; `PLAYER_GUESS: 0`, `HARD_QUESTION: 0`, `FINAL: 0` soru bulunduğu tespit edildi.
     - `QuestionSelector` sınıfının sorgu filtresinde yalnızca `['MULTIPLE_CHOICE', 'ESTIMATION', 'RANKING']` yer aldığı, `PLAYER_GUESS`, `HARD_QUESTION` ve `FINAL` soru tiplerinin veritabanından hiç çekilmediği saptandı.
     - Bu eksiklikler şeffafça raporlanarak; 10 adet zengin `PLAYER_GUESS` (ipuçları, takma adlar, seçenekler), 10 adet `HARD_QUESTION` (+1500 puan) ve 10 adet `FINAL` (+2000 puan) sorusu oluşturularak havuz 150 soruya çıkarıldı ve PostgreSQL'e fiziksel olarak tohumlandı (`seed.ts`).
  2. **10 Turluk Zorunlu Oyun Akışının Sağlanması (`TEN_ROUND_SEQUENCE`):**
     - Soru motoruna tasarlanan sıra zorunlu kural olarak entegre edildi:
       * **Tur 1:** Sayı tahmini (`ESTIMATION`)
       * **Tur 2:** Dört seçenek (`MULTIPLE_CHOICE`)
       * **Tur 3:** Sıralama (`RANKING`)
       * **Tur 4:** Sayı tahmini (`ESTIMATION`)
       * **Tur 5:** Futbolcuyu bul (`PLAYER_GUESS`)
       * **Tur 6:** Dört seçenek (`MULTIPLE_CHOICE`)
       * **Tur 7:** Sayı tahmini (`ESTIMATION`)
       * **Tur 8:** Sıralama (`RANKING`)
       * **Tur 9:** Zor soru (`HARD_QUESTION`)
       * **Tur 10:** Final sorusu (`FINAL`)
     - `QuestionSelector.selectRandomUniqueQuestions` metodu 10 turluk modlarda (`classic_10` ve varyantları) her turun beklenen soru tipini benzersiz ve doğrulanmış sorulardan seçecek şekilde güncellendi.
  3. **Sunucu Otoritesi ve İstemciye Güvenmeme (Server Authority & Anti-Cheat):**
     - **Erken Doğru Cevap Sızıntısı Engeli:** `question_started` paketinde `correctAnswer` alanının istemcilere ASLA gönderilmediği; `room_sync` senkronizasyonunda aktif sorunun doğru cevabının kesinlikle gizlendiği kanıtlandı.
     - **Eşit Soru Garantisi:** Odadaki tüm oyuncuların aynı soru indeksini, süreyi ve metin/metadata içeriğini aldığı doğrulandı.
     - **Sunucu Zaman Otoritesi:** `durationMs` ve `questionEndsAt` sunucu saatiyle belirlenip 1000ms'lik clock-drift toleransı sonrası gelen geç cevapların `Time is up` hatasıyla reddedildiği doğrulandı.
     - **Tekil Cevap Kilidi:** Bir oyuncunun aynı soruya yalnızca 1 kez cevap verebileceği, mükerrer cevapların `Already answered` ile engellendiği ve yetkisiz veya ayrılmış oyuncuların cevaplarının reddedildiği doğrulandı.
     - **Sunucu Tarafı Puanlama:** İstemciden skor veya doğruluk bilgisi kabul edilmez; skor tamamen sunucu `ScoringEngine` tarafından hesaplanır.
  4. **Matematiksel Puanlama ve Cevap Eşleştirme Kuralları (`ScoringEngine`):**
     - **Sayı Tahmini (`ESTIMATION`):** Tam isabet: 1000 Puan. %10 tolerans marjı içinde sapmaya göre lineer azalan puan formülü uygulandı. Marj dışı veya NaN/geçersiz sayılarda 0 puan verildi.
     - **Dört Seçenek (`MULTIPLE_CHOICE`):** Doğru seçenek: 1000 Puan, Yanlış: 0 Puan.
     - **Sıralama (`RANKING`):** Tüm dizinin eksiksiz doğru sıralanması: 1000 Puan, herhangi bir sıra hatasında 0 Puan.
     - **Futbolcuyu Bul (`PLAYER_GUESS`):** Gelişmiş `normalizeText` fonksiyonu ile Türkçe karakterler (ç, ğ, ı, ö, ş, ü), aksanlar (é, è, á), büyük/küçük harf ve noktalama normalizasyonu yapıldı ("Arda Güler" === "arda guler", "Pelé" === "pele"). `metadata.aliases` desteği sağlandı. Doğru: 1000 Puan.
     - **Zor Soru (`HARD_QUESTION`):** Tur 9 için +1500 Puan baremi uygulandı.
     - **Final Sorusu (`FINAL`):** Tur 10 için +2000 Puan baremi uygulandı.
  5. **Soru Verisi Bütünlüğü ve Hata Koruma Kalkanı (`QuestionValidator`):**
     - `backend/src/games/question-validator.ts` oluşturuldu.
     - **Eksik Cevap:** `correctAnswer` null, undefined veya boş olan sorular elendi.
     - **Bozuk Görsel:** `imageUrl` alanında `javascript:`, boş veya geçersiz protokol içeren sorular elendi.
     - **Tekrarlanan Soru:** Maç içinde aynı `questionId` veya `code` değerine sahip soruların tekrarlanması engellendi.
     - **Geçersiz Seçenek:** 4 seçenekten az/fazla olan, seçenekleri arasında mükerrerlik barındıran veya doğru cevabı seçeneklerinde yer almayan sorular elendi.
  6. **Frontend Arayüz Desteği (`frontend/src/app/game/[roomId]/page.tsx`):**
     - Önceden yalnızca 3 tipi render eden arayüz; `PLAYER_GUESS` (ipucu kartları, oyuncu arama ve seçenekler), `HARD_QUESTION` (alevli zor soru rozeti, +1500 puan) ve `FINAL` (kraliyet tacı final rozeti, +2000 puan) soru tiplerini destekleyecek şekilde güncellendi.
  7. **Kapsamlı Test Paketi:**
     - `test/ten-round-engine.spec.ts` oluşturularak 10 turluk sıralama, sunucu otoritesi, 5 soru tipinin puanlama matematiği, veri bütünlüğü ve 10 oyunculu maç simülasyonu test edildi (21 test dosyası, 230 test %100 yeşil).
- **⏭️ Sonraki Adım:** Onay beklemeden kesintisiz olarak sonraki faza geçilecektir.


---

### 💬 [Faz 5] Skor, Kazanan ve Ödül Dağıtımı Denetimi

- **Durum:** ✅ Tamamlandı (01:58:00)
- **Hedef:** Maç puanlarının, sıralamanın ve ödül dağıtımının doğru ve tekrar edilemez olduğunu kanıtlamak.
- **Doğrulama Sonucu:** Başarılı ✔ (`npm --prefix backend test && npm --prefix backend run build` - 23 test dosyası, 249 test geçti, 0 hata)
- **💡 Nova Denetim Bulguları ve Uygulanan Çözümler:**
  1. **Tüm Soru Tiplerinin Puanlama ve Determinizm Denetimi:**
     - 6 Soru tipi (`ESTIMATION`, `MULTIPLE_CHOICE`, `RANKING`, `PLAYER_GUESS`, `HARD_QUESTION`, `FINAL`) `ScoringEngine` seviyesinde denetlendi.
     - `ESTIMATION`: Tam isabet 1000 puan, %10 tolerans içinde lineer azalan puan, marj dışı ve NaN/geçersiz sayılarda 0 puan.
     - `MULTIPLE_CHOICE`: Doğru 1000 puan, yanlış 0 puan.
     - `RANKING`: Tam sıra 1000 puan, tek bir sapmada 0 puan.
     - `PLAYER_GUESS`: İsim, Türkçe karakter, aksan ve takma ad normalizasyonunda 1000 puan, yanlışta 0 puan.
     - `HARD_QUESTION`: Tur 9 için +1500 puan baremi.
     - `FINAL`: Tur 10 için +2000 puan baremi.
     - **Determinizm:** Aynı soruya aynı cevabı veren farklı oyuncuların puanlarının %100 deterministik ve birbirine eşit olduğu kanıtlandı.
  2. **Eşitlik Durumları (Tie-Breaking) ve Deterministik Sıralama Algoritması:**
     - `GamesService` soru başlama zamanı (`questionStartedAt`), cevaplama süresi (`answerTimes`) ve kümülatif süre (`totalResponseTimeMs`) takibiyle güçlendirildi.
     - Eşitlik durumlarında 4 aşamalı deterministik sıralama mimarisi kuruldu:
       1. **Terk Etme Önceliği:** Maçı terk eden oyuncular (`hasLeft: true`) aktif oyuncuların gerisine düşer.
       2. **Puan Üstünlüğü:** Toplam puanı yüksek olan öne geçer.
       3. **Hız Eşitlik Bozucusu (Tie-break):** Puanlar eşitse toplam cevaplama süresi daha kısa olan (`totalResponseTimeMs`) kazanır.
       4. **Deterministik Fallback:** Puan ve süreler de eşitse `userId` alfabetik sırasına göre sıralanır (asla rastgele sonuç üretilmez).
  3. **Sunucu Otoritesi (Server Authority):**
     - Skorlama ve sıralama yalnızca sunucu tarafından (`ScoringEngine` ve `GamesService.finishGame`) hesaplanır.
     - İstemciden skor, puan veya kazanan kabul eden hiçbir soket mesajı yoktur; istemci sadece cevap verisini gönderir.
     - Sunucunun belirlediği sonuçlar doğrudan `walletService.settleMatch` çağrısına iletilir.
  4. **10 İnsan Oyunculu Rekabetçi Maç Ekonomisi:**
     - 10 oyuncu * 100 Coin giriş ücreti = 1000 Coin toplam pot.
     - %10 House cut = 100 Coin kasa komisyonu.
     - Net kazanan ödülü = 900 Coin (`prizePool`).
     - Kazanan: Bakiye +900 Coin, Rating +20 RP, Galibiyet +1 win.
     - Kaybeden 9 oyuncu: Blokedeki 100 Coin düşer, rating ve galibiyet değişmez.
     - 10 oyuncunun `MatchHold` kayıtları `SETTLED` durumuna geçer.
     - Kazanan adına tek bir `MATCH_REWARD` (900 Coin) `CoinTransaction` kaydı açılır.
     - Para koruma kanunu (Conservation of money) kuruşu kuruşuna doğrulanmıştır.
  5. **Botlu PvE Maçında Ekonomi Kuralları:**
     - 1 insan + 9 botlu (veya çoklu botlu) maçlarda:
     - İnsan oyuncunun giriş ücreti (100 Coin) iade edilir (`heldBalance` -> `balance`), `MATCH_REFUND` kaydı oluşturulur.
     - Ödül havuzu sıfırdır (`prizePool = 0`).
     - Ne insana ne botlara hiçbir coin ödülü verilmez (0 Coin).
     - Rating artışı yazılmaz (+0), Galibiyet sayısı yazılmaz (+0).
     - Botlar için cüzdan/hold/ledger kaydı oluşturulmaz.
     - Çağrıcı kasıtlı olarak `isPvE = false` gönderse dahi DB'den bot kullanıcısı (`isBot: true`) tespit edildiğinde otomatik PvE koruması devreye girer.
  6. **Beraberlik, Terk Etme, İptal ve Yarıda Kalan Maçlar:**
     - **Kazanan Olmayan İptal/Beraberlik:** `winnerId` olmadan settle edildiğinde tüm oyuncuların hold'ları güvenle iade edilir (`MATCH_REFUND`).
     - **Terk Etme (Forfeit):** Maç devam ederken `leave_room` çağıran oyuncunun parası iade edilmez (`hasLeft: true`), kalan aktif oyuncu maçı tamamlayıp ödülü alır.
     - **İptal ve Yarıda Kalan Maç (Reconciliation):** 15 dakikadır hareketsiz asılı kalan maçlar `reconcileStaleMatches` tarafından atomik `ABORTED` yapılır ve tüm hold'lar oyunculara iade edilir (`MATCH_REFUND`).
  7. **Settlement Eşzamanlılığı ve İdempotency (Tek Ödül Kaydı):**
     - Aynı maç için paralel 3 `settleMatch` çağrısında; `withMatchLock`, PostgreSQL `SELECT ... FOR UPDATE` satır kilidi, `Match.settledAt` ve `CoinTransaction` bileşik unique indeksi (`[userId, type, referenceId]`) sayesinde ödül yalnızca 1 kez dağıtılır.
     - Kazananın bakiyesi, rating'i ve win sayısı sadece 1 kez artar; tek bir `MATCH_REWARD` oluşur; mükerrer çağrılar güvenle uyarılır ve atlanır.
  8. **Liderlik Tablosu (Leaderboard) Doğruluğu ve Bot Filtresi:**
     - `LeaderboardService` veritabanı sorgusunda `where: { user: { isBot: false } }` filtresi ile botları tamamen eler.
     - Gerçek oyuncular rating ve galibiyet sayılarına göre azalan sırada listelenir.
     - Redis önbelleği (30s TTL) ve Redis hata toleransı test edilerek kanıtlandı.
  9. **Eklenen Test Paketleri:**
     - `backend/test/score-settlement-audit.spec.ts` oluşturuldu (14 senaryo %100 geçti).
     - `backend/src/leaderboard/leaderboard.service.spec.ts` oluşturuldu (5 senaryo %100 geçti).
     - Toplam 23 test dosyası, 249 test %100 yeşil ve `nest build` hatasız tamamlandı.
- **⏭️ Sonraki Adım:** Onay beklemeden kesintisiz olarak sonraki faza geçilecektir.

