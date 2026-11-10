#!/bin/bash
set -e

echo ">>> [Footrace Test Infra] İzole Docker servisleri başlatılıyor..."
docker compose -f docker-compose.test.yml up -d

echo ">>> [Footrace Test Infra] Servislerin hazır olması bekleniyor..."

# Wait for PostgreSQL
until docker exec footquiz-test-postgres pg_isready -U root -d footquiz_test > /dev/null 2>&1; do
  echo "PostgreSQL bekleniyor..."
  sleep 1
done
echo ">>> [Footrace Test Infra] PostgreSQL (port 5434 / footquiz_test) HAZIR!"

# Wait for Redis
until [ "$(docker exec footquiz-test-redis redis-cli ping 2>/dev/null)" = "PONG" ]; do
  echo "Redis bekleniyor..."
  sleep 1
done
echo ">>> [Footrace Test Infra] Redis (port 6380) HAZIR!"

echo ">>> [Footrace Test Infra] Prisma test veritabanı migration'ları uygulanıyor..."
export DATABASE_URL="postgresql://root:rootpassword@localhost:5434/footquiz_test?schema=public"
npx --prefix backend prisma migrate deploy --schema backend/prisma/schema.prisma
npx --prefix backend prisma migrate status --schema backend/prisma/schema.prisma

echo "=============================================================================="
echo ">>> [Footrace Test Infra] TEBRİKLER! İzole test ortamı başarıyla hazırlandı."
echo "=============================================================================="
