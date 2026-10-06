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
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);

  // MVP: Şimdilik socket.id = userId olarak varsayalım. Auth eklenince düzelecek.
  private clientMapping: Map<string, string> = new Map();

  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly gamesService: GamesService,
    private readonly jwtService: JwtService,
  ) {}

  afterInit(server: Server) {
    this.gamesService.setServer(server);
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;
      if (!token) throw new UnauthorizedException('Token missing');

      const payload = this.jwtService.verify(token);
      const userId = payload.sub;

      this.clientMapping.set(client.id, userId);
      client.join(userId);
      this.logger.log(`Client connected and authenticated: ${client.id} (User: ${userId})`);
    } catch (error) {
      this.logger.error(`Authentication failed for client ${client.id}: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const userId = this.clientMapping.get(client.id);
    if (userId) {
      // Kuyruktan çıkartma işlemleri vs yapılabilir
      this.clientMapping.delete(client.id);
    }
  }

  @SubscribeMessage('join_matchmaking')
  async handleJoinMatchmaking(
    @MessageBody() data: { gameModeId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.clientMapping.get(client.id);
    if (!userId) return;

    this.logger.log(`User ${userId} requested to join matchmaking for mode ${data.gameModeId}`);
    
    try {
      await this.matchmakingService.joinQueue(userId, data.gameModeId);
      client.emit('matchmaking_status', { status: 'searching', estimatedTime: 15 });
    } catch (error) {
      this.logger.error(`Matchmaking join failed for ${userId}: ${(error as Error).message}`);
      client.emit('error', { code: 'INSUFFICIENT_FUNDS', message: (error as Error).message });
    }
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Client'ı Socket.io odasına al (Böylece server.to(roomId) çalışır)
    client.join(data.roomId);
  }

  @SubscribeMessage('leave_matchmaking')
  async handleLeaveMatchmaking(
    @MessageBody() data: { gameModeId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.clientMapping.get(client.id);
    if (!userId) return;

    await this.matchmakingService.leaveQueue(userId, data.gameModeId);
    client.emit('matchmaking_status', { status: 'cancelled' });
  }

  @SubscribeMessage('submit_answer')
  async handleSubmitAnswer(
    @MessageBody() data: { questionIndex: number; answer: any },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.clientMapping.get(client.id);
    if (!userId) return;

    // Room spoofing engellemek için oyuncunun odasını sunucudan bul
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
  }
}
