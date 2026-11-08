import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameGateway } from '../src/gateway/game.gateway.js';
import { WsRateLimiterService } from '../src/gateway/ws-rate-limiter.service.js';
import { GamesService } from '../src/games/games.service.js';
import { Logger, UnauthorizedException } from '@nestjs/common';

describe('Faz 2: Socket.IO & GameGateway Security and Abuse Defense Suite', () => {
  let gateway: GameGateway;
  let matchmakingService: any;
  let gamesService: any;
  let jwtService: any;
  let wsRateLimiter: WsRateLimiterService;

  beforeEach(() => {
    matchmakingService = {
      getPlayerRoom: vi.fn(),
      getRoomState: vi.fn(),
      handleUserDisconnect: vi.fn(),
      joinQueue: vi.fn(),
      leaveQueue: vi.fn(),
      forceBackfill: vi.fn(),
    };

    gamesService = {
      setServer: vi.fn(),
      updateMatchActivity: vi.fn(),
      submitAnswer: vi.fn(),
    };

    jwtService = {
      verify: vi.fn(),
    };

    // Use standalone in-memory rate limiter for deterministic testing
    wsRateLimiter = new WsRateLimiterService(undefined);

    gateway = new GameGateway(matchmakingService, gamesService, jwtService, wsRateLimiter);
  });

  describe('1. JWT Verification, Authentication & Log Privacy', () => {
    it('should reject connection when token is completely missing', async () => {
      const mockSocket: any = {
        id: 'conn-no-token',
        handshake: { auth: {}, headers: {}, address: '127.0.0.1' },
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHORIZED',
        message: 'Authentication failed.',
      });
      expect((gateway as any).clientMapping.has('conn-no-token')).toBe(false);
    });

    it('should reject connection when JWT is expired or has invalid signature', async () => {
      const mockSocket: any = {
        id: 'conn-bad-jwt',
        handshake: {
          auth: { token: 'invalid.expired.jwt.token' },
          headers: {},
          address: '127.0.0.1',
        },
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHORIZED',
        message: 'Authentication failed.',
      });
      expect((gateway as any).clientMapping.has('conn-bad-jwt')).toBe(false);
    });

    it('should reject connection when JWT payload lacks "sub" claim', async () => {
      const mockSocket: any = {
        id: 'conn-missing-sub',
        handshake: {
          auth: { token: 'valid.token.no.sub' },
          headers: {},
          address: '127.0.0.1',
        },
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      jwtService.verify.mockReturnValue({ role: 'guest' }); // missing sub

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHORIZED',
        message: 'Authentication failed.',
      });
    });

    it('should reject connection with abnormally oversized token (>2048 chars) preventing buffer exploits', async () => {
      const hugeToken = 'A'.repeat(3000);
      const mockSocket: any = {
        id: 'conn-huge-token',
        handshake: { auth: { token: hugeToken }, headers: {}, address: '127.0.0.1' },
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('should authenticate valid connection, register mapping, join user room and attach packet middleware', async () => {
      const mockSocket: any = {
        id: 'conn-legit-123',
        handshake: { auth: { token: 'valid.signed.jwt' }, headers: {}, address: '127.0.0.1' },
        emit: vi.fn(),
        join: vi.fn(),
        disconnect: vi.fn(),
        use: vi.fn(),
      };

      jwtService.verify.mockReturnValue({ sub: 'user-player-1' });

      await gateway.handleConnection(mockSocket);

      expect((gateway as any).clientMapping.get('conn-legit-123')).toBe('user-player-1');
      expect(mockSocket.join).toHaveBeenCalledWith('user-player-1');
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      expect(mockSocket.use).toHaveBeenCalled();
    });

    it('should NEVER write sensitive JWT tokens or secrets to logger output', async () => {
      const sensitiveToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive_payload_data_secret';
      const loggerErrorSpy = vi.spyOn((gateway as any).logger, 'error');
      const loggerLogSpy = vi.spyOn((gateway as any).logger, 'log');

      const mockSocket: any = {
        id: 'conn-leak-check',
        handshake: { auth: { token: sensitiveToken }, headers: {}, address: '127.0.0.1' },
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await gateway.handleConnection(mockSocket);

      // Check all logged calls
      const allLogs = [
        ...loggerErrorSpy.mock.calls.map((call) => call.join(' ')),
        ...loggerLogSpy.mock.calls.map((call) => call.join(' ')),
      ].join(' ');

      expect(allLogs).not.toContain(sensitiveToken);
      expect(allLogs).not.toContain('sensitive_payload_data_secret');
    });
  });

  describe('2. Connection Flood & IP Rate Limiting', () => {
    it('should throttle and disconnect excessive connection attempts from the same IP', async () => {
      const clientIp = '203.0.113.42';

      // Exhaust connection quota (15 connections allowed in 10s)
      for (let i = 0; i < wsRateLimiter.connectionLimit; i++) {
        const socket: any = {
          id: `socket-flood-${i}`,
          handshake: { auth: { token: 'test.jwt' }, headers: {}, address: clientIp },
          emit: vi.fn(),
          join: vi.fn(),
          disconnect: vi.fn(),
          use: vi.fn(),
        };
        jwtService.verify.mockReturnValue({ sub: `user-${i}` });
        await gateway.handleConnection(socket);
        expect(socket.disconnect).not.toHaveBeenCalled();
      }

      // Next connection attempt from same IP must be rejected immediately by rate limiter
      const blockedSocket: any = {
        id: 'socket-flood-blocked',
        handshake: { auth: { token: 'test.jwt' }, headers: {}, address: clientIp },
        emit: vi.fn(),
        disconnect: vi.fn(),
      };

      await gateway.handleConnection(blockedSocket);

      expect(blockedSocket.disconnect).toHaveBeenCalledWith(true);
      expect(blockedSocket.emit).toHaveBeenCalledWith('error', {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many connection attempts. Please slow down.',
      });
      expect(jwtService.verify).not.toHaveBeenCalledTimes(wsRateLimiter.connectionLimit + 1);
    });
  });

  describe('3. Room Authorization & Hijacking Prevention', () => {
    it('should reject unauthenticated socket trying to join a room', async () => {
      const mockSocket: any = { id: 'unauth-sock', emit: vi.fn(), join: vi.fn() };

      await gateway.handleJoinRoom({ roomId: 'room-100' }, mockSocket);

      expect(mockSocket.join).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHORIZED',
        message: 'Socket is not authenticated.',
      });
    });

    it('should reject join_room if payload is malformed or roomId is empty', async () => {
      const mockSocket: any = { id: 'auth-sock', emit: vi.fn(), join: vi.fn() };
      (gateway as any).clientMapping.set('auth-sock', 'user-legit');

      await gateway.handleJoinRoom({ roomId: '' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_ROOM',
        message: 'roomId is required.',
      });

      await gateway.handleJoinRoom(null as any, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_ROOM',
        message: 'roomId is required.',
      });
    });

    it('should strictly block user attempting to join a room they are not assigned to (Room Hijacking)', async () => {
      const mockSocket: any = { id: 'attacker-sock', emit: vi.fn(), join: vi.fn() };
      (gateway as any).clientMapping.set('attacker-sock', 'attacker-user');

      // Attacker is legitimately assigned to room-A, but tries to join victim room-B
      matchmakingService.getPlayerRoom.mockResolvedValue('assigned-room-A');

      await gateway.handleJoinRoom({ roomId: 'victim-room-B' }, mockSocket);

      expect(mockSocket.join).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHORIZED_ROOM_ACCESS',
        message: 'You are not assigned to this match room.',
      });
    });

    it('should reject join_room if room state is missing or already finished in Redis', async () => {
      const mockSocket: any = { id: 'sock-1', emit: vi.fn(), join: vi.fn() };
      (gateway as any).clientMapping.set('sock-1', 'user-1');
      matchmakingService.getPlayerRoom.mockResolvedValue('room-finished');
      matchmakingService.getRoomState.mockResolvedValue(
        JSON.stringify({ roomId: 'room-finished', status: 'GAME_FINISHED' }),
      );

      await gateway.handleJoinRoom({ roomId: 'room-finished' }, mockSocket);

      expect(mockSocket.join).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'ROOM_CLOSED',
        message: 'Room is already finished.',
      });
    });

    it('should allow legitimate assigned member to join the room', async () => {
      const mockSocket: any = { id: 'sock-good', emit: vi.fn(), join: vi.fn() };
      (gateway as any).clientMapping.set('sock-good', 'player-hero');
      matchmakingService.getPlayerRoom.mockResolvedValue('room-good');
      matchmakingService.getRoomState.mockResolvedValue(
        JSON.stringify({
          roomId: 'room-good',
          status: 'COUNTDOWN',
          players: [{ userId: 'player-hero' }],
        }),
      );

      await gateway.handleJoinRoom({ roomId: 'room-good' }, mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith('room-good');
      expect(mockSocket.emit).toHaveBeenCalledWith('room_joined', {
        roomId: 'room-good',
        status: 'joined',
      });
      expect(gamesService.updateMatchActivity).toHaveBeenCalledWith('room-good');
    });
  });

  describe('4. Identity Spoofing & Impersonation Defense', () => {
    it('should strictly IGNORE spoofed userId in submit_answer payload and use session userId', async () => {
      const mockSocket: any = { id: 'attacker-sock', emit: vi.fn() };
      (gateway as any).clientMapping.set('attacker-sock', 'real-attacker-id');

      matchmakingService.getPlayerRoom.mockResolvedValue('room-alpha');
      gamesService.submitAnswer.mockResolvedValue({ success: true });

      // Attacker payload includes spoofed userId claiming to be "victim-user"
      await gateway.handleSubmitAnswer(
        {
          questionIndex: 0,
          answer: 'B',
          userId: 'victim-user-spoofed',
        } as any,
        mockSocket,
      );

      // Verify GamesService received real-attacker-id, NEVER victim-user-spoofed!
      expect(gamesService.submitAnswer).toHaveBeenCalledWith(
        'room-alpha',
        'real-attacker-id', // MUST be authenticated userId!
        0,
        'B',
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('answer_ack', {
        questionIndex: 0,
        status: 'received',
      });
    });

    it('should strictly IGNORE spoofed roomId in submit_answer payload and fetch server-assigned room', async () => {
      const mockSocket: any = { id: 'attacker-sock-2', emit: vi.fn() };
      (gateway as any).clientMapping.set('attacker-sock-2', 'user-attacker');

      matchmakingService.getPlayerRoom.mockResolvedValue('actual-server-room-99');
      gamesService.submitAnswer.mockResolvedValue({ success: true });

      // Attacker tries to submit answer to arbitrary roomId
      await gateway.handleSubmitAnswer(
        {
          questionIndex: 0,
          answer: 'C',
          roomId: 'other-player-match-room-11',
        } as any,
        mockSocket,
      );

      // Verify GamesService received actual-server-room-99
      expect(gamesService.submitAnswer).toHaveBeenCalledWith(
        'actual-server-room-99',
        'user-attacker',
        0,
        'C',
      );
    });

    it('should reject unauthenticated socket attempting to submit answer or join matchmaking', async () => {
      const mockSocket: any = { id: 'unauth-ghost', emit: vi.fn() };

      await gateway.handleSubmitAnswer({ questionIndex: 0, answer: 'A' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHORIZED',
        message: 'Socket is not authenticated.',
      });

      await gateway.handleJoinMatchmaking({ gameModeId: 'classic_10' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHORIZED',
        message: 'Socket is not authenticated.',
      });
    });
  });

  describe('5. Answer Validation & Tampering Prevention', () => {
    beforeEach(() => {
      (gateway as any).clientMapping.set('player-sock', 'player-1');
    });

    it('should reject answer if player is not assigned to any room', async () => {
      const mockSocket: any = { id: 'player-sock', emit: vi.fn() };
      matchmakingService.getPlayerRoom.mockResolvedValue(null);

      await gateway.handleSubmitAnswer({ questionIndex: 0, answer: 'A' }, mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'NO_ROOM',
        message: 'You are not in a game room.',
      });
    });

    it('should reject answer when questionIndex is negative, NaN, or non-integer', async () => {
      const mockSocket: any = { id: 'player-sock', emit: vi.fn() };

      // Negative index
      await gateway.handleSubmitAnswer({ questionIndex: -1, answer: 'A' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Valid questionIndex and answer are required.',
      });

      // Float / non-integer index
      await gateway.handleSubmitAnswer({ questionIndex: 1.5, answer: 'A' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Valid questionIndex and answer are required.',
      });

      // NaN index
      await gateway.handleSubmitAnswer({ questionIndex: NaN, answer: 'A' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Valid questionIndex and answer are required.',
      });
    });

    it('should reject answer when answer payload is missing or empty object', async () => {
      const mockSocket: any = { id: 'player-sock', emit: vi.fn() };

      await gateway.handleSubmitAnswer(null as any, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Valid questionIndex and answer are required.',
      });
    });

    it('should reject oversized answer payload (>4096 bytes)', async () => {
      const mockSocket: any = { id: 'player-sock', emit: vi.fn() };
      const hugeAnswer = 'X'.repeat(5000);

      await gateway.handleSubmitAnswer({ questionIndex: 0, answer: hugeAnswer }, mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Answer data exceeds size limit.',
      });
      expect(gamesService.submitAnswer).not.toHaveBeenCalled();
    });

    it('should reject answer when gamesService returns error (e.g. wrong questionIndex, expired, duplicate)', async () => {
      const mockSocket: any = { id: 'player-sock', emit: vi.fn() };
      matchmakingService.getPlayerRoom.mockResolvedValue('room-active');

      // 1. Wrong question index
      gamesService.submitAnswer.mockResolvedValueOnce({ success: false, error: 'Question not active' });
      await gateway.handleSubmitAnswer({ questionIndex: 3, answer: 'A' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'SUBMIT_FAILED',
        message: 'Question not active',
      });

      // 2. Expired time (Time is up)
      gamesService.submitAnswer.mockResolvedValueOnce({ success: false, error: 'Time is up' });
      await gateway.handleSubmitAnswer({ questionIndex: 0, answer: 'A' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'SUBMIT_FAILED',
        message: 'Time is up',
      });

      // 3. Duplicate submission (Already answered)
      gamesService.submitAnswer.mockResolvedValueOnce({ success: false, error: 'Already answered' });
      await gateway.handleSubmitAnswer({ questionIndex: 0, answer: 'A' }, mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'SUBMIT_FAILED',
        message: 'Already answered',
      });
    });
  });

  describe('6. GamesService.submitAnswer Direct Integrity & Authorization', () => {
    let mockRedisService: any;
    let mockPrismaService: any;
    let mockWalletService: any;
    let mockBotService: any;
    let realGamesService: GamesService;

    beforeEach(() => {
      mockRedisService = {
        get: vi.fn(),
        set: vi.fn(),
      };
      mockPrismaService = {
        matchHold: { updateMany: vi.fn() },
      };
      mockWalletService = {};
      mockBotService = {};

      realGamesService = new GamesService(
        mockRedisService,
        mockPrismaService,
        mockWalletService,
        mockBotService,
      );
    });

    it('should reject answer if room state is corrupted (invalid JSON in Redis)', async () => {
      mockRedisService.get.mockResolvedValue('{ invalid json state !!!');

      const result = await realGamesService.submitAnswer('room-bad-json', 'user-1', 0, 'A');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Corrupted room state');
    });

    it('should reject answer if user is not in the room players roster', async () => {
      const roomState = {
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 0,
        questionEndsAt: Date.now() + 5000,
        players: [{ userId: 'legit-player-1' }, { userId: 'legit-player-2' }],
        givenAnswers: {},
      };
      mockRedisService.get.mockResolvedValue(JSON.stringify(roomState));

      const result = await realGamesService.submitAnswer('room-roster', 'intruder-player', 0, 'A');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not member of room');
    });

    it('should reject answer outside QUESTION_ACTIVE phase (e.g. COUNTDOWN or GAME_FINISHED)', async () => {
      const roomState = {
        status: 'COUNTDOWN',
        currentQuestionIndex: 0,
        questionEndsAt: Date.now() + 5000,
        players: [{ userId: 'player-1' }],
        givenAnswers: {},
      };
      mockRedisService.get.mockResolvedValue(JSON.stringify(roomState));

      const result = await realGamesService.submitAnswer('room-countdown', 'player-1', 0, 'A');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Question not active');
    });

    it('should reject answer when submitted after deadline and grace period', async () => {
      const roomState = {
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 0,
        questionEndsAt: Date.now() - 1500, // 1.5 seconds expired (> 1.0s grace period)
        players: [{ userId: 'player-1' }],
        givenAnswers: {},
      };
      mockRedisService.get.mockResolvedValue(JSON.stringify(roomState));

      const result = await realGamesService.submitAnswer('room-expired', 'player-1', 0, 'A');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Time is up');
    });

    it('should reject duplicate answers from the same player', async () => {
      const roomState = {
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 0,
        questionEndsAt: Date.now() + 5000,
        players: [{ userId: 'player-1' }],
        givenAnswers: { 'player-1': 'A' }, // Already answered
      };
      mockRedisService.get.mockResolvedValue(JSON.stringify(roomState));

      const result = await realGamesService.submitAnswer('room-dup', 'player-1', 0, 'B');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Already answered');
    });

    it('should accept valid answer, record in givenAnswers, and update activity', async () => {
      const roomState = {
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 0,
        questionEndsAt: Date.now() + 5000,
        players: [{ userId: 'player-1' }],
        givenAnswers: {},
      };
      mockRedisService.get.mockResolvedValue(JSON.stringify(roomState));

      const result = await realGamesService.submitAnswer('room-valid', 'player-1', 0, 'C');
      expect(result.success).toBe(true);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'room:room-valid',
        expect.stringContaining('"player-1":"C"'),
        3600,
      );
    });
  });

  describe('7. WebSocket Message Spam & Socket.IO Packet Middleware', () => {
    it('should throttle abusive spam of submit_answer from the same client', async () => {
      const mockSocket: any = { id: 'spam-sock', emit: vi.fn() };
      (gateway as any).clientMapping.set('spam-sock', 'spam-user');
      matchmakingService.getPlayerRoom.mockResolvedValue('room-active');
      gamesService.submitAnswer.mockResolvedValue({ success: true });

      // Action limit for submit_answer is 5 within 3s
      for (let i = 0; i < 5; i++) {
        await gateway.handleSubmitAnswer({ questionIndex: 0, answer: 'A' }, mockSocket);
        expect(mockSocket.emit).toHaveBeenCalledWith('answer_ack', expect.anything());
      }

      // 6th attempt must be rejected by WebSocket rate limiter
      await gateway.handleSubmitAnswer({ questionIndex: 0, answer: 'A' }, mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many answer submissions. Please slow down.',
      });
    });

    it('should enforce packet size limits in socket packet middleware (rejecting >32KB)', async () => {
      let registeredMiddleware: any;
      const mockSocket: any = {
        id: 'middleware-sock',
        handshake: { auth: { token: 'valid.token' }, headers: {}, address: '127.0.0.1' },
        emit: vi.fn(),
        join: vi.fn(),
        disconnect: vi.fn(),
        use: vi.fn().mockImplementation((mw) => {
          registeredMiddleware = mw;
        }),
      };

      jwtService.verify.mockReturnValue({ sub: 'user-mw-test' });
      await gateway.handleConnection(mockSocket);

      expect(registeredMiddleware).toBeDefined();

      const nextFn = vi.fn();
      const hugeData = 'Z'.repeat(35000); // 35KB packet

      await registeredMiddleware(['test_event', { data: hugeData }], nextFn);

      expect(nextFn).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Message payload size exceeds 32KB limit.',
      });
    });

    it('should terminate socket on abusive high-frequency message flood (>2x limit)', async () => {
      let registeredMiddleware: any;
      const mockSocket: any = {
        id: 'abusive-sock',
        handshake: { auth: { token: 'valid.token' }, headers: {}, address: '127.0.0.1' },
        emit: vi.fn(),
        join: vi.fn(),
        disconnect: vi.fn(),
        use: vi.fn().mockImplementation((mw) => {
          registeredMiddleware = mw;
        }),
      };

      jwtService.verify.mockReturnValue({ sub: 'abusive-user' });
      await gateway.handleConnection(mockSocket);

      const nextFn = vi.fn();

      // Flood packets beyond messageLimit * 2 (messageLimit = 25, 25 * 2 = 50)
      for (let i = 0; i < 52; i++) {
        await registeredMiddleware(['chat', { text: `spam-${i}` }], nextFn);
      }

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'SPAM_DETECTED',
        message: 'Connection terminated due to message spam.',
      });
    });
  });
});
