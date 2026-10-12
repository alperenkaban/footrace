-- P0 Ekonomi Güvenliği ve Atomik İade Migration
-- 1. Eski CoinTransaction tekil kısıtını kaldır (aynı maçta çoklu oyuncu kayıtlarına izin ver)
DROP INDEX IF EXISTS "CoinTransaction_type_referenceId_key";

-- 2. Yeni kullanıcı bazlı tekil kısıtı ekle (aynı oyuncu için mükerrer işlem engeli)
CREATE UNIQUE INDEX "CoinTransaction_userId_type_referenceId_key" ON "CoinTransaction"("userId", "type", "referenceId");

-- 3. Maça özel MatchHold tablosunu oluştur
CREATE TABLE "MatchHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT,
    "gameModeId" TEXT,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "MatchHold_pkey" PRIMARY KEY ("id")
);

-- 4. İndeksler ve Yabancı Anahtarlar (Foreign Keys)
CREATE INDEX "MatchHold_userId_status_idx" ON "MatchHold"("userId", "status");
CREATE INDEX "MatchHold_matchId_status_idx" ON "MatchHold"("matchId", "status");

ALTER TABLE "MatchHold" ADD CONSTRAINT "MatchHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchHold" ADD CONSTRAINT "MatchHold_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
