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
    
    // GameMode'dan entryFee değerini al
    const mode = await this.prisma.gameMode.findUnique({
      where: { name: gameModeId },
    });
    const entryFee = mode?.entryFee || 0;

    // Oyuncunun bakiyesini bloke et (Eğer yeterli değilse hata fırlatacak)
    await this.walletService.holdEntryFee(userId, entryFee);

    await this.redisService.enqueuePlayer(queueName, userId);
    this.logger.log(`User ${userId} joined queue ${queueName} (Fee: ${entryFee})`);
    
    // Normal match araması
    const matched = await this.tryMatch(gameModeId, mode?.maxPlayers || 2); 
    
    if (!matched) {
      // Eğer maç bulunamadıysa, 3 saniye sonra botlarla doldur
      setTimeout(() => this.backfillWithBots(gameModeId, mode?.maxPlayers || 2), 3000);
    }
  }

  private async backfillWithBots(gameModeId: string, requiredPlayers: number) {
    const queueName = `matchmaking_queue:${gameModeId}`;
    
    // Kuyrukta en az 1 gerçek oyuncu var mı? (Tüm kuyruğu çekmiyoruz, var mı bakıyoruz)
    // Şimdilik dequeue diyip var olanları çekelim
    const currentPlayers = await this.redisService.dequeuePlayers(queueName, requiredPlayers);
    
    if (currentPlayers.length === 0) return; // Kuyrukta kimse yoksa veya iptal etmişse dön

    if (currentPlayers.length === requiredPlayers) {
      // Zaten yeterli oyuncu toplanmış, normal başlat
      await this.startMatch(gameModeId, currentPlayers);
      return;
    }

    // Eksik olanı botlarla tamamla
    const needed = requiredPlayers - currentPlayers.length;
    this.logger.log(`Backfilling queue ${queueName} with ${needed} bots...`);
    
    const botIds = await this.botService.getAvailableBots(needed);
    const finalPlayers = [...currentPlayers, ...botIds];

    // GameMode'u alıp botlar için ücret bloke edelim
    const mode = await this.prisma.gameMode.findUnique({
      where: { name: gameModeId },
    });
    const entryFee = mode?.entryFee || 0;
    for (const botId of botIds) {
      await this.walletService.holdEntryFee(botId, entryFee);
    }

    await this.startMatch(gameModeId, finalPlayers);
  }

  private async startMatch(gameModeId: string, players: string[]) {
    const roomId = uuidv4();
    this.logger.log(`Match found! Room: ${roomId}, Players: ${players.join(', ')}`);

    // Odayı Redis'te başlat
    await this.initializeRoom(roomId, players, gameModeId);
    
    // Oyunculara haber ver
    this.gamesService.notifyPlayersMatchFound(roomId, players);

    // Oyunu başlat
    this.gamesService.startGameCountdown(roomId);
  }

  async leaveQueue(userId: string, gameModeId: string): Promise<void> {
    const queueName = `matchmaking_queue:${gameModeId}`;
    await this.redisService.removeFromQueue(queueName, userId);
    
    // GameMode ücretini iade et
    const mode = await this.prisma.gameMode.findUnique({
      where: { name: gameModeId },
    });
    const entryFee = mode?.entryFee || 0;
    
    await this.walletService.releaseHold(userId, entryFee);
    this.logger.log(`User ${userId} left queue ${queueName} (Refund: ${entryFee})`);
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
    // GameMode ID bul (name üzerinden bulup gerçek ID'sini almalıyız)
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

    // DB'den oyuncu profillerini çekip isBot bilgisini alalım
    const users = await this.prisma.user.findMany({
      where: { id: { in: players } },
      select: { id: true, isBot: true }
    });

    const isBotMap = new Map(users.map(u => [u.id, u.isBot]));

    const roomState = {
      roomId,
      gameModeName: gameModeId, // Redis için isim tut
      entryFee: mode.entryFee,  // Settle için sakla
      status: 'PLAYER_READY',
      players: players.map((id) => ({
        userId: id,
        ready: false,
        score: 0,
        connected: true,
        isBot: isBotMap.get(id) || false,
      })),
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
