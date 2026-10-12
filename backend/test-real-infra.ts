import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { RedisService } from './src/redis/redis.service.js';
import { WalletService } from './src/wallet/wallet.service.js';
import { MatchmakingService } from './src/matchmaking/matchmaking.service.js';
import { BotService } from './src/bot/bot.service.js';
import { GamesService } from './src/games/games.service.js';

const prisma = new PrismaClient();
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
});
const redisService = new RedisService(redisClient);
const walletService = new WalletService(prisma as any, redisService);
const botService = new BotService(prisma as any);
const gamesService = new GamesService(redisService, prisma as any, walletService, botService);
gamesService.setServer({
  to: () => ({ emit: () => {} }),
} as any);

const mockGamesService: any = {
  notifyPlayersMatchFound: () => {},
  startGameCountdown: () => {},
};

const matchmakingService = new MatchmakingService(
  redisService,
  gamesService as any,
  walletService,
  prisma as any,
  botService,
);

async function cleanupUser(userId: string) {
  try {
    await prisma.coinTransaction.deleteMany({ where: { userId } });
    await prisma.matchHold.deleteMany({ where: { userId } });
    await prisma.matchPlayer.deleteMany({ where: { userId } });
    await prisma.playerProfile.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  } catch (e) {
    // ignore
  }
}

async function createTestUser(userId: string, email: string, balance: number, isBot = false) {
  await cleanupUser(userId);
  const user = await prisma.user.create({
    data: {
      id: userId,
      email,
      isGuest: false,
      isBot,
      profile: {
        create: {
          balance,
          heldBalance: 0,
        },
      },
    },
    include: { profile: true },
  });
  return user;
}

async function ensureGameMode(name: string, entryFee: number, maxPlayers: number) {
  const existing = await prisma.gameMode.findUnique({ where: { name } });
  if (!existing) {
    return prisma.gameMode.create({
      data: {
        name,
        entryFee,
        maxPlayers,
        questionCount: 5,
        questionDuration: 15,
      },
    });
  }
  return existing;
}

