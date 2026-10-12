import { Injectable, BadRequestException, Logger, InternalServerErrorException, OnModuleInit, OnModuleDestroy, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class WalletService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WalletService.name);
  private readonly userLocks = new Map<string, Promise<void>>();
  private readonly matchLocks = new Map<string, Promise<void>>();
  private reconcileInterval?: NodeJS.Timeout;
  
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(RedisService) private readonly redisService?: RedisService,
  ) {}

  onModuleInit() {
    // Sunucu ayağa kalktığında önceki kesintilerden asılı kalmış maçları kurtar
    this.reconcileStaleMatches().catch((err) => {
      this.logger.error(`Initial reconciliation error: ${(err as Error).message}`);
    });

    // 5 dakikalık periyotlarla asılı maçları denetle ve kurtar
    this.reconcileInterval = setInterval(() => {
      this.reconcileStaleMatches().catch((err) => {
        this.logger.error(`Periodic reconciliation error: ${(err as Error).message}`);
      });
    }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
    }
  }

  /**
   * Aynı kullanıcı için eşzamanlı cüzdan işlemlerini sıraya dizer (Race condition koruması).
   */
  private async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    while (this.userLocks.has(userId)) {
      await this.userLocks.get(userId);
    }
    let release!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.userLocks.set(userId, lockPromise);

    try {
      return await fn();
    } finally {
      this.userLocks.delete(userId);
      release();
    }
  }

  /**
   * Aynı maç için eşzamanlı settlement işlemlerini sıraya dizer.
   */
  private async withMatchLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    while (this.matchLocks.has(matchId)) {
      await this.matchLocks.get(matchId);
    }
    let release!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.matchLocks.set(matchId, lockPromise);

    try {
      return await fn();
    } finally {
      this.matchLocks.delete(matchId);
      release();
    }
  }

  /**
   * Oyuncu kuyruğa girerken giriş ücretini bloka (hold) alır ve benzersiz MatchHold kaydı oluşturur.
   */
  async holdEntryFee(
    userId: string,
    amount: number,
    options?: { gameModeId?: string; matchId?: string },
  ): Promise<{ holdId: string } | null> {
    if (amount <= 0) return null;

    return this.withUserLock(userId, async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Çoklu backend (horizontal pod) güvenliği: PostgreSQL satır kilidi (FOR UPDATE)
          if (typeof (tx as any).$queryRaw === 'function') {
            try {
              await (tx as any).$queryRaw`SELECT balance, "heldBalance" FROM "PlayerProfile" WHERE "userId" = ${userId} FOR UPDATE`;
            } catch {
              // Mock veya raw query desteklenmeyen ortamlarda devam et
            }
          }

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

          // Maça/Kuyruğa özel benzersiz MatchHold kaydı oluştur
          const hold = await tx.matchHold.create({
            data: {
              userId,
              amount,
              gameModeId: options?.gameModeId,
              matchId: options?.matchId,
              status: 'HELD',
            },
          });

          this.logger.log(`Held ${amount} coins for user ${userId} (Hold ID: ${hold.id})`);
          return { holdId: hold.id };
        });
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        this.logger.error(`Error holding fee for ${userId}: ${(e as Error).message}`);
        throw new InternalServerErrorException('Cüzdan işlemi başarısız');
      }
    });
  }

  /**
   * Kuyrukta bekleyen oyuncuların hold kayıtlarını oluşan maç ile ilişkilendirir.
   * Explicit holdId verilmişse yalnızca o spesifik hold bağlanır (hold hırsızlığı ve çapraz bağlanma engeli).
   */
  async bindHoldsToMatch(
    players: (string | { userId: string; holdId?: string })[],
    matchId: string,
  ): Promise<void> {
    if (!players.length || !matchId) return;

    // Normalizasyon: Hem string[] hem de { userId, holdId }[] desteklenir
    const normalized = players.map((p) => (typeof p === 'string' ? { userId: p } : p));
    const uniqueByUserId = Array.from(new Map(normalized.map((item) => [item.userId, item])).values());

    await this.withMatchLock(matchId, async () => {
      await this.prisma.$transaction(async (tx) => {
        for (const item of uniqueByUserId) {
          const pid = item.userId;
          const targetHoldId = item.holdId;

          if (targetHoldId) {
            // Açık hold ID eşleştirmesi: Yalnızca bu spesifik hold kaydını bağla
            if (typeof (tx as any).$queryRaw === 'function') {
              try {
                await (tx as any).$queryRaw`SELECT id FROM "MatchHold" WHERE id = ${targetHoldId} AND "userId" = ${pid} AND status = 'HELD' AND "matchId" IS NULL FOR UPDATE`;
              } catch {}
            }

            const hold = await tx.matchHold.findFirst({
              where: { id: targetHoldId, userId: pid, status: 'HELD', matchId: null },
            });
            if (hold && !hold.matchId && hold.status === 'HELD') {
              await tx.matchHold.update({
                where: { id: hold.id },
                data: { matchId },
              });
              this.logger.log(`Bound explicit hold ${hold.id} of user ${pid} to match ${matchId}`);
            }
          } else {
            // Geriye dönük uyumluluk: Hold ID belirtilmemişse kullanıcının serbest hold'unu bağla
            if (typeof (tx as any).$queryRaw === 'function') {
              try {
                await (tx as any).$queryRaw`SELECT id FROM "MatchHold" WHERE "userId" = ${pid} AND status = 'HELD' AND "matchId" IS NULL FOR UPDATE`;
              } catch {}
            }

            const hold = await tx.matchHold.findFirst({
              where: { userId: pid, status: 'HELD', matchId: null },
              orderBy: { createdAt: 'desc' },
            });
            if (hold && !hold.matchId && hold.status === 'HELD') {
              await tx.matchHold.update({
                where: { id: hold.id },
                data: { matchId },
              });
              this.logger.log(`Bound hold ${hold.id} of user ${pid} to match ${matchId}`);
            }
          }
        }
      });
    });
  }

  /**
   * Oyuncu kuyruktan çıkarsa blokedeki ücretini geri verir ve hold kaydını REFUNDED yapar.
   */
  async releaseHold(userId: string, amount: number): Promise<void> {
    if (amount <= 0) return;

    return this.withUserLock(userId, async () => {
      try {
        await this.prisma.$transaction(async (tx) => {
          const profile = await tx.playerProfile.findUnique({
            where: { userId },
            select: { balance: true, heldBalance: true },
          });

          if (!profile || profile.heldBalance < amount) {
            throw new BadRequestException('Serbest bırakılacak yeterli bloke bakiye yok');
          }

          // Kullanıcının henüz maça bağlanmamış en güncel HELD kaydını bul
          const hold = await tx.matchHold.findFirst({
            where: { userId, status: 'HELD', matchId: null },
            orderBy: { createdAt: 'desc' },
          });

          if (!hold) {
            this.logger.warn(`User ${userId} has no unattached HELD record to release`);
            throw new BadRequestException('Serbest bırakılacak aktif kuyruk hold kaydı bulunamadı');
          }

          await tx.matchHold.update({
            where: { id: hold.id },
            data: { status: 'REFUNDED', refundedAt: new Date() },
          });

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
        if (e instanceof BadRequestException) throw e;
        this.logger.error(`Error releasing fee for ${userId}: ${(e as Error).message}`);
        throw new InternalServerErrorException('Cüzdan iadesi başarısız');
      }
    });
  }

  /**
   * Bir maça ait tüm aktif hold kayıtlarını atomik olarak iade eder (PvE moduna geçişte kullanılır).
   */
  async refundMatchHolds(matchId: string): Promise<{ refundedCount: number }> {
    return this.withMatchLock(matchId, async () => {
      return await this.prisma.$transaction(async (tx) => {
        const activeHolds = await tx.matchHold.findMany({
          where: { matchId, status: 'HELD' },
        });

        let refundedCount = 0;
        for (const hold of activeHolds) {
          await tx.matchHold.update({
            where: { id: hold.id },
            data: { status: 'REFUNDED', refundedAt: new Date() },
          });

          const p = await tx.playerProfile.update({
            where: { userId: hold.userId },
            data: {
              balance: { increment: hold.amount },
              heldBalance: { decrement: hold.amount },
            },
          });

          // Ledger iade kaydı ekle (@@unique([userId, type, referenceId]) ile korunur)
          await tx.coinTransaction.create({
            data: {
              userId: hold.userId,
              amount: hold.amount,
              type: 'MATCH_REFUND',
              referenceId: matchId,
              balanceBefore: p.balance - hold.amount,
              balanceAfter: p.balance,
            },
          });
          refundedCount++;
        }

        this.logger.log(`Refunded ${refundedCount} holds for match ${matchId}`);
        return { refundedCount };
      });
    });
  }

  /**
   * Belirli bir hold kaydını atomik olarak iade eder (yalnızca durumu HELD ise).
   * İade yalnızca ilgili hold kaydı üzerinden yapılır; başka bir maçın held bakiyesi kullanılamaz.
   */
  async refundHoldRecord(holdId: string): Promise<boolean> {
    const hold = await this.prisma.matchHold.findUnique({
      where: { id: holdId },
    });

    if (!hold || hold.status !== 'HELD') {
      return false;
    }

    return this.withUserLock(hold.userId, async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const freshHold = await tx.matchHold.findUnique({
            where: { id: holdId },
          });

          if (!freshHold || freshHold.status !== 'HELD') {
            return false;
          }

          const profile = await tx.playerProfile.findUnique({
            where: { userId: freshHold.userId },
            select: { balance: true, heldBalance: true },
          });

          if (!profile || profile.heldBalance < freshHold.amount) {
            return false;
          }

          await tx.matchHold.update({
            where: { id: freshHold.id },
            data: {
              status: 'REFUNDED',
              refundedAt: new Date(),
            },
          });

          const updatedProfile = await tx.playerProfile.update({
            where: { userId: freshHold.userId },
            data: {
              balance: { increment: freshHold.amount },
              heldBalance: { decrement: freshHold.amount },
            },
          });

          try {
            await tx.coinTransaction.create({
              data: {
                userId: freshHold.userId,
                amount: freshHold.amount,
                type: 'MATCH_REFUND',
                referenceId: freshHold.matchId || freshHold.id,
                balanceBefore: updatedProfile.balance - freshHold.amount,
                balanceAfter: updatedProfile.balance,
              },
            });
          } catch (txErr) {
            this.logger.warn(`CoinTransaction duplicate in refundHoldRecord: ${(txErr as Error).message}`);
          }

          this.logger.log(`Safely refunded hold ${holdId} for user ${freshHold.userId}`);
          return true;
        });
      } catch (e) {
        if ((e as Error).message?.includes('P2002')) {
          return false;
        }
        throw e;
      }
    });
  }

  /**
   * Oyuncunun bloke tutarını güvenli, maça özel ve idempotent şekilde iade eder.
   * Eğer maça ait hold zaten serbest bırakılmışsa mükerrer iade yapmadan false döner.
   */
  async refundEntryFee(userId: string, amount: number, matchId?: string): Promise<boolean> {
    if (amount <= 0) return true;

    return this.withUserLock(userId, async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const profile = await tx.playerProfile.findUnique({
            where: { userId },
            select: { balance: true, heldBalance: true },
          });

          if (!profile || profile.heldBalance < amount) {
            this.logger.warn(`User ${userId} does not have sufficient held balance (${profile?.heldBalance ?? 0} < ${amount}) to refund`);
            return false;
          }

          // Maça veya kullanıcıya özel HELD durumundaki hold kaydını ara
          let hold = matchId
            ? await tx.matchHold.findFirst({
                where: { userId, matchId, status: 'HELD' },
              })
            : await tx.matchHold.findFirst({
                where: { userId, status: 'HELD' },
                orderBy: { createdAt: 'desc' },
              });

          if (matchId && !hold) {
            this.logger.warn(`User ${userId} has no active HELD record for match ${matchId}, skipping duplicate refund`);
            return false;
          }

          if (hold) {
            await tx.matchHold.update({
              where: { id: hold.id },
              data: { status: 'REFUNDED', refundedAt: new Date() },
            });
          }

          await tx.playerProfile.update({
            where: { userId },
            data: {
              balance: profile.balance + amount,
              heldBalance: profile.heldBalance - amount,
            },
          });

          // İade ledger kaydı oluştur
          const refId = matchId || hold?.id || 'manual-refund';
          try {
            await tx.coinTransaction.create({
              data: {
                userId,
                amount,
                type: 'MATCH_REFUND',
                referenceId: refId,
                balanceBefore: profile.balance,
                balanceAfter: profile.balance + amount,
              },
            });
          } catch (txErr) {
            this.logger.warn(`CoinTransaction record skipped or duplicate: ${(txErr as Error).message}`);
          }

          this.logger.log(`Safely refunded ${amount} coins for user ${userId} (Match: ${matchId || 'N/A'})`);
          return true;
        });
      } catch (e) {
        this.logger.error(`Error refunding fee for ${userId}: ${(e as Error).message}`);
        throw new InternalServerErrorException('Cüzdan iadesi başarısız');
      }
    });
  }

  /**
   * Maç bittiğinde tüm oyuncuların hold durumlarını günceller ve kazanana ödülü verir.
   * Bu işlem Idempotent'tir (Match.settledAt ile korunur).
   */
  async settleMatch(
    matchId: string,
    winnerId: string,
    entryFee: number,
    allPlayerIds: string[],
    isPvE: boolean = false,
  ): Promise<void> {
    return this.withMatchLock(matchId, async () => {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Idempotency kontrolü
          const match = await tx.match.findUnique({
            where: { id: matchId },
            select: { status: true, settledAt: true },
          });

          if (!match) throw new BadRequestException('Maç bulunamadı');
          if (match.settledAt || match.status === 'SETTLED' || match.status === 'ABORTED') {
            this.logger.warn(`Maç ${matchId} zaten daha önce distribute edilmiş veya iptal edilmiş!`);
            return; // Zaten settle edilmiş
          }

          // Güvenlik katmanı: allPlayerIds içinde bot var mı DB'den doğrula
          const botUsers = await tx.user.findMany({
            where: { id: { in: allPlayerIds }, isBot: true },
            select: { id: true },
          });
          const hasBots = botUsers.length > 0;
          const isPractice = isPvE || hasBots || entryFee <= 0;

          if (isPractice) {
            // PvE / Antrenman Maçı Settlement: Kalan HELD kayıtlarını iade et
            const remainingHolds = await tx.matchHold.findMany({
              where: { matchId, status: 'HELD' },
            });
            for (const h of remainingHolds) {
              await tx.matchHold.update({
                where: { id: h.id },
                data: { status: 'REFUNDED', refundedAt: new Date() },
              });
              const p = await tx.playerProfile.update({
                where: { userId: h.userId },
                data: {
                  balance: { increment: h.amount },
                  heldBalance: { decrement: h.amount },
                },
              });
              try {
                await tx.coinTransaction.create({
                  data: {
                    userId: h.userId,
                    amount: h.amount,
                    type: 'MATCH_REFUND',
                    referenceId: matchId,
                    balanceBefore: p.balance - h.amount,
                    balanceAfter: p.balance,
                  },
                });
              } catch (txErr) {
                this.logger.warn(`CoinTransaction duplicate in practice settlement: ${(txErr as Error).message}`);
              }
            }

            await tx.match.update({
              where: { id: matchId },
              data: {
                status: 'SETTLED',
                settledAt: new Date(),
              },
            });
            this.logger.log(`Match ${matchId} settled as PvE/Practice (0 prize, 0 rating change). Winner: ${winnerId}`);
            return;
          }

          // Rekabetçi (Tamamen gerçek oyunculu) Maç Settlement
          const totalPot = entryFee * allPlayerIds.length;
          const houseFee = Math.floor(totalPot * 0.10); // %10 kesinti
          const prizePool = totalPot - houseFee;

          // 1. Tüm gerçek oyuncuların hold kayıtlarını SETTLED yap ve heldBalance'ı düşür
          const matchHolds = await tx.matchHold.findMany({
            where: { matchId, status: 'HELD' },
          });

          const heldUserIds = new Set<string>();
          for (const h of matchHolds) {
            heldUserIds.add(h.userId);
            await tx.matchHold.update({
              where: { id: h.id },
              data: { status: 'SETTLED', settledAt: new Date() },
            });
            await tx.playerProfile.update({
              where: { userId: h.userId },
              data: { heldBalance: { decrement: h.amount } },
            });
          }

          // MatchHold kaydı bulunamayan oyuncular için geriye uyumlu düşüm
          for (const pid of allPlayerIds) {
            if (!heldUserIds.has(pid)) {
              await tx.playerProfile.update({
                where: { userId: pid },
                data: { heldBalance: { decrement: entryFee } },
              });
            }
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
        if (e instanceof BadRequestException) throw e;
        this.logger.error(`Error settling match ${matchId}: ${(e as Error).message}`);
        throw new InternalServerErrorException('Match settlement failed');
      }
    });
  }

  /**
   * Reconciliation (Kurtarma) Mekanizması:
   * Sunucu çökmesi veya settlement kesintisi sebebiyle asılı kalmış maçları ve kilitli hold kayıtlarını
   * TEK BİR ATOMİK TRANSACTION içinde kurtarır.
   */
  async reconcileStaleMatches(staleMinutes = 15): Promise<{ abortedCount: number; refundedCount: number }> {
    const cutoffMs = Date.now() - staleMinutes * 60 * 1000;
    const cutoff = new Date(cutoffMs);
    let abortedCount = 0;
    let refundedCount = 0;

    const staleMatches = await this.prisma.match.findMany({
      where: {
        status: 'ACTIVE',
        createdAt: { lt: cutoff },
      },
      include: {
        gameMode: { select: { entryFee: true } },
        players: { select: { userId: true } },
      },
    });

    for (const match of staleMatches) {
      try {
        // Canlılık (Liveness / Heartbeat) Kontrolü:
        // Maçın oluşturulma zamanı eski olsa dahi son aktivitesi cutoff'tan yeniyse AKTİFTİR, iptal etme!
        let isStillActive = false;

        // 1. PostgreSQL kalıcı canlılık kontrolü (Redis anahtarı kaybolsa veya Redis restart edilse dahi korur)
        const activeHolds = await this.prisma.matchHold.findMany({
          where: { matchId: match.id, status: 'HELD' },
        });

        if (activeHolds.length > 0) {
          const latestHoldActivity = activeHolds.reduce(
            (max, h) => (h.updatedAt.getTime() > max ? h.updatedAt.getTime() : max),
            match.createdAt.getTime(),
          );
          if (latestHoldActivity > cutoffMs) {
            isStillActive = true;
          }
        }

        // 2. Redis canlılık kontrolü (Hafızadaki güncel oda aktivitesi)
        if (!isStillActive && this.redisService) {
          try {
            const actStr = await this.redisService.get(`match_activity:${match.id}`);
            if (actStr) {
              const actTime = parseInt(actStr, 10);
              if (!isNaN(actTime) && actTime > cutoffMs) {
                isStillActive = true;
              }
            }

            if (!isStillActive) {
              const roomStr = await this.redisService.get(`room:${match.id}`);
              if (roomStr) {
                const roomData = JSON.parse(roomStr);
                const lastAct = roomData.lastActivityAt || roomData.createdAt;
                if (lastAct && lastAct > cutoffMs) {
                  isStillActive = true;
                }
                if (roomData.status === 'QUESTION_ACTIVE' || roomData.status === 'QUESTION_ENDED') {
                  if (roomData.questionEndsAt && roomData.questionEndsAt > cutoffMs) {
                    isStillActive = true;
                  }
                }
              }
            }
          } catch (redisErr) {
            this.logger.warn(`Redis liveness check error for match ${match.id}: ${(redisErr as Error).message}`);
          }
        }

        if (isStillActive) {
          this.logger.log(`[Reconciliation] Match ${match.id} has recent activity within ${staleMinutes}m. Skipping abort.`);
          continue;
        }

        await this.withMatchLock(match.id, async () => {
          await this.prisma.$transaction(async (tx) => {
            const current = await tx.match.findUnique({
              where: { id: match.id },
              select: { status: true, settledAt: true },
            });

            if (!current || current.status === 'SETTLED' || current.settledAt || current.status === 'ABORTED') {
              return;
            }

            // 1. Maçı atomik olarak ABORTED yap
            await tx.match.update({
              where: { id: match.id },
              data: {
                status: 'ABORTED',
                settledAt: new Date(),
              },
            });
            abortedCount++;

            // 2. Bu maça bağlı tüm HELD durumundaki MatchHold kayıtlarını atomik olarak iade et
            const activeHolds = await tx.matchHold.findMany({
              where: { matchId: match.id, status: 'HELD' },
            });

            const refundedUserIds = new Set<string>();
            for (const hold of activeHolds) {
              const user = await tx.user.findUnique({
                where: { id: hold.userId },
                select: { isBot: true },
              });
              if (user?.isBot) continue;

              await tx.matchHold.update({
                where: { id: hold.id },
                data: { status: 'REFUNDED', refundedAt: new Date() },
              });

              const p = await tx.playerProfile.update({
                where: { userId: hold.userId },
                data: {
                  balance: { increment: hold.amount },
                  heldBalance: { decrement: hold.amount },
                },
              });

              // Atomik audit ledger kaydı oluştur (@@unique([userId, type, referenceId]) ile korunur)
              try {
                await tx.coinTransaction.create({
                  data: {
                    userId: hold.userId,
                    amount: hold.amount,
                    type: 'MATCH_REFUND',
                    referenceId: match.id,
                    balanceBefore: p.balance - hold.amount,
                    balanceAfter: p.balance,
                  },
                });
              } catch (txErr) {
                this.logger.warn(`Ledger already exists for user ${hold.userId} on match ${match.id}`);
              }

              refundedUserIds.add(hold.userId);
              refundedCount++;
            }

            // MatchHold kaydı olmayan eski maçlar için geriye uyumlu iade
            const entryFee = match.gameMode?.entryFee || 0;
            if (entryFee > 0 && match.players && activeHolds.length === 0) {
              for (const p of match.players) {
                if (refundedUserIds.has(p.userId)) continue;
                const user = await tx.user.findUnique({
                  where: { id: p.userId },
                  select: { isBot: true },
                });
                if (!user?.isBot) {
                  const profile = await tx.playerProfile.findUnique({
                    where: { userId: p.userId },
                    select: { balance: true, heldBalance: true },
                  });
                  if (profile && profile.heldBalance >= entryFee) {
                    await tx.playerProfile.update({
                      where: { userId: p.userId },
                      data: {
                        balance: { increment: entryFee },
                        heldBalance: { decrement: entryFee },
                      },
                    });
                    try {
                      await tx.coinTransaction.create({
                        data: {
                          userId: p.userId,
                          amount: entryFee,
                          type: 'MATCH_REFUND',
                          referenceId: match.id,
                          balanceBefore: profile.balance,
                          balanceAfter: profile.balance + entryFee,
                        },
                      });
                    } catch {}
                    refundedCount++;
                  }
                }
              }
            }
          });
        });
      } catch (err) {
        this.logger.error(`Failed to reconcile match ${match.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`[Reconciliation] Finished. Aborted: ${abortedCount}, Refunded: ${refundedCount}`);
    return { abortedCount, refundedCount };
  }
}
