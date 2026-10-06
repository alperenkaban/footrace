import { Injectable, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Oyuncu kuyruğa girerken giriş ücretini bloka (hold) alır.
   */
  async holdEntryFee(userId: string, amount: number): Promise<void> {
    if (amount <= 0) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        const profile = await tx.playerProfile.findUnique({
          where: { userId },
          select: { balance: true, heldBalance: true },
        });

        if (!profile || profile.balance < amount) {
          throw new BadRequestException('Bakiye yetersiz');
        }

        await tx.playerProfile.update({
          where: { userId },
          data: {
            balance: profile.balance - amount,
            heldBalance: profile.heldBalance + amount,
          },
        });
      });
      this.logger.log(`Held ${amount} coins for user ${userId}`);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(`Error holding fee for ${userId}: ${(e as Error).message}`);
      throw new InternalServerErrorException('Cüzdan işlemi başarısız');
    }
  }

  /**
   * Oyuncu kuyruktan çıkarsa blokedeki ücretini geri verir.
   */
  async releaseHold(userId: string, amount: number): Promise<void> {
    if (amount <= 0) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        const profile = await tx.playerProfile.findUnique({
          where: { userId },
          select: { balance: true, heldBalance: true },
        });

        if (!profile || profile.heldBalance < amount) {
          throw new BadRequestException('Serbest bırakılacak yeterli bloke bakiye yok');
        }

        await tx.playerProfile.update({
          where: { userId },
          data: {
            balance: profile.balance + amount,
            heldBalance: profile.heldBalance - amount,
          },
        });
      });
      this.logger.log(`Released ${amount} coins for user ${userId}`);
    } catch (e) {
      this.logger.error(`Error releasing fee for ${userId}: ${(e as Error).message}`);
      throw new InternalServerErrorException('Cüzdan iadesi başarısız');
    }
  }

  /**
   * Maç bittiğinde tüm oyuncuların heldBalance'ını düşürür ve kazanana ödülü verir.
   * Bu işlem Idempotent'tir (Match.settledAt ile korunur).
   */
  async settleMatch(matchId: string, winnerId: string, entryFee: number, allPlayerIds: string[]): Promise<void> {
    if (entryFee <= 0) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        // Idempotency kontrolü
        const match = await tx.match.findUnique({
          where: { id: matchId },
          select: { status: true, settledAt: true }
        });

        if (!match) throw new BadRequestException('Maç bulunamadı');
        if (match.settledAt || match.status === 'SETTLED') {
          this.logger.warn(`Maç ${matchId} zaten daha önce distribute edilmiş!`);
          return; // Zaten settle edilmiş
        }

        const totalPot = entryFee * allPlayerIds.length;
        const houseFee = Math.floor(totalPot * 0.10); // %10 kesinti
        const prizePool = totalPot - houseFee;

        // 1. Tüm oyuncuların heldBalance'ından entryFee kadar DÜŞÜR
        for (const pid of allPlayerIds) {
          await tx.playerProfile.update({
            where: { userId: pid },
            data: { heldBalance: { decrement: entryFee } },
          });
        }

        // 2. Kazanana ödülü VER (Bakiye artır ve Rating'i 20 artır)
        const winnerProfile = await tx.playerProfile.update({
          where: { userId: winnerId },
          data: { 
            balance: { increment: prizePool },
            rating: { increment: 20 },
            wins: { increment: 1 },
          },
        });

        // 3. Kazanan için CoinTransaction (Ledger) ekle
        await tx.coinTransaction.create({
          data: {
            userId: winnerId,
            amount: prizePool,
            type: 'MATCH_REWARD',
            referenceId: matchId,
            balanceBefore: winnerProfile.balance - prizePool,
            balanceAfter: winnerProfile.balance,
          },
        });

        // 4. Maçı SETTLED olarak işaretle
        await tx.match.update({
          where: { id: matchId },
          data: {
            status: 'SETTLED',
            settledAt: new Date(),
          },
        });
        
        this.logger.log(`Match ${matchId} settled! Winner ${winnerId} got ${prizePool} coins. House got ${houseFee} coins.`);
      });
    } catch (e) {
      this.logger.error(`Error settling match ${matchId}: ${(e as Error).message}`);
      throw new InternalServerErrorException('Match settlement failed');
    }
  }
}
