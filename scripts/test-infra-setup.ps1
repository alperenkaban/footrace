# ==============================================================================
# Footrace İzole Test Ortamı Kurulum ve Doğrulama Betiği
# ==============================================================================

Write-Host ">>> [Footrace Test Infra] İzole Docker servisleri başlatılıyor..." -ForegroundColor Cyan

docker compose -f docker-compose.test.yml up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "HATA: Docker Compose test konteynerleri başlatılamadı!" -ForegroundColor Red
    exit 1
}

Write-Host ">>> [Footrace Test Infra] Servislerin hazır olması bekleniyor..." -ForegroundColor Cyan

# Test PostgreSQL hazır olana kadar bekle (max 30 sn)
$attempts = 0
$pgReady = $false
while ($attempts -lt 30) {
    docker exec footquiz-test-postgres pg_isready -U root -d footquiz_test 2>$null
    if ($LASTEXITCODE -eq 0) {
        $pgReady = $true
        break
    }
    Start-Sleep -Seconds 1
    $attempts++
}

if (-not $pgReady) {
    Write-Host "HATA: footquiz-test-postgres servisine ulaşılamadı!" -ForegroundColor Red
    exit 1
}
Write-Host ">>> [Footrace Test Infra] PostgreSQL (port 5434 / footquiz_test) HAZIR!" -ForegroundColor Green

# Test Redis hazır olana kadar bekle (max 15 sn)
$attempts = 0
$redisReady = $false
while ($attempts -lt 15) {
    docker exec footquiz-test-redis redis-cli ping 2>$null | Select-String "PONG" -Quiet
    if ($?) {
        $redisReady = $true
        break
    }
    Start-Sleep -Seconds 1
    $attempts++
}

if (-not $redisReady) {
    Write-Host "HATA: footquiz-test-redis servisine ulaşılamadı!" -ForegroundColor Red
    exit 1
}
Write-Host ">>> [Footrace Test Infra] Redis (port 6380) HAZIR!" -ForegroundColor Green

# Prisma Migration'larını uygula
Write-Host ">>> [Footrace Test Infra] Prisma test veritabanı migration'ları uygulanıyor..." -ForegroundColor Cyan
$env:DATABASE_URL = "postgresql://root:rootpassword@localhost:5434/footquiz_test?schema=public"
npx --prefix backend prisma migrate deploy --schema backend/prisma/schema.prisma

if ($LASTEXITCODE -ne 0) {
    Write-Host "HATA: Test veritabanı migration'ları uygulanamadı!" -ForegroundColor Red
    exit 1
}

Write-Host ">>> [Footrace Test Infra] Migration durumu kontrol ediliyor..." -ForegroundColor Cyan
npx --prefix backend prisma migrate status --schema backend/prisma/schema.prisma

Write-Host "==============================================================================" -ForegroundColor Green
Write-Host ">>> [Footrace Test Infra] TEBRİKLER! İzole test ortamı başarıyla hazırlandı." -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Green
