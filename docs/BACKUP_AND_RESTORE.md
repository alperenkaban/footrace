# Footrace PostgreSQL Yedekleme, Geri Yükleme ve Migrasyon Operasyonel Kılavuzu

Bu belge, Footrace (FootQuiz) platformunun PostgreSQL veritabanı için üretim ve geliştirme ortamlarında veri kaybını önleme, güvenli yedekleme (`pg_dump`), geri yükleme (`pg_restore` / `psql`) ve Prisma migration geri alma (rollback) prosedürlerini açıklar.

---

## 1. Altyapı ve Veritabanı Mimarisi

- **Docker Servisi:** `footquiz-postgres` (`postgres:15-alpine`)
- **Port:** Konteyner içi `5432`, Host üzerinde `5433`
- **Varsayılan Kullanıcı:** `root`
- **Veritabanı Adı:** `footquiz`
- **Volume:** `postgres_data` (`/var/lib/postgresql/data`)

---

## 2. Güvenlik ve Parola İlkeleri

> [!CAUTION]
> Parolalar **kesinlikle** komut satırı argümanı (CLI parameter) olarak yazılmamalıdır. İşletim sistemi süreç listesi (`ps aux`, `tasklist`) veya kabuk geçmişi (`~/.bash_history`) üzerinden parolaların sızması önlenmelidir.

### Desteklenen Güvenli Yöntemler:
1. **Çevresel Değişken (`PGPASSWORD`):**
   ```bash
   export PGPASSWORD="your_strong_password"
   # veya Docker içinde: docker exec -e PGPASSWORD=...
   ```
2. **PostgreSQL Parola Dosyası (`.pgpass` / `pgpass.conf`):**
   - Linux / macOS: `~/.pgpass` (`chmod 0600 ~/.pgpass`)
   - Windows: `%APPDATA%\postgresql\pgpass.conf`
   - Format: `hostname:port:database:username:password`
   - Örnek: `localhost:5433:footquiz:root:rootpassword`

---

## 3. Günlük Otomatik Yedekleme Prosedürü

Yedekleme scriptleri `scripts/backup-db.sh` (Linux/Docker) ve `scripts/backup-db.ps1` (Windows) konumlarında hazırlanmıştır.

### Özellikler:
- **Tarih Damgası:** `footquiz_backup_YYYYMMDD_HHMMSS.sql.gz`
- **Saklama (Retention) Politikası:** Varsayılan 14 gün (14 günden eski dosyalar otomatik silinir).
- **Hata ve İzleme Günlüğü:** `backups/backup.log` dosyasına zaman damgalı log basar.
- **Güvenli Parola Yönetimi:** Parametre yerine `PGPASSWORD` ortam değişkenini kullanır.

### Çalıştırma:
```bash
# Bash ile
bash scripts/backup-db.sh

# PowerShell ile
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
```

### Cron Zamanlaması (Linux Crontab Örneği - Her Gece 03:00):
```cron
0 3 * * * /bin/bash /opt/footrace/scripts/backup-db.sh >> /opt/footrace/backups/cron.log 2>&1
```

---

## 4. Geri Yükleme (Restore) Prosedürü

> [!WARNING]
> Geri yükleme testleri veya tatbikatları **kesinlikle** canlı veya aktif geliştirme veritabanı (`footquiz`) üzerinde yapılmamalıdır! Her zaman izole bir geçici veritabanı (`footquiz_restore_test`) kullanılmalıdır.

### 4.1. İzole Geçici Veritabanı ile Güvenli Test Adımları

1. **İzole Geçici Veritabanı Oluşturma:**
   ```bash
   docker exec -i footquiz-postgres psql -U root -c "CREATE DATABASE footquiz_restore_test;"
   ```

2. **Yedeğin Geçici Veritabanına Yüklenmesi:**
   ```bash
   # Gz sıkıştırmalı yedek için:
   gunzip -c backups/footquiz_backup_YYYYMMDD_HHMMSS.sql.gz | docker exec -i footquiz-postgres psql -U root -d footquiz_restore_test

   # Düz sql yedeği için:
   docker exec -i footquiz-postgres psql -U root -d footquiz_restore_test < backups/footquiz_backup_YYYYMMDD_HHMMSS.sql
   ```

3. **Veri Bütünlüğünün Doğrulanması:**
   ```bash
   docker exec -i footquiz-postgres psql -U root -d footquiz_restore_test -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
   docker exec -i footquiz-postgres psql -U root -d footquiz_restore_test -c "SELECT COUNT(*) FROM \"User\";"
   ```

4. **Geçici Test Veritabanının Temizlenmesi:**
   ```bash
   docker exec -i footquiz-postgres psql -U root -c "DROP DATABASE footquiz_restore_test;"
   ```

### 4.2. Felaket Kurtarma (Disaster Recovery) - Canlı Veritabanı Geri Yükleme

Canlı sistemde tüm veri tabanını yedeğe döndürmek gerektiğinde:
1. Uygulamayı durdurun (bağlantı havuzlarını kapatın):
   ```bash
   # NestJS backend sürecini durdurun
   ```
2. Mevcut veritabanındaki aktif oturumları sonlandırın ve geri yükleyin:
   ```bash
   docker exec -i footquiz-postgres psql -U root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'footquiz' AND pid <> pg_backend_pid();"
   gunzip -c backups/latest_backup.sql.gz | docker exec -i footquiz-postgres psql -U root -d footquiz
   ```
3. Uygulamayı tekrar başlatın ve `/health` endpointi ile servis bütünlüğünü doğrulayın.

---

## 5. Prisma Migration Geri Alma (Rollback) Stratejisi

> [!IMPORTANT]
> Prisma ORM, Rails veya Flyway gibi varsayılan bir `migration down` komutuna sahip değildir. Prisma migration dosyaları (`migration.sql`) tek yönlü (forward-only) çalışır. Bu nedenle geriye alma işlemleri kontrollü operasyonel prosedür gerektirir.

### 5.1. Senaryo A: Yeni Bir "Düzeltme (Revert) Migration"ı Uygulamak (Önerilen)
Canlı veritabanının `_prisma_migrations` tablosunu elle bozmadan, istenmeyen şema değişikliğinin tam tersini yapan yeni bir migration üretilir:
1. `prisma/schema.prisma` dosyasındaki modeli eski haline getirin.
2. Migration oluşturun:
   ```bash
   npx prisma migrate dev --name revert_previous_change
   ```
3. Bu yöntem veri kaybını minimize eder ve migration geçmişini tutarlı tutar.

### 5.2. Senaryo B: Başarısız veya Hatalı Migration'ı Manuel Düzeltme
Bir migration canlıya uygulanırken patlarsa (`failed` durumunda kalırsa):
1. `_prisma_migrations` tablosundaki başarısız kaydı inceleyin:
   ```sql
   SELECT id, migration_name, started_at, finished_at, rolled_back_at FROM _prisma_migrations;
   ```
2. Sorunlu migration tablolarda kısmi değişiklik yaptıysa manuel SQL ile geri alın.
3. Prisma'ya migration'ın çözüldüğünü veya geri alındığını bildirin:
   ```bash
   npx prisma migrate resolve --rolled-back "<migration_name>"
   ```
4. Düzeltilmiş şema ile süreci yeniden başlatın.

