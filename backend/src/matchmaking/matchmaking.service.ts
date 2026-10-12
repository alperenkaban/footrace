import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { GamesService } from '../games/games.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BotService } from '../bot/bot.service.js';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly gamesService: GamesService,
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
    private readonly botService: BotService,
  ) {}

  async joinQueue(userId: string, gameModeId: string): Promise<void> {
    const queueName = `matchmaking_queue:${gameModeId}`;
    
    // 1. Zaten aktif bir odada mı kontrol et (GAME_FINISHED kalıntı kontrolleri ile self-healing)
    const existingRoom = await this.redisService.get(`player_room:${userId}`);
    if (existingRoom) {
      const roomData = await this.redisService.get(`room:${existingRoom}`);
      let isFinished = false;
      if (roomData) {
        try {
          const parsed = JSON.parse(roomData);
          if (parsed.status === 'GAME_FINISHED') {
            isFinished = true;
          }
        } catch {
          isFinished = false;
        }
      }

      if (isFinished) {
        // Settlement sonrasında temizlenememiş kalıntı odayı temizle
        await this.redisService.del(`player_room:${userId}`);
      } else {
        this.logger.warn(`User ${userId} is already in active room ${existingRoom}, skipping queue join`);
        throw new Error(`You are already in a game room: ${existingRoom}`);
      }
    }

    // 2. Atomik olarak kuyruk kilidini al (Aynı anda iki ayrı kuyruğa girişi engeller)
    const lockKey = `player_queue_lock:${userId}`;
    const acquired = await this.redisService.setNX(lockKey, gameModeId, 5);
    if (!acquired) {
      this.logger.warn(`User ${userId} queue operation is already in progress, skipping concurrent join`);
      throw new Error(`Eşleştirme işlemi zaten devam ediyor`);
    }

    try {
      const existingQueue = await this.redisService.get(`player_queue:${userId}`);
      if (existingQueue) {
        this.logger.warn(`User ${userId} is already in queue ${existingQueue}`);
        throw new Error(`You are already in matchmaking queue for ${existingQueue}`);
      }

      // GameMode'dan entryFee değerini al
      const mode = await this.prisma.gameMode.findUnique({
        where: { name: gameModeId },
      });
      const entryFee = mode?.entryFee || 0;

      // Oyuncunun bakiyesini bloke et (Eğer yeterli değilse hata fırlatacak)
      const holdRes = await this.walletService.holdEntryFee(userId, entryFee, { gameModeId: mode?.id });
      const holdId = holdRes?.holdId;

      // Kuyruk ve açık hold takibini Redis'e kaydet
      await this.redisService.set(`player_queue:${userId}`, gameModeId, 3600);
      if (holdId) {
        await this.redisService.set(`player_hold:${userId}`, holdId, 3600);
      }
      await this.redisService.enqueuePlayer(queueName, userId);
      this.logger.log(`User ${userId} joined queue ${queueName} (Fee: ${entryFee}, Hold: ${holdId || 'none'})`);
      
      // Normal match araması
      const matched = await this.tryMatch(gameModeId, mode?.maxPlayers || 2); 
      
      if (!matched) {
        // Eğer maç bulunamadıysa, 3 saniye sonra botlarla doldur
        setTimeout(() => this.backfillWithBots(gameModeId, mode?.maxPlayers || 2), 3000);
      }
    } finally {
      await this.redisService.del(lockKey);
    }
  }

  private async backfillWithBots(gameModeId: string, requiredPlayers: number) {
    const queueName = `matchmaking_queue:${gameModeId}`;
    const lockKey = `backfill_lock:${gameModeId}`;

    // Redis kilidi ile eşzamanlı bot doldurmalarını engelle
    const lockSet = await this.redisService.setNX(lockKey, '1', 10);
    if (!lockSet) {
      this.logger.log(`Backfill for ${gameModeId} already in progress, skipping`);
      return;
    }

    try {
      const currentPlayers = await this.redisService.dequeuePlayers(queueName, requiredPlayers, false);
      
      if (currentPlayers.length === 0) return; // Kuyrukta kimse yoksa veya iptal etmişse dön

      if (currentPlayers.length === requiredPlayers) {
        // Zaten yeterli oyuncu toplanmış, normal başlat
        await this.startMatch(gameModeId, currentPlayers);
        return;
      }

      // Eksik olanı botlarla tamamla
      const needed = requiredPlayers - currentPlayers.length;
      this.logger.log(`Backfilling queue ${queueName} with ${needed} bots...`);
      
      // Halihazırda oyunda olan botları hariç tut
      const botIds = await this.botService.getAvailableBots(needed);
      const finalPlayers = [...currentPlayers, ...botIds];

      // KURAL (PvE / Bot Maçı Güvenliği):
      // Bot içeren maçlar ücretsiz antrenman maçıdır.
      // Botlardan asla ücret alınmaz; kuyruktaki gerçek oyuncuların ücretleri initializeRoom içinde
      // maça bağlanıp refundMatchHolds ile tam bir kez iade edilir.
      await this.startMatch(gameModeId, finalPlayers);
    } finally {
      // Kilidi her zaman serbest bırak
      await this.redisService.del(lockKey);
    }
  }

  private async startMatch(gameModeId: string, players: string[]) {
    const roomId = uuidv4();
    this.logger.log(`Match found! Room: ${roomId}, Players: ${players.join(', ')}`);

    // Eşleşen oyuncuların kuyruk durumunu temizle
    for (const p of players) {
      await this.redisService.del(`player_queue:${p}`);
    }

    // Odayı Redis'te başlat
    await this.initializeRoom(roomId, players, gameModeId);
    
    // Oyunculara haber ver
    this.gamesService.notifyPlayersMatchFound(roomId, players);

    // Oyunu başlat
    this.gamesService.startGameCountdown(roomId);
  }

  async leaveQueue(userId: string, gameModeId: string): Promise<boolean> {
    const queuedMode = await this.redisService.get(`player_queue:${userId}`);
    // Eğer oyuncu bu kuyrukta değilse veya zaten çıkmışsa çift iade yapma
    if (queuedMode !== gameModeId) {
      this.logger.warn(`User ${userId} is not registered in queue ${gameModeId}, skipping refund`);
      return false;
    }

    const queueName = `matchmaking_queue:${gameModeId}`;
    await this.redisService.removeFromQueue(queueName, userId);
    await this.redisService.del(`player_queue:${userId}`);
    
    // Açık hold ID kaydı varsa spesifik olarak o hold'u iade et
    const holdId = await this.redisService.get(`player_hold:${userId}`);
    if (holdId) {
      await this.redisService.del(`player_hold:${userId}`);
      await this.walletService.refundHoldRecord(holdId);
      this.logger.log(`User ${userId} left queue ${queueName} (Direct Hold Refund: ${holdId})`);
    } else {
      // GameMode ücretini iade et (fallback)
      const mode = await this.prisma.gameMode.findUnique({
        where: { name: gameModeId },
      });
      const entryFee = mode?.entryFee || 0;
      await this.walletService.releaseHold(userId, entryFee);
      this.logger.log(`User ${userId} left queue ${queueName} (Refund: ${entryFee})`);
    }
    return true;
  }

  /**
   * Soket bağlantısı kopan oyuncuyu otomatik olarak kuyruktan çıkar ve parasını iade et
   */
  async handleUserDisconnect(userId: string): Promise<void> {
    const activeQueueMode = await this.redisService.get(`player_queue:${userId}`);
    if (activeQueueMode) {
      this.logger.log(`User ${userId} disconnected while in queue ${activeQueueMode}. Auto-refunding...`);
      await this.leaveQueue(userId, activeQueueMode);
    }
  }

  // Bu fonksiyon kuyruktan oyuncu alıp odaya koymaya çalışır
  private async tryMatch(gameModeId: string, requiredPlayers: number): Promise<boolean> {
    const queueName = `matchmaking_queue:${gameModeId}`;
    const players = await this.redisService.dequeuePlayers(queueName, requiredPlayers);

    if (players.length === requiredPlayers) {
      await this.startMatch(gameModeId, players);
      return true;
    }
    
    // Yeterli değilse geri kuyruğa ekle
    for (const p of players) {
      await this.redisService.enqueuePlayer(queueName, p);
    }
    return false;
  }

  async getPlayerRoom(userId: string): Promise<string | null> {
    return this.redisService.get(`player_room:${userId}`);
  }

  private async initializeRoom(roomId: string, players: string[], gameModeId: string): Promise<void> {
    const mode = await this.prisma.gameMode.findUnique({
      where: { name: gameModeId },
    });
    
    if (!mode) throw new Error(`GameMode ${gameModeId} not found`);

    // Postgres'e Match kaydını at
    await this.prisma.match.create({
      data: {
        id: roomId,
        gameModeId: mode.id,
        status: 'ACTIVE',
        players: {
          create: players.map(userId => ({
            userId,
          })),
        },
      },
    });

    // Bekleyen bloke kayıtlarını açık hold ID'leriyle topla ve bu maça bağla
    const playerHolds: { userId: string; holdId?: string }[] = [];
    for (const pid of players) {
      const holdId = await this.redisService.get(`player_hold:${pid}`);
      if (holdId) {
        await this.redisService.del(`player_hold:${pid}`);
        playerHolds.push({ userId: pid, holdId });
      } else {
        playerHolds.push({ userId: pid });
      }
    }

    await this.walletService.bindHoldsToMatch(playerHolds, roomId);

    // DB'den kullanıcıları çekip isBot ve isim bilgisini alalım
    const users = await this.prisma.user.findMany({
      where: { id: { in: players } },
      select: {
        id: true,
        email: true,
        isBot: true,
      },
    });

    const hasBots = users.some(u => u.isBot);
    const effectiveEntryFee = hasBots ? 0 : mode.entryFee;

    // Eğer botlu maç ise ve insan oyuncuların bloke bakiyesi varsa maça bağlı hold üzerinden garantili iade yap
    if (hasBots && mode.entryFee > 0) {
      await this.walletService.refundMatchHolds(roomId);
    }

    const userMap = new Map(
      users.map((u) => [
        u.id,
        {
          isBot: u.isBot,
          displayName: u.email ? u.email.split('@')[0] : (u.isBot ? 'Bot' : 'Oyuncu'),
        },
      ]),
    );

    const roomState = {
      roomId,
      gameModeName: gameModeId,
      entryFee: effectiveEntryFee,
      isPvE: hasBots,
      status: 'PLAYER_READY',
      players: players.map((id) => {
        const u = userMap.get(id);
        return {
          userId: id,
          displayName: u?.displayName || (u?.isBot ? 'Bot' : 'Oyuncu'),
          ready: false,
          score: 0,
          connected: true,
          isBot: u?.isBot ?? false,
        };
      }),
      createdAt: Date.now(),
    };

    // Odanın state'ini Redis'e kaydet (1 saat TTL)
    await this.redisService.set(`room:${roomId}`, JSON.stringify(roomState), 3600);
    
    // Hangi oyuncunun hangi odada olduğunu da Redis'e kaydedelim ki reconnect olabilsinler
    for (const p of players) {
      await this.redisService.set(`player_room:${p}`, roomId, 3600);
    }
  }
}
