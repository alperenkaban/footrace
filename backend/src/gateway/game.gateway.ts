import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';
import { GamesService } from '../games/games.service.js';
import { Logger, UnauthorizedException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getCorsOrigins } from '../common/cors.config.js';
import { WsRateLimiterService } from './ws-rate-limiter.service.js';

@WebSocketGateway({
  cors: {
    origin: getCorsOrigins(),
    credentials: true,
  },
  maxHttpBufferSize: 32 * 1024, // 32 KB maksimum soket paket boyutu sınırı
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);

  // Doğrulanmış soket <-> kullanıcı eşlemesi
  private clientMapping: Map<string, string> = new Map();
  // Çoklu cihaz/sekme takibi: kullanıcı <-> aktif soketler kümesi
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly gamesService: GamesService,
    private readonly jwtService: JwtService,
    @Optional() private readonly wsRateLimiter?: WsRateLimiterService,
  ) {
    if (!this.wsRateLimiter) {
      this.wsRateLimiter = new WsRateLimiterService();
    }
  }

  afterInit(server: Server) {
    this.gamesService.setServer(server);
  }

  /**
   * İstemcinin IP adresini güvenli şekilde çözümler.
   */
  private getClientIp(client: Socket): string {
    const forwarded = client.handshake?.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return client.handshake?.address || (client as any).conn?.remoteAddress || '127.0.0.1';
  }

  /**
   * Sokete bağlı kullanıcı kimliğini döner; soket henüz mapping'e işlenmemişse
   * handshake verisindeki token'ı anında doğrulayarak yarış durumlarını (race condition) önler.
   */
  private getUserId(client: Socket): string | null {
    const cached = this.clientMapping.get(client.id);
    if (cached) return cached;

    const authHeader = client.handshake?.headers?.authorization;
    const token =
      client.handshake?.auth?.token ||
      (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined) ||
      (typeof client.handshake?.query?.token === 'string' ? client.handshake.query.token : undefined);

    if (token && typeof token === 'string' && token.length <= 2048) {
      try {
        const payload = this.jwtService.verify(token);
        const userId = payload?.sub;
        if (userId && typeof userId === 'string' && userId.trim()) {
          this.clientMapping.set(client.id, userId);
          if (!this.userSockets.has(userId)) {
            this.userSockets.set(userId, new Set());
          }
          this.userSockets.get(userId)!.add(client.id);
          return userId;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  async handleConnection(client: Socket) {
    try {
      // 1. IP bazlı bağlantı sıklık (rate limit) denetimi
      const clientIp = this.getClientIp(client);
      const connRate = await this.wsRateLimiter!.consumeConnection(clientIp);
      if (!connRate.allowed) {
        this.logger.warn(`Connection rate limit exceeded for IP: ${clientIp}`);
        client.emit('error', {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many connection attempts. Please slow down.',
        });
        client.disconnect(true);
        return;
      }

      // 2. Token çıkarma ve doğrulama
      const authHeader = client.handshake?.headers?.authorization;
      const token =
        client.handshake?.auth?.token ||
        (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : undefined) ||
        (typeof client.handshake?.query?.token === 'string' ? client.handshake.query.token : undefined);

      if (!token || typeof token !== 'string') {
        throw new UnauthorizedException('Token missing or invalid format');
      }

      if (token.length > 2048) {
        throw new UnauthorizedException('Token length exceeds maximum limit');
      }

      const payload = this.jwtService.verify(token);
      const userId = payload?.sub;

      if (!userId || typeof userId !== 'string' || !userId.trim()) {
        throw new UnauthorizedException('Invalid token payload: missing sub');
      }

      this.clientMapping.set(client.id, userId);
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);
      client.join(userId);
      this.logger.log(`Client connected and authenticated: ${client.id} (User: ${userId})`);

      // 3. Uygulama yeniden başlatma / yeniden bağlanma: Aktif devam eden maç kontrolü
      try {
        const activeRoomId = await this.matchmakingService.getPlayerRoom(userId);
        if (activeRoomId) {
          const roomRaw = await this.matchmakingService.getRoomState(activeRoomId);
          if (roomRaw) {
            const parsed = JSON.parse(roomRaw);
            if (parsed.status !== 'GAME_FINISHED') {
              client.emit('active_match_found', {
                roomId: activeRoomId,
                status: parsed.status,
              });
            }
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to check active room on connection for ${userId}: ${(err as Error).message}`);
      }

      // 4. Socket düzeyinde paket middleware'i (Boyut ve mesaj spam denetimi)
      if (typeof client.use === 'function') {
        client.use(async (packet: any, next: (err?: any) => void) => {
          try {
            if (!Array.isArray(packet) || packet.length === 0) {
              return next(new Error('MALFORMED_PACKET'));
            }

            const [eventName, payloadData] = packet;

            // Boyut sınırı kontrolü (32 KB)
            const rawSize = JSON.stringify(payloadData ?? '').length;
            if (rawSize > 32 * 1024) {
              client.emit('error', {
                code: 'PAYLOAD_TOO_LARGE',
                message: 'Message payload size exceeds 32KB limit.',
              });
              return;
            }

            // Mesaj sıklık sınırı kontrolü
            const msgRate = await this.wsRateLimiter!.consumeMessage(userId, eventName);
            if (!msgRate.allowed) {
              // Aşırı spam durumunda soketi zorla kapat
              if (msgRate.current > msgRate.limit * 2) {
                this.logger.warn(`Excessive spam detected from user ${userId}. Terminating socket ${client.id}`);
                client.emit('error', {
                  code: 'SPAM_DETECTED',
                  message: 'Connection terminated due to message spam.',
                });
                client.disconnect(true);
                return;
              }

              client.emit('error', {
                code: 'RATE_LIMIT_EXCEEDED',
                message: 'Too many messages sent. Please slow down.',
              });
              return;
            }

            next();
          } catch (err) {
            next(err as Error);
          }
        });
      }
    } catch (error) {
      // Güvenlik kuralı: Hassas JWT tokenı asla loga yazılmaz! Sadece hata mesajı yazılır.
      this.logger.error(`Authentication failed for client ${client.id}: ${(error as Error).message}`);
      client.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication failed.' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const userId = this.clientMapping.get(client.id);
    if (userId) {
      this.clientMapping.delete(client.id);
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
          // Tüm cihazlardan/sekmelerden bağlantı koptu; kuyruk ve maç durumunu temizle/güncelle
          await this.matchmakingService.handleUserDisconnect(userId);
          await this.gamesService.handlePlayerDisconnect(userId);
        } else {
          this.logger.log(`User ${userId} disconnected socket ${client.id}, but has ${sockets.size} active connection(s) remaining`);
        }
      } else {
        await this.matchmakingService.handleUserDisconnect(userId);
        await this.gamesService.handlePlayerDisconnect(userId);
      }
    }
  }

  @SubscribeMessage('join_matchmaking')
  async handleJoinMatchmaking(
    @MessageBody() data: { gameModeId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = this.getUserId(client);
      if (!userId) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Socket is not authenticated.' });
        return;
      }

      // Payload doğrulama
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.gameModeId !== 'string' ||
        !data.gameModeId.trim() ||
        data.gameModeId.length > 64
      ) {
        client.emit('error', { code: 'INVALID_PAYLOAD', message: 'Valid gameModeId is required.' });
        return;
      }

      // Aksiyon bazlı sıklık sınırı
      const rateCheck = await this.wsRateLimiter!.consumeMessage(userId, 'join_matchmaking');
      if (!rateCheck.allowed) {
        client.emit('error', { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many matchmaking join requests.' });
        return;
      }

      const modeId = data.gameModeId.trim();
      this.logger.log(`User ${userId} requested to join matchmaking for mode ${modeId}`);

      await this.matchmakingService.joinQueue(userId, modeId);
      client.emit('matchmaking_status', { status: 'searching', estimatedTime: 15 });
    } catch (error) {
      const msg = (error as Error).message || 'Eşleştirme hatası';
      this.logger.error(`Matchmaking join failed for ${client.id}: ${msg}`);
      const code = msg.toLowerCase().includes('bakiye') ? 'INSUFFICIENT_FUNDS' : 'QUEUE_ERROR';
      client.emit('error', { code, message: msg });
    }
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = this.getUserId(client);
      if (!userId) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Socket is not authenticated.' });
        return;
      }

      // Payload doğrulama
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.roomId !== 'string' ||
        !data.roomId.trim() ||
        data.roomId.length > 128
      ) {
        client.emit('error', { code: 'INVALID_ROOM', message: 'roomId is required.' });
        return;
      }

      const targetRoomId = data.roomId.trim();

      // Aksiyon bazlı sıklık kontrolü
      const rateCheck = await this.wsRateLimiter!.consumeMessage(userId, 'join_room');
      if (!rateCheck.allowed) {
        client.emit('error', { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many join_room requests.' });
        return;
      }

      const assignedRoomId = await this.matchmakingService.getPlayerRoom(userId);
      if (!assignedRoomId || assignedRoomId !== targetRoomId) {
        this.logger.warn(`Unauthorized join_room attempt by user ${userId} for room ${targetRoomId}`);
        client.emit('error', {
          code: 'UNAUTHORIZED_ROOM_ACCESS',
          message: 'You are not assigned to this match room.',
        });
        return;
      }

      // Oda durumunu ve kapasitesini doğrula
      const roomStateRaw = await this.matchmakingService.getRoomState(targetRoomId);
      if (!roomStateRaw) {
        this.logger.warn(`Room ${targetRoomId} not found for join_room attempt by ${userId}`);
        client.emit('error', {
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found.',
        });
        return;
      }

      try {
        const roomState = JSON.parse(roomStateRaw);
        if (roomState.status === 'GAME_FINISHED') {
          this.logger.warn(`Room ${targetRoomId} is already finished for user ${userId}`);
          client.emit('error', {
            code: 'ROOM_CLOSED',
            message: 'Room is already finished.',
          });
          return;
        }

        const isMember = (roomState.players || []).some((p: any) => p.userId === userId);
        const maxCap = roomState.maxPlayers || (roomState.gameModeName?.startsWith('classic_10') ? 10 : 2);
        if (!isMember || (roomState.players && roomState.players.length > maxCap)) {
          this.logger.warn(`User ${userId} attempted to join room ${targetRoomId} but is not a member or capacity exceeded`);
          client.emit('error', {
            code: 'ROOM_CAPACITY_EXCEEDED',
            message: 'Room capacity exceeded or user is not a member of this room.',
          });
          return;
        }
      } catch (parseErr) {
        this.logger.error(`Failed to parse room state JSON for room ${targetRoomId}: ${(parseErr as Error).message}`);
        client.emit('error', { code: 'INTERNAL_ERROR', message: 'Invalid room state.' });
        return;
      }

      // Client'ı Socket.io odasına al
      client.join(targetRoomId);
      await this.gamesService.updateMatchActivity(targetRoomId);
      if (typeof (this.gamesService as any).handlePlayerReconnect === 'function') {
        await (this.gamesService as any).handlePlayerReconnect(userId, targetRoomId);
      }
      client.emit('room_joined', { roomId: targetRoomId, status: 'joined' });

      // Yeniden bağlanan veya katılan oyuncuya anlık maç durumunu senkronize et
      if (typeof (this.gamesService as any).getRoomSyncState === 'function') {
        const syncState = await (this.gamesService as any).getRoomSyncState(targetRoomId, userId);
        if (syncState) {
          client.emit('room_sync', syncState);
        }
      }
    } catch (err) {
      this.logger.error(`Error in handleJoinRoom: ${(err as Error).message}`);
      client.emit('error', { code: 'INTERNAL_ERROR', message: 'An error occurred while joining room.' });
    }
  }

  @SubscribeMessage('leave_matchmaking')
  async handleLeaveMatchmaking(
    @MessageBody() data: { gameModeId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = this.getUserId(client);
      if (!userId) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Socket is not authenticated.' });
        return;
      }

      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.gameModeId !== 'string' ||
        !data.gameModeId.trim()
      ) {
        client.emit('error', { code: 'INVALID_PAYLOAD', message: 'Valid gameModeId is required.' });
        return;
      }

      await this.matchmakingService.leaveQueue(userId, data.gameModeId.trim());
      client.emit('matchmaking_status', { status: 'cancelled' });
    } catch (err) {
      this.logger.error(`Error in handleLeaveMatchmaking: ${(err as Error).message}`);
      client.emit('error', { code: 'QUEUE_ERROR', message: (err as Error).message });
    }
  }

  @SubscribeMessage('request_bot_match')
  async handleRequestBotMatch(
    @MessageBody() data: { gameModeId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = this.getUserId(client);
      if (!userId) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Socket is not authenticated.' });
        return;
      }

      const rateCheck = await this.wsRateLimiter!.consumeMessage(userId, 'request_bot_match');
      if (!rateCheck.allowed) {
        client.emit('error', { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many bot match requests.' });
        return;
      }

      const modeId =
        data && typeof data === 'object' && typeof data.gameModeId === 'string' && data.gameModeId.trim()
          ? data.gameModeId.trim()
          : 'classic_10';

      this.logger.log(`User ${userId} requested immediate bot backfill for ${modeId}`);
      await this.matchmakingService.forceBackfill(modeId);
    } catch (err) {
      this.logger.error(`Error in handleRequestBotMatch: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('submit_answer')
  async handleSubmitAnswer(
    @MessageBody() data: { questionIndex: number; answer: any },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = this.getUserId(client);
      if (!userId) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Socket is not authenticated.' });
        return;
      }

      // Input validation: null/undefined, type checking, negative index, NaN, non-integer
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.questionIndex !== 'number' ||
        !Number.isInteger(data.questionIndex) ||
        data.questionIndex < 0 ||
        data.answer === undefined
      ) {
        client.emit('error', { code: 'INVALID_PAYLOAD', message: 'Valid questionIndex and answer are required.' });
        return;
      }

      // Payload boyut kontrolü (maks 4 KB)
      const answerStr = typeof data.answer === 'string' ? data.answer : JSON.stringify(data.answer);
      if (answerStr && answerStr.length > 4096) {
        client.emit('error', { code: 'PAYLOAD_TOO_LARGE', message: 'Answer data exceeds size limit.' });
        return;
      }

      // Aksiyon bazlı sıklık sınırı kontrolü
      const rateCheck = await this.wsRateLimiter!.consumeMessage(userId, 'submit_answer');
      if (!rateCheck.allowed) {
        client.emit('error', { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many answer submissions. Please slow down.' });
        return;
      }

      // Room spoofing engellemek için oyuncunun odasını sunucudan bul (istemcinin gönderdiği roomId veya userId dikkate alınmaz!)
      const roomId = await this.matchmakingService.getPlayerRoom(userId);
      if (!roomId) {
        client.emit('error', { code: 'NO_ROOM', message: 'You are not in a game room.' });
        return;
      }

      const result = await this.gamesService.submitAnswer(
        roomId,
        userId,
        data.questionIndex,
        data.answer,
      );

      if (result.success) {
        client.emit('answer_ack', { questionIndex: data.questionIndex, status: 'received' });
      } else {
        client.emit('error', { code: 'SUBMIT_FAILED', message: result.error });
      }
    } catch (err) {
      this.logger.error(`Error in handleSubmitAnswer: ${(err as Error).message}`);
      client.emit('error', { code: 'INTERNAL_ERROR', message: 'An error occurred while submitting answer.' });
    }
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = this.getUserId(client);
      if (!userId) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Socket is not authenticated.' });
        return;
      }

      if (!data || typeof data !== 'object' || typeof data.roomId !== 'string' || !data.roomId.trim()) {
        client.emit('error', { code: 'INVALID_ROOM', message: 'roomId is required.' });
        return;
      }

      const rateCheck = await this.wsRateLimiter!.consumeMessage(userId, 'leave_room');
      if (!rateCheck.allowed) {
        client.emit('error', { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many leave_room requests.' });
        return;
      }

      const targetRoomId = data.roomId.trim();
      const assignedRoom = await this.matchmakingService.getPlayerRoom(userId);
      if (assignedRoom !== targetRoomId) {
        client.emit('error', { code: 'UNAUTHORIZED_ROOM_ACCESS', message: 'You are not in this room.' });
        return;
      }

      const result = await this.gamesService.handlePlayerLeave(userId, targetRoomId);
      if (result.success) {
        client.leave(targetRoomId);
        client.emit('room_left', { roomId: targetRoomId, status: 'left' });
      } else {
        client.emit('error', { code: 'LEAVE_FAILED', message: result.error || 'Failed to leave room.' });
      }
    } catch (err) {
      this.logger.error(`Error in handleLeaveRoom: ${(err as Error).message}`);
      client.emit('error', { code: 'INTERNAL_ERROR', message: 'An error occurred while leaving room.' });
    }
  }

  @SubscribeMessage('get_active_match')
  async handleGetActiveMatch(@ConnectedSocket() client: Socket) {
    try {
      const userId = this.getUserId(client);
      if (!userId) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Socket is not authenticated.' });
        return;
      }

      const roomId = await this.matchmakingService.getPlayerRoom(userId);
      if (!roomId) {
        client.emit('active_match_status', { hasActiveMatch: false });
        return;
      }

      const roomStateRaw = await this.matchmakingService.getRoomState(roomId);
      if (!roomStateRaw) {
        client.emit('active_match_status', { hasActiveMatch: false });
        return;
      }

      const roomState = JSON.parse(roomStateRaw);
      if (roomState.status === 'GAME_FINISHED') {
        client.emit('active_match_status', { hasActiveMatch: false });
        return;
      }

      client.emit('active_match_status', {
        hasActiveMatch: true,
        roomId,
        gameModeName: roomState.gameModeName,
        status: roomState.status,
      });
    } catch (err) {
      this.logger.error(`Error in handleGetActiveMatch: ${(err as Error).message}`);
      client.emit('error', { code: 'INTERNAL_ERROR', message: 'Failed to query active match.' });
    }
  }

  @SubscribeMessage('sync_room')
  async handleSyncRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = this.getUserId(client);
      if (!userId) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Socket is not authenticated.' });
        return;
      }

      const targetRoomId = data?.roomId?.trim();
      if (!targetRoomId) {
        client.emit('error', { code: 'INVALID_ROOM', message: 'roomId is required.' });
        return;
      }

      const assignedRoom = await this.matchmakingService.getPlayerRoom(userId);
      if (assignedRoom !== targetRoomId) {
        client.emit('error', { code: 'UNAUTHORIZED_ROOM_ACCESS', message: 'You are not assigned to this room.' });
        return;
      }

      const syncState = await this.gamesService.getRoomSyncState(targetRoomId, userId);
      if (!syncState) {
        client.emit('error', { code: 'ROOM_NOT_FOUND', message: 'Room state not found.' });
        return;
      }

      client.emit('room_sync', syncState);
    } catch (err) {
      this.logger.error(`Error in handleSyncRoom: ${(err as Error).message}`);
      client.emit('error', { code: 'INTERNAL_ERROR', message: 'Failed to sync room.' });
    }
  }
}