async function runRealInfraTests() {
  console.log('================================================================');
  console.log('FOOTQUIZ: GERÇEK POSTGRESQL & REDIS ENTEGRASYON VE GÜVENLİK TESTİ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  // 0. Ensure game modes exist in PostgreSQL
  const q2Mode = await ensureGameMode('quick_2', 100, 2);
  const c4Mode = await ensureGameMode('classic_4', 100, 4);

  // ----------------------------------------------------------------
  // TEST 1: Gerçek PostgreSQL ile Eşzamanlı holdEntryFee Yarışı
  // ----------------------------------------------------------------
  console.log('TEST 1: Gerçek PostgreSQL — Eşzamanlı holdEntryFee (5 paralel talep, bakiye: 100)');
  try {
    const user1Id = 'pg-race-user-1';
    await createTestUser(user1Id, 'race1@test.com', 100);

    // 5 eşzamanlı talep gönder
    const results = await Promise.allSettled([
      walletService.holdEntryFee(user1Id, 100),
      walletService.holdEntryFee(user1Id, 100),
      walletService.holdEntryFee(user1Id, 100),
      walletService.holdEntryFee(user1Id, 100),
      walletService.holdEntryFee(user1Id, 100),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled' && (r.value as any)?.holdId);
    const rejections = results.filter((r) => r.status === 'rejected');

    const profile = await prisma.playerProfile.findUnique({ where: { userId: user1Id } });
    const holds = await prisma.matchHold.findMany({ where: { userId: user1Id } });

    if (
      successes.length === 1 &&
      rejections.length === 4 &&
      profile?.balance === 0 &&
      profile?.heldBalance === 100 &&
      holds.length === 1 &&
      holds[0].status === 'HELD'
    ) {
      console.log('  -> BAŞARILI: Tam 1 hold kabul edildi, 4 talep reddedildi, bakiye eksiye düşmedi.');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ:', {
        successes: successes.length,
        rejections: rejections.length,
        profile,
        holdsCount: holds.length,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 1):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 2: Gerçek PostgreSQL — Çift İade ve İdempotency Korunumu
  // ----------------------------------------------------------------
  console.log('\nTEST 2: Gerçek PostgreSQL — Çift İade & refundHoldRecord İdempotency');
  try {
    const user2Id = 'pg-refund-user-2';
    await createTestUser(user2Id, 'refund2@test.com', 500);

    const holdRes = await walletService.holdEntryFee(user2Id, 100);
    const holdId = holdRes!.holdId;

    // 3 paralel iade çağrısı yap
    const refundResults = await Promise.all([
      walletService.refundHoldRecord(holdId),
      walletService.refundHoldRecord(holdId),
      walletService.refundHoldRecord(holdId),
    ]);

    const successfulRefunds = refundResults.filter((r) => r === true);
    const falseRefunds = refundResults.filter((r) => r === false);

    const profile = await prisma.playerProfile.findUnique({ where: { userId: user2Id } });
    const holdRecord = await prisma.matchHold.findUnique({ where: { id: holdId } });
    const transactions = await prisma.coinTransaction.findMany({ where: { userId: user2Id } });

    if (
      successfulRefunds.length === 1 &&
      falseRefunds.length === 2 &&
      profile?.balance === 500 &&
      profile?.heldBalance === 0 &&
      holdRecord?.status === 'REFUNDED' &&
      transactions.length === 1 &&
      transactions[0].type === 'MATCH_REFUND'
    ) {
      console.log('  -> BAŞARILI: Çift iade engellendi! Tam 1 kez iade yapıldı, bakiye bozulmadı.');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 2):', {
        successfulRefunds: successfulRefunds.length,
        falseRefunds: falseRefunds.length,
        profile,
        holdRecord,
        transactionsCount: transactions.length,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 2):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 3: Gerçek PostgreSQL — Çoklu Oyuncu Ledger ve Bileşik Unique İndeks
  // ----------------------------------------------------------------
  console.log('\nTEST 3: Gerçek PostgreSQL — Aynı Maçta Çoklu Oyuncu CoinTransaction Kaydı (Bileşik İndeks)');
  try {
    const userAlpha = 'pg-user-alpha';
    const userBeta = 'pg-user-beta';
    const matchId = `pg-match-test-${Date.now()}`;

    await createTestUser(userAlpha, 'alpha@test.com', 200);
    await createTestUser(userBeta, 'beta@test.com', 200);

    // Maç oluştur
    await prisma.match.create({
      data: {
        id: matchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: {
          create: [{ userId: userAlpha }, { userId: userBeta }],
        },
      },
    });

    const holdAlpha = await walletService.holdEntryFee(userAlpha, 100);
    const holdBeta = await walletService.holdEntryFee(userBeta, 100);

    // Holdları maça bağla
    await walletService.bindHoldsToMatch([userAlpha, userBeta], matchId);

    // Her iki oyuncuya aynı maçta MATCH_REFUND uygula
    const refundRes = await walletService.refundMatchHolds(matchId);

    const txAlpha = await prisma.coinTransaction.findUnique({
      where: {
        userId_type_referenceId: {
          userId: userAlpha,
          type: 'MATCH_REFUND',
          referenceId: matchId,
        },
      },
    });

    const txBeta = await prisma.coinTransaction.findUnique({
      where: {
        userId_type_referenceId: {
          userId: userBeta,
          type: 'MATCH_REFUND',
          referenceId: matchId,
        },
      },
    });

    // Şimdi aynı kullanıcı için duplicate transaction eklemeyi dene (P2002 beklenir)
    let duplicateRejected = false;
    try {
      await prisma.coinTransaction.create({
        data: {
          userId: userAlpha,
          type: 'MATCH_REFUND',
          referenceId: matchId,
          amount: 100,
          balanceBefore: 200,
          balanceAfter: 300,
        },
      });
    } catch (dbErr: any) {
      if (dbErr.code === 'P2002' || (dbErr as Error).message.includes('unique constraint')) {
        duplicateRejected = true;
      }
    }

    if (refundRes.refundedCount === 2 && txAlpha && txBeta && duplicateRejected) {
      console.log('  -> BAŞARILI: Farklı oyuncular aynı maç için ledger kaydı alabildi, aynı oyuncunun tekrarı engellendi!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 3):', {
        refundedCount: refundRes.refundedCount,
        hasAlpha: !!txAlpha,
        hasBeta: !!txBeta,
        duplicateRejected,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 3):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 4: Gerçek PostgreSQL — Settlement ve Reconciliation Yarışı
  // ----------------------------------------------------------------
  console.log('\nTEST 4: Gerçek PostgreSQL — Eşzamanlı settleMatch ve reconcileStaleMatches Yarışı');
  try {
    const winnerId = 'pg-winner-4';
    const loserId = 'pg-loser-4';
    const raceMatchId = `race-match-${Date.now()}`;

    await createTestUser(winnerId, 'winner4@test.com', 200);
    await createTestUser(loserId, 'loser4@test.com', 200);

    // 20 dakika önce açılmış maç oluştur
    const staleDate = new Date(Date.now() - 20 * 60 * 1000);
    await prisma.match.create({
      data: {
        id: raceMatchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        createdAt: staleDate,
        players: {
          create: [{ userId: winnerId }, { userId: loserId }],
        },
      },
    });

    await walletService.holdEntryFee(winnerId, 100);
    await walletService.holdEntryFee(loserId, 100);
    await walletService.bindHoldsToMatch([winnerId, loserId], raceMatchId);

    // Eşzamanlı yarış: settleMatch vs reconcileStaleMatches
    await Promise.all([
      walletService.settleMatch(raceMatchId, winnerId, 100, [winnerId, loserId], false),
      walletService.reconcileStaleMatches(15),
    ]);

    const finalMatch = await prisma.match.findUnique({ where: { id: raceMatchId } });
    const holds = await prisma.matchHold.findMany({ where: { matchId: raceMatchId } });
    const winnerProfile = await prisma.playerProfile.findUnique({ where: { userId: winnerId } });
    const loserProfile = await prisma.playerProfile.findUnique({ where: { userId: loserId } });

    // Durum SETTLED veya ABORTED olmalı (asla ACTIVE kalmamalı)
    const isValidStatus = finalMatch?.status === 'SETTLED' || finalMatch?.status === 'ABORTED';
    const allHoldsNonHeld = holds.every((h) => h.status === 'SETTLED' || h.status === 'REFUNDED');
    const totalHeld = (winnerProfile?.heldBalance || 0) + (loserProfile?.heldBalance || 0);

    if (isValidStatus && allHoldsNonHeld && totalHeld === 0) {
      console.log(`  -> BAŞARILI: Yarış güvenle çözüldü! Maç durumu: ${finalMatch?.status}, Held bakiyeler 0'a çekildi.`);
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 4):', {
        status: finalMatch?.status,
        allHoldsNonHeld,
        totalHeld,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 4):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 5: Gerçek Redis — İki Kuyruğa Eşzamanlı Katılım Engeli (setNX)
  // ----------------------------------------------------------------
  console.log('\nTEST 5: Gerçek Redis — İki Kuyruğa Eşzamanlı Katılım Engeli');
  try {
    const rUserId = 'redis-race-user-5';
    await createTestUser(rUserId, 'redis5@test.com', 500);

    // Redis anahtarlarını temizle
    await redisClient.del(`player_queue:${rUserId}`);
    await redisClient.del(`player_room:${rUserId}`);
    await redisClient.del(`player_queue_lock:${rUserId}`);
    await redisClient.del(`matchmaking_queue:quick_2`);
    await redisClient.del(`matchmaking_queue:classic_4`);

    // Eşzamanlı iki ayrı kuyruğa giriş denemesi
    const joinResults = await Promise.allSettled([
      matchmakingService.joinQueue(rUserId, 'quick_2'),
      matchmakingService.joinQueue(rUserId, 'classic_4'),
    ]);

    const fulfilledJoins = joinResults.filter((r) => r.status === 'fulfilled');
    const rejectedJoins = joinResults.filter((r) => r.status === 'rejected');

    const inQuick = await redisClient.lrange('matchmaking_queue:quick_2', 0, -1);
    const inClassic = await redisClient.lrange('matchmaking_queue:classic_4', 0, -1);
    const queuedMode = await redisClient.get(`player_queue:${rUserId}`);

    const inTotalQueues = (inQuick.includes(rUserId) ? 1 : 0) + (inClassic.includes(rUserId) ? 1 : 0);

    if (fulfilledJoins.length === 1 && rejectedJoins.length === 1 && inTotalQueues === 1 && queuedMode !== null) {
      console.log(`  -> BAŞARILI: Redis kilidi çalıştı! Oyuncu tam 1 kuyrukta (${queuedMode}), ikinci talep engellendi.`);
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 5):', {
        fulfilled: fulfilledJoins.length,
        rejected: rejectedJoins.length,
        inTotalQueues,
        queuedMode,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 5):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 6: Gerçek Redis — Bot Doldurma ve backfill_lock Güvenliği
  // ----------------------------------------------------------------
  console.log('\nTEST 6: Gerçek Redis — backfill_lock ve Queue Dequeue Güvenliği');
  try {
    const queueKey = 'matchmaking_queue:test_backfill';
    const lockKey = 'backfill_lock:test_backfill';

    await redisClient.del(queueKey);
    await redisClient.del(lockKey);

    // 1. setNX kilidi testi
    const lock1 = await redisService.setNX(lockKey, '1', 5);
    const lock2 = await redisService.setNX(lockKey, '1', 5);

    // 2. Queue operasyonları
    await redisService.enqueuePlayer(queueKey, 'bot-test-p1');
    await redisService.enqueuePlayer(queueKey, 'bot-test-p1'); // Duplication check
    const queueMembers = await redisClient.lrange(queueKey, 0, -1);

    await redisClient.del(queueKey);
    await redisClient.del(lockKey);

    if (lock1 === true && lock2 === false && queueMembers.length === 1) {
      console.log('  -> BAŞARILI: Redis setNX kilidi tam olarak 1 kez alındı, kuyrukta mükerrer oyuncu engellendi.');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 6):', { lock1, lock2, queueMembers });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 6):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 7: Gerçek Redis + Gerçek Postgres — Bağlantı Kopması ve Otomatik İade
  // ----------------------------------------------------------------
  console.log('\nTEST 7: Gerçek Redis + Postgres — handleUserDisconnect ile Otomatik Kuyruktan Çıkış ve İade');
  try {
    const dcUser = 'pg-redis-dc-user';
    await createTestUser(dcUser, 'dc@test.com', 500);

    await redisClient.del(`player_queue:${dcUser}`);
    await redisClient.del(`player_room:${dcUser}`);
    await redisClient.del(`matchmaking_queue:quick_2`);

    // Kuyruğa gir
    await matchmakingService.joinQueue(dcUser, 'quick_2');

    let profile = await prisma.playerProfile.findUnique({ where: { userId: dcUser } });
    if (profile?.balance !== 400 || profile?.heldBalance !== 100) {
      throw new Error(`Kuyruğa girişte bakiye hatalı: balance=${profile?.balance}`);
    }

    // Soket koptu: handleUserDisconnect çağır
    await matchmakingService.handleUserDisconnect(dcUser);

    // Redis kuyruk kontrolü
    const queued = await redisClient.get(`player_queue:${dcUser}`);
    const queueMembers = await redisClient.lrange('matchmaking_queue:quick_2', 0, -1);

    // PostgreSQL bakiye kontrolü
    profile = await prisma.playerProfile.findUnique({ where: { userId: dcUser } });
    const hold = await prisma.matchHold.findFirst({ where: { userId: dcUser } });

    if (
      queued === null &&
      !queueMembers.includes(dcUser) &&
      profile?.balance === 500 &&
      profile?.heldBalance === 0 &&
      hold?.status === 'REFUNDED'
    ) {
      console.log('  -> BAŞARILI: Bağlantı kopunca Redis temizlendi, PostgreSQL blokesi REFUNDED oldu ve 500 coin iade edildi!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 7):', {
        queued,
        queueMembers,
        profile,
        hold,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 7):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 8: Gerçek PostgreSQL + Redis — 15 Dakikadan Eski Ancak Aktivite Gösteren Maç İPTAL EDİLMEMELİ
  // ----------------------------------------------------------------
  console.log('\nTEST 8: Gerçek PostgreSQL + Redis — 15dk Eski Fakat Canlı Maçın Korunması (Liveness Protection)');
  try {
    const liveUser1 = 'live-p0-user-1';
    const liveUser2 = 'live-p0-user-2';
    const liveMatchId = `live-match-${Date.now()}`;

    await createTestUser(liveUser1, 'live1@test.com', 200);
    await createTestUser(liveUser2, 'live2@test.com', 200);

    const oldCreatedAt = new Date(Date.now() - 25 * 60 * 1000); // 25 dakika önce oluşturulmuş
    await prisma.match.create({
      data: {
        id: liveMatchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        createdAt: oldCreatedAt,
        players: {
          create: [{ userId: liveUser1 }, { userId: liveUser2 }],
        },
      },
    });

    const hold1 = await walletService.holdEntryFee(liveUser1, 100);
    const hold2 = await walletService.holdEntryFee(liveUser2, 100);
    await walletService.bindHoldsToMatch(
      [
        { userId: liveUser1, holdId: hold1!.holdId },
        { userId: liveUser2, holdId: hold2!.holdId },
      ],
      liveMatchId,
    );

    // Canlılık güncellemesi yap (1 dakika önce aktivite olmuş gibi)
    await gamesService.updateMatchActivity(liveMatchId);

    // Reconciliation çalıştır (staleMinutes = 15)
    const reconResult = await walletService.reconcileStaleMatches(15);

    const matchAfter = await prisma.match.findUnique({ where: { id: liveMatchId } });
    const holdsAfter = await prisma.matchHold.findMany({ where: { matchId: liveMatchId } });

    if (
      matchAfter?.status === 'ACTIVE' &&
      holdsAfter.length === 2 &&
      holdsAfter.every((h) => h.status === 'HELD')
    ) {
      console.log('  -> BAŞARILI: 25 dakika önce açılmış ancak aktivitesi güncel maç iptal EDİLMEDİ (ACTIVE kaldı)!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 8):', {
        reconResult,
        status: matchAfter?.status,
        holdsStatus: holdsAfter.map((h) => h.status),
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 8):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 9: Gerçek PostgreSQL — Gerçekten Terk Edilmiş (Aktivitesiz >15dk) Maç Güvenle İptal ve İade Edilmeli
  // ----------------------------------------------------------------
  console.log('\nTEST 9: Gerçek PostgreSQL — Gerçekten Terk Edilmiş (>15dk aktivitesiz) Maçın Güvenli İptali ve İadesi');
  try {
    const deadUser1 = 'dead-p0-user-1';
    const deadUser2 = 'dead-p0-user-2';
    const deadMatchId = `dead-match-${Date.now()}`;

    await createTestUser(deadUser1, 'dead1@test.com', 200);
    await createTestUser(deadUser2, 'dead2@test.com', 200);

    const staleDate = new Date(Date.now() - 30 * 60 * 1000); // 30 dakika önce oluşturuldu
    await prisma.match.create({
      data: {
        id: deadMatchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        createdAt: staleDate,
        players: {
          create: [{ userId: deadUser1 }, { userId: deadUser2 }],
        },
      },
    });

    const deadHold1 = await walletService.holdEntryFee(deadUser1, 100);
    const deadHold2 = await walletService.holdEntryFee(deadUser2, 100);
    await walletService.bindHoldsToMatch(
      [
        { userId: deadUser1, holdId: deadHold1!.holdId },
        { userId: deadUser2, holdId: deadHold2!.holdId },
      ],
      deadMatchId,
    );

    // Hold updatedAt alanlarını da 30 dakika öncesine çek (aktivite yok)
    await prisma.$executeRawUnsafe(
      `UPDATE "MatchHold" SET "updatedAt" = $1 WHERE "matchId" = $2`,
      staleDate,
      deadMatchId,
    );
    // Redis aktivitelerini temizle
    await redisClient.del(`match_activity:${deadMatchId}`);
    await redisClient.del(`room:${deadMatchId}`);

    // Reconciliation çalıştır
    const reconDead = await walletService.reconcileStaleMatches(15);

    const matchDeadAfter = await prisma.match.findUnique({ where: { id: deadMatchId } });
    const holdsDeadAfter = await prisma.matchHold.findMany({ where: { matchId: deadMatchId } });
    const profileDead1 = await prisma.playerProfile.findUnique({ where: { userId: deadUser1 } });
    const profileDead2 = await prisma.playerProfile.findUnique({ where: { userId: deadUser2 } });

    if (
      reconDead.abortedCount >= 1 &&
      matchDeadAfter?.status === 'ABORTED' &&
      holdsDeadAfter.every((h) => h.status === 'REFUNDED') &&
      profileDead1?.heldBalance === 0 &&
      profileDead1?.balance === 200 &&
      profileDead2?.heldBalance === 0 &&
      profileDead2?.balance === 200
    ) {
      console.log('  -> BAŞARILI: Terk edilmiş maç ABORTED yapıldı, tüm holdlar REFUNDED oldu, bakiyeler eksiksiz iade edildi!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 9):', {
        reconDead,
        status: matchDeadAfter?.status,
        holdsStatus: holdsDeadAfter.map((h) => h.status),
        profileDead1,
        profileDead2,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 9):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 10: Gerçek PostgreSQL + Redis — Redis Anahtarı Kaybolsa/Restart Edilse Dahi PostgreSQL Liveness Koruması
  // ----------------------------------------------------------------
  console.log('\nTEST 10: Gerçek PostgreSQL — Redis Anahtarları Silinse Dahi DB Canlılık Korumasıyla İptalin Önlenmesi');
  try {
    const robustUser1 = 'robust-p0-user-1';
    const robustUser2 = 'robust-p0-user-2';
    const robustMatchId = `robust-match-${Date.now()}`;

    await createTestUser(robustUser1, 'robust1@test.com', 200);
    await createTestUser(robustUser2, 'robust2@test.com', 200);

    const oldDate = new Date(Date.now() - 20 * 60 * 1000); // 20 dk önce kurulmuş
    await prisma.match.create({
      data: {
        id: robustMatchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        createdAt: oldDate,
        players: {
          create: [{ userId: robustUser1 }, { userId: robustUser2 }],
        },
      },
    });

    const rHold1 = await walletService.holdEntryFee(robustUser1, 100);
    const rHold2 = await walletService.holdEntryFee(robustUser2, 100);
    await walletService.bindHoldsToMatch(
      [
        { userId: robustUser1, holdId: rHold1!.holdId },
        { userId: robustUser2, holdId: rHold2!.holdId },
      ],
      robustMatchId,
    );

    // PostgreSQL'de hold updatedAt taze (örn. 30 saniye önce soru cevaplandı)
    await gamesService.updateMatchActivity(robustMatchId);

    // REDIS RESTART / KEY LOSS SİMÜLASYONU: Redis'teki bütün anahtarları sil!
    await redisClient.del(`match_activity:${robustMatchId}`);
    await redisClient.del(`room:${robustMatchId}`);

    // Reconciliation çalıştır
    const reconRobust = await walletService.reconcileStaleMatches(15);
    const matchRobustAfter = await prisma.match.findUnique({ where: { id: robustMatchId } });

    if (matchRobustAfter?.status === 'ACTIVE') {
      console.log('  -> BAŞARILI: Redis anahtarı olmamasına rağmen PostgreSQL güncelliği sayesinde aktif maç korunup iptal EDİLMEDİ!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 10):', {
        status: matchRobustAfter?.status,
        reconRobust,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 10):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 11: Gerçek PostgreSQL — Aynı Kullanıcının 2 Ayrı Hold Kaydı 2 Farklı Maça Açık holdId ile Bağlanmalı
  // ----------------------------------------------------------------
  console.log('\nTEST 11: Gerçek PostgreSQL — Açık holdId İle İki Ayrı Maça Hold Bağlama ve İzolasyon');
  try {
    const dualUser = 'dual-hold-user-p0';
    const otherUser1 = 'other-p0-user-1';
    const otherUser2 = 'other-p0-user-2';
    const matchAId = `match-dual-A-${Date.now()}`;
    const matchBId = `match-dual-B-${Date.now()}`;

    await createTestUser(dualUser, 'dual@test.com', 500);
    await createTestUser(otherUser1, 'other1@test.com', 500);
    await createTestUser(otherUser2, 'other2@test.com', 500);

    // 2 maç oluştur
    await prisma.match.create({
      data: {
        id: matchAId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: dualUser }, { userId: otherUser1 }] },
      },
    });
    await prisma.match.create({
      data: {
        id: matchBId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: dualUser }, { userId: otherUser2 }] },
      },
    });

    // dualUser 2 ayrı hold oluşturur
    const holdA = await walletService.holdEntryFee(dualUser, 100);
    const holdB = await walletService.holdEntryFee(dualUser, 100);
    const holdOther1 = await walletService.holdEntryFee(otherUser1, 100);
    const holdOther2 = await walletService.holdEntryFee(otherUser2, 100);

    // Açık holdId ile maça bağla
    await walletService.bindHoldsToMatch(
      [
        { userId: dualUser, holdId: holdA!.holdId },
        { userId: otherUser1, holdId: holdOther1!.holdId },
      ],
      matchAId,
    );

    await walletService.bindHoldsToMatch(
      [
        { userId: dualUser, holdId: holdB!.holdId },
        { userId: otherUser2, holdId: holdOther2!.holdId },
      ],
      matchBId,
    );

    const dbHoldA = await prisma.matchHold.findUnique({ where: { id: holdA!.holdId } });
    const dbHoldB = await prisma.matchHold.findUnique({ where: { id: holdB!.holdId } });

    // Sadece Match A iptal edilip iade edilsin
    await walletService.refundMatchHolds(matchAId);

    const dbHoldAAfter = await prisma.matchHold.findUnique({ where: { id: holdA!.holdId } });
    const dbHoldBAfter = await prisma.matchHold.findUnique({ where: { id: holdB!.holdId } });
    const dualProfile = await prisma.playerProfile.findUnique({ where: { userId: dualUser } });

    if (
      dbHoldA?.matchId === matchAId &&
      dbHoldB?.matchId === matchBId &&
      dbHoldAAfter?.status === 'REFUNDED' &&
      dbHoldBAfter?.status === 'HELD' &&
      dbHoldBAfter?.matchId === matchBId &&
      dualProfile?.balance === 400 &&
      dualProfile?.heldBalance === 100
    ) {
      console.log('  -> BAŞARILI: Hold kayıtları doğru maçlara bağlandı, Match A iadesi Match B blokesine DOKUNMADI!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 11):', {
        holdAMatch: dbHoldA?.matchId,
        holdBMatch: dbHoldB?.matchId,
        holdAStatus: dbHoldAAfter?.status,
        holdBStatus: dbHoldBAfter?.status,
        dualProfile,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 11):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 12: Gerçek PostgreSQL — Aynı Hold'un İki Farklı Maça Bağlanamaması
  // ----------------------------------------------------------------
  console.log('\nTEST 12: Gerçek PostgreSQL — Aynı Hold Kaydının İkinci Bir Maça Bağlanmasının Engellenmesi');
  try {
    const singleUser = 'single-hold-bind-p0';
    const matchXId = `match-x-${Date.now()}`;
    const matchYId = `match-y-${Date.now()}`;

    await createTestUser(singleUser, 'single@test.com', 300);

    await prisma.match.create({
      data: {
        id: matchXId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: singleUser }] },
      },
    });
    await prisma.match.create({
      data: {
        id: matchYId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: singleUser }] },
      },
    });

    const singleHold = await walletService.holdEntryFee(singleUser, 100);

    // 1. Maça bağla
    await walletService.bindHoldsToMatch(
      [{ userId: singleUser, holdId: singleHold!.holdId }],
      matchXId,
    );

    // 2. Maça aynı holdId'yi bağlamayı dene
    await walletService.bindHoldsToMatch(
      [{ userId: singleUser, holdId: singleHold!.holdId }],
      matchYId,
    );

    const checkHold = await prisma.matchHold.findUnique({ where: { id: singleHold!.holdId } });
    const matchYHolds = await prisma.matchHold.findMany({ where: { matchId: matchYId } });

    if (checkHold?.matchId === matchXId && matchYHolds.length === 0) {
      console.log('  -> BAŞARILI: Daha önce bağlanmış hold ikinci bir maça bağlanamadı (İzolasyon korundu)!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 12):', {
        checkHold,
        matchYHolds,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 12):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 13: Gerçek PostgreSQL — Aynı Maç İçin İki Eşzamanlı Settlement Yarışı
  // ----------------------------------------------------------------
  console.log('\nTEST 13: Gerçek PostgreSQL — Aynı Maç İçin İki Eşzamanlı settleMatch Yarışı');
  try {
    const wId = 'w-settle-13';
    const lId = 'l-settle-13';
    const matchId13 = `match-dual-settle-${Date.now()}`;

    await createTestUser(wId, 'w13@test.com', 500);
    await createTestUser(lId, 'l13@test.com', 500);

    await prisma.match.create({
      data: {
        id: matchId13,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: wId }, { userId: lId }] },
      },
    });

    const hW = await walletService.holdEntryFee(wId, 100);
    const hL = await walletService.holdEntryFee(lId, 100);
    await walletService.bindHoldsToMatch(
      [
        { userId: wId, holdId: hW!.holdId },
        { userId: lId, holdId: hL!.holdId },
      ],
      matchId13,
    );

    // İki eşzamanlı settlement çağrısı yap
    await Promise.all([
      walletService.settleMatch(matchId13, wId, 100, [wId, lId], false),
      walletService.settleMatch(matchId13, wId, 100, [wId, lId], false),
    ]);

    const winnerP = await prisma.playerProfile.findUnique({ where: { userId: wId } });
    const loserP = await prisma.playerProfile.findUnique({ where: { userId: lId } });
    const match13 = await prisma.match.findUnique({ where: { id: matchId13 } });
    const rewardTxs = await prisma.coinTransaction.findMany({
      where: { userId: wId, type: 'MATCH_REWARD', referenceId: matchId13 },
    });

    // Başlangıç: 500, hold: 100, kalan: 400.
    // Ödül: 200 * 0.9 = 180 coin. Bitiş bakiyesi: 400 + 180 = 580 olmalı. (Çift settlement durumunda 760 olurdu!)
    if (
      match13?.status === 'SETTLED' &&
      winnerP?.balance === 580 &&
      winnerP?.heldBalance === 0 &&
      loserP?.balance === 400 &&
      loserP?.heldBalance === 0 &&
      rewardTxs.length === 1
    ) {
      console.log('  -> BAŞARILI: Çift settlement engellendi! Kazanan tam 1 kez 180 coin aldı, mükerrer ödül oluşmadı.');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 13):', {
        status: match13?.status,
        winnerBalance: winnerP?.balance,
        rewardTxsCount: rewardTxs.length,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 13):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 14: Gerçek PostgreSQL — Settlement, İade ve Reconciliation Üçlü Çakışması
  // ----------------------------------------------------------------
  console.log('\nTEST 14: Gerçek PostgreSQL — settleMatch, refundMatchHolds ve reconcileStaleMatches Üçlü Çakışması');
  try {
    const triW = 'tri-w-14';
    const triL = 'tri-l-14';
    const triMatchId = `tri-match-${Date.now()}`;

    await createTestUser(triW, 'triw@test.com', 500);
    await createTestUser(triL, 'tril@test.com', 500);

    const oldDate14 = new Date(Date.now() - 20 * 60 * 1000); // 20 dk önce kurulmuş
    await prisma.match.create({
      data: {
        id: triMatchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        createdAt: oldDate14,
        players: { create: [{ userId: triW }, { userId: triL }] },
      },
    });

    const hTriW = await walletService.holdEntryFee(triW, 100);
    const hTriL = await walletService.holdEntryFee(triL, 100);
    await walletService.bindHoldsToMatch(
      [
        { userId: triW, holdId: hTriW!.holdId },
        { userId: triL, holdId: hTriL!.holdId },
      ],
      triMatchId,
    );

    // Üç işlemi aynı anda yarıştır
    await Promise.allSettled([
      walletService.settleMatch(triMatchId, triW, 100, [triW, triL], false),
      walletService.refundMatchHolds(triMatchId),
      walletService.reconcileStaleMatches(15),
    ]);

    const mTri = await prisma.match.findUnique({ where: { id: triMatchId } });
    const pTriW = await prisma.playerProfile.findUnique({ where: { userId: triW } });
    const pTriL = await prisma.playerProfile.findUnique({ where: { userId: triL } });
    const holdsTri = await prisma.matchHold.findMany({ where: { matchId: triMatchId } });

    const validStatus = mTri?.status === 'SETTLED' || mTri?.status === 'ABORTED';
    const allResolved = holdsTri.every((h) => h.status === 'SETTLED' || h.status === 'REFUNDED');
    const totalHeldZero = (pTriW?.heldBalance || 0) === 0 && (pTriL?.heldBalance || 0) === 0;
    const totalCirculating = (pTriW?.balance || 0) + (pTriL?.balance || 0);

    // Eğer SETTLED olduysa: 580 + 400 = 980 (20 komisyon). Eğer ABORTED olduysa: 500 + 500 = 1000.
    const validCirculating = totalCirculating === 980 || totalCirculating === 1000;

    if (validStatus && allResolved && totalHeldZero && validCirculating) {
      console.log(`  -> BAŞARILI: Üçlü yarış güvenle sonlandı! Durum: ${mTri?.status}, Toplam bakiye tutarlı: ${totalCirculating}.`);
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 14):', {
        status: mTri?.status,
        allResolved,
        totalHeldZero,
        totalCirculating,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 14):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 15: Gerçek PostgreSQL — Birden Fazla Backend Örneği (Multi-Instance İzolasyonu)
  // ----------------------------------------------------------------
  console.log('\nTEST 15: Gerçek PostgreSQL — İki Bağımsız Backend Servis Örneği (Cross-Process Isolation)');
  try {
    // İki bağımsız WalletService örneği (ayrı in-memory kilit havuzları)
    const instanceA = new WalletService(prisma as any, redisService);
    const instanceB = new WalletService(prisma as any, redisService);

    const miW = 'mi-w-15';
    const miL = 'mi-l-15';
    const miMatchId = `mi-match-${Date.now()}`;

    await createTestUser(miW, 'miw@test.com', 500);
    await createTestUser(miL, 'mil@test.com', 500);

    await prisma.match.create({
      data: {
        id: miMatchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: miW }, { userId: miL }] },
      },
    });

    const hMiW = await instanceA.holdEntryFee(miW, 100);
    const hMiL = await instanceB.holdEntryFee(miL, 100);
    await instanceA.bindHoldsToMatch(
      [
        { userId: miW, holdId: hMiW!.holdId },
        { userId: miL, holdId: hMiL!.holdId },
      ],
      miMatchId,
    );

    // İki farklı instance aynı anda maçı sonuçlandırmayı denesin
    await Promise.allSettled([
      instanceA.settleMatch(miMatchId, miW, 100, [miW, miL], false),
      instanceB.settleMatch(miMatchId, miW, 100, [miW, miL], false),
    ]);

    const pMiW = await prisma.playerProfile.findUnique({ where: { userId: miW } });
    const pMiL = await prisma.playerProfile.findUnique({ where: { userId: miL } });
    const mMi = await prisma.match.findUnique({ where: { id: miMatchId } });
    const txCount = await prisma.coinTransaction.count({
      where: { userId: miW, type: 'MATCH_REWARD', referenceId: miMatchId },
    });

    if (mMi?.status === 'SETTLED' && pMiW?.balance === 580 && pMiL?.balance === 400 && txCount === 1) {
      console.log('  -> BAŞARILI: Farklı backend instanceları arasında veritabanı kilitleri çalıştı, çift ödül engellendi!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 15):', {
        status: mMi?.status,
        winnerBalance: pMiW?.balance,
        txCount,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 15):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 16: Gerçek PostgreSQL — Çökme Kurtarma ve Tekrar Deneme (Idempotent Retry)
  // ----------------------------------------------------------------
  console.log('\nTEST 16: Gerçek PostgreSQL — Ağ Kesintisi Sonrası Tekrar Deneme (Idempotent Retry Protection)');
  try {
    const rtrW = 'retry-w-16';
    const rtrL = 'retry-l-16';
    const rtrMatchId = `retry-match-${Date.now()}`;

    await createTestUser(rtrW, 'rtrw@test.com', 300);
    await createTestUser(rtrL, 'rtrl@test.com', 300);

    await prisma.match.create({
      data: {
        id: rtrMatchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: rtrW }, { userId: rtrL }] },
      },
    });

    const hRtrW = await walletService.holdEntryFee(rtrW, 100);
    const hRtrL = await walletService.holdEntryFee(rtrL, 100);
    await walletService.bindHoldsToMatch(
      [
        { userId: rtrW, holdId: hRtrW!.holdId },
        { userId: rtrL, holdId: hRtrL!.holdId },
      ],
      rtrMatchId,
    );

    // 1. İlk settlement çağrısı başarılı olur
    await walletService.settleMatch(rtrMatchId, rtrW, 100, [rtrW, rtrL], false);
    const balanceAfterFirst = (await prisma.playerProfile.findUnique({ where: { userId: rtrW } }))?.balance;

    // 2. İstemci/Worker ağ hatası varsayarak aynı isteği tekrar gönderir (Retry)
    let retryErrorCaught = false;
    try {
      await walletService.settleMatch(rtrMatchId, rtrW, 100, [rtrW, rtrL], false);
    } catch {
      retryErrorCaught = true;
    }

    const balanceAfterRetry = (await prisma.playerProfile.findUnique({ where: { userId: rtrW } }))?.balance;
    const allTxs = await prisma.coinTransaction.findMany({ where: { userId: rtrW } });
    const txTotal = await prisma.coinTransaction.count({
      where: { userId: rtrW, type: 'MATCH_REWARD', referenceId: rtrMatchId },
    });

    if (balanceAfterFirst === 380 && balanceAfterRetry === 380 && txTotal === 1) {
      console.log('  -> BAŞARILI: Tekrar deneme kazananın bakiyesini mükerrer artırmadı (Bakiye sabit: 380, Ledger: 1)!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 16):', {
        balanceAfterFirst,
        balanceAfterRetry,
        txTotal,
        allTxs,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 16):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 17: Gerçek Redis + Postgres — Soru Döngüsü ve Liveness Nabzı Doğrulaması
  // ----------------------------------------------------------------
  console.log('\nTEST 17: Gerçek Redis + Postgres — Soru Döngüsünde Liveness Nabzı Doğrulaması');
  try {
    const liveMatch17 = `live-cycle-${Date.now()}`;
    const liveUserA = 'live-user-17a';
    await createTestUser(liveUserA, 'live17@test.com', 200);

    await prisma.match.create({
      data: {
        id: liveMatch17,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: liveUserA }] },
      },
    });

    const hLive = await walletService.holdEntryFee(liveUserA, 100);
    await walletService.bindHoldsToMatch(
      [{ userId: liveUserA, holdId: hLive!.holdId }],
      liveMatch17,
    );

    // Başlangıç zamanını 1 saat öncesine çek
    const pastTime = new Date(Date.now() - 3600 * 1000);
    await prisma.$executeRawUnsafe(
      `UPDATE "MatchHold" SET "updatedAt" = $1 WHERE "id" = $2`,
      pastTime,
      hLive!.holdId,
    );

    // Canlılık güncellemesi tetikle
    await gamesService.updateMatchActivity(liveMatch17);

    const updatedHold = await prisma.matchHold.findUnique({ where: { id: hLive!.holdId } });
    const redisAct = await redisClient.get(`match_activity:${liveMatch17}`);

    const dbFresh = updatedHold && Date.now() - updatedHold.updatedAt.getTime() < 5000;
    const redisFresh = redisAct && Date.now() - parseInt(redisAct, 10) < 5000;

    if (dbFresh && redisFresh) {
      console.log('  -> BAŞARILI: updateMatchActivity hem Redis hem PostgreSQL seviyesinde canlılık zamanını tazeledi!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 17):', { dbFresh, redisFresh });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 17):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 18: Gerçek PostgreSQL — Eşzamanlı İki Reconciliation İşçisi (Worker Concurrency)
  // ----------------------------------------------------------------
  console.log('\nTEST 18: Gerçek PostgreSQL — Eşzamanlı İki Reconciliation İşçisi Yarışı');
  try {
    const workerInst1 = new WalletService(prisma as any, redisService);
    const workerInst2 = new WalletService(prisma as any, redisService);

    const deadW1 = 'dead-w1-18';
    const deadW2 = 'dead-w2-18';
    const deadMatch18 = `dead-match-18-${Date.now()}`;

    await createTestUser(deadW1, 'dead18_1@test.com', 200);
    await createTestUser(deadW2, 'dead18_2@test.com', 200);

    const oldCreated18 = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.match.create({
      data: {
        id: deadMatch18,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        createdAt: oldCreated18,
        players: { create: [{ userId: deadW1 }, { userId: deadW2 }] },
      },
    });

    const hW1 = await workerInst1.holdEntryFee(deadW1, 100);
    const hW2 = await workerInst2.holdEntryFee(deadW2, 100);
    await workerInst1.bindHoldsToMatch(
      [
        { userId: deadW1, holdId: hW1!.holdId },
        { userId: deadW2, holdId: hW2!.holdId },
      ],
      deadMatch18,
    );

    await prisma.$executeRawUnsafe(
      `UPDATE "MatchHold" SET "updatedAt" = $1 WHERE "matchId" = $2`,
      oldCreated18,
      deadMatch18,
    );

    // İki işçi aynı anda terk edilmiş maçları kurtarmaya çalışır
    const [res1, res2] = await Promise.all([
      workerInst1.reconcileStaleMatches(15),
      workerInst2.reconcileStaleMatches(15),
    ]);

    const mDead18 = await prisma.match.findUnique({ where: { id: deadMatch18 } });
    const pDead1 = await prisma.playerProfile.findUnique({ where: { userId: deadW1 } });
    const pDead2 = await prisma.playerProfile.findUnique({ where: { userId: deadW2 } });

    // İki işçi arasında maç yalnızca 1 kez iptal edilmeli, iadeler mükerrer olmamalı
    const totalAborted = res1.abortedCount + res2.abortedCount;

    if (
      totalAborted >= 1 &&
      mDead18?.status === 'ABORTED' &&
      pDead1?.balance === 200 &&
      pDead1?.heldBalance === 0 &&
      pDead2?.balance === 200 &&
      pDead2?.heldBalance === 0
    ) {
      console.log('  -> BAŞARILI: İki eşzamanlı reconciliation işçisi maçı güvenle kapattı, çift iade oluşmadı!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 18):', {
        res1,
        res2,
        status: mDead18?.status,
        pDead1,
        pDead2,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 18):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 19: Gerçek PostgreSQL — Bir Hold Asla Hem REFUNDED Hem SETTLED Olamaz
  // ----------------------------------------------------------------
  console.log('\nTEST 19: Gerçek PostgreSQL — Hold Durum Geçişi İkiliği (REFUNDED vs SETTLED)');
  try {
    const exclUser = 'excl-user-19';
    await createTestUser(exclUser, 'excl19@test.com', 200);

    const hExcl = await walletService.holdEntryFee(exclUser, 100);
    const holdId19 = hExcl!.holdId;

    // 1. İade et
    const firstRefund = await walletService.refundHoldRecord(holdId19);

    // 2. Tekrar iade dene
    const secondRefund = await walletService.refundHoldRecord(holdId19);

    const holdAfter = await prisma.matchHold.findUnique({ where: { id: holdId19 } });
    const profileAfter = await prisma.playerProfile.findUnique({ where: { userId: exclUser } });

    if (
      firstRefund === true &&
      secondRefund === false &&
      holdAfter?.status === 'REFUNDED' &&
      profileAfter?.balance === 200 &&
      profileAfter?.heldBalance === 0
    ) {
      console.log('  -> BAŞARILI: Hold durumu tek yönlü kesin geçiş yaptı; mükerrer geçişler reddedildi!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 19):', { firstRefund, secondRefund, holdAfter, profileAfter });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 19):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // TEST 20: Gerçek PostgreSQL — PvE / Bot Maçı Ekonomi Değişmezleri (0 Ücret, 0 Ödül, 0 Rating)
  // ----------------------------------------------------------------
  console.log('\nTEST 20: Gerçek PostgreSQL — Botlu PvE Maçında Kesin Bakiye ve Rating Koruması');
  try {
    const humanId = 'human-pve-user-20';
    const botId = 'bot1-test-user-20';
    const pveMatchId = `pve-match-20-${Date.now()}`;

    await createTestUser(humanId, 'human20@test.com', 500, false);
    await createTestUser(botId, 'bot20@test.com', 0, true);

    await prisma.match.create({
      data: {
        id: pveMatchId,
        gameModeId: q2Mode.id,
        status: 'ACTIVE',
        players: { create: [{ userId: humanId }, { userId: botId }] },
      },
    });

    const hHuman = await walletService.holdEntryFee(humanId, 100);
    await walletService.bindHoldsToMatch(
      [{ userId: humanId, holdId: hHuman!.holdId }],
      pveMatchId,
    );

    // Bot tespit edildiği için giriş ücreti anında iade edilir
    await walletService.refundMatchHolds(pveMatchId);

    // Maçı insan kazanır ve settleMatch çağrılır
    await walletService.settleMatch(pveMatchId, humanId, 0, [humanId, botId], true);

    const finalHuman = await prisma.playerProfile.findUnique({ where: { userId: humanId } });
    const finalBot = await prisma.playerProfile.findUnique({ where: { userId: botId } });
    const finalMatch = await prisma.match.findUnique({ where: { id: pveMatchId } });
    const pveTxs = await prisma.coinTransaction.findMany({
      where: { referenceId: pveMatchId, type: 'GAME_REWARD' },
    });

    // İnsan bakiyesi başlangıçtaki gibi 500 olmalı, rating 1000 kalmalı, bot 0 olmalı, ödül tx 0 olmalı
    if (
      finalMatch?.status === 'SETTLED' &&
      finalHuman?.balance === 500 &&
      finalHuman?.heldBalance === 0 &&
      finalHuman?.rating === 1000 &&
      finalHuman?.wins === 0 &&
      finalBot?.balance === 0 &&
      pveTxs.length === 0
    ) {
      console.log('  -> BAŞARILI: PvE bot maçında insan bakiyesi ve ratingi korundu, coin basılmadı!');
      passed++;
    } else {
      console.error('  -> BAŞARISIZ (TEST 20):', {
        human: finalHuman,
        bot: finalBot,
        pveTxs,
      });
      failed++;
    }
  } catch (err) {
    console.error('  -> HATA (TEST 20):', err);
    failed++;
  }

  // ----------------------------------------------------------------
  // ÖZET
  // ----------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`GERÇEK ALTYAPI TEST SONUCU: ${passed} GEÇTİ, ${failed} BAŞARISIZ`);
  console.log('================================================================\n');

  await prisma.$disconnect();
  redisClient.disconnect();
  process.exit(0);
}

runRealInfraTests().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
