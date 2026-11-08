import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameGateway } from './game.gateway.js';

describe('GameGateway - handleJoinRoom Authorization', () => {
  let gateway: GameGateway;
  let matchmakingService: any;
  let gamesService: any;
  let jwtService: any;

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

    gateway = new GameGateway(matchmakingService, gamesService, jwtService);
  });

  it('should reject join_room if socket is unauthenticated (no userId in clientMapping)', async () => {
    const mockSocket: any = {
      id: 'unauth-socket',
      join: vi.fn(),
      emit: vi.fn(),
    };

    await gateway.handleJoinRoom({ roomId: 'room-123' }, mockSocket);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'UNAUTHORIZED',
      message: 'Socket is not authenticated.',
    });
  });

  it('should reject join_room if roomId is missing or empty', async () => {
    const mockSocket: any = {
      id: 'auth-socket',
      join: vi.fn(),
      emit: vi.fn(),
    };
    (gateway as any).clientMapping.set('auth-socket', 'user-1');

    await gateway.handleJoinRoom({ roomId: '' }, mockSocket);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'INVALID_ROOM',
      message: 'roomId is required.',
    });
  });

  it('should block unauthorized user from joining a room they do not belong to', async () => {
    const mockSocket: any = {
      id: 'attacker-socket',
      join: vi.fn(),
      emit: vi.fn(),
    };
    (gateway as any).clientMapping.set('attacker-socket', 'attacker-user');
    matchmakingService.getPlayerRoom.mockResolvedValue('assigned-room-xyz');

    await gateway.handleJoinRoom({ roomId: 'target-victim-room' }, mockSocket);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(gamesService.updateMatchActivity).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'UNAUTHORIZED_ROOM_ACCESS',
      message: 'You are not assigned to this match room.',
    });
  });

  it('should block user if they currently have no active assigned room', async () => {
    const mockSocket: any = {
      id: 'idle-socket',
      join: vi.fn(),
      emit: vi.fn(),
    };
    (gateway as any).clientMapping.set('idle-socket', 'idle-user');
    matchmakingService.getPlayerRoom.mockResolvedValue(null);

    await gateway.handleJoinRoom({ roomId: 'some-random-uuid' }, mockSocket);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'UNAUTHORIZED_ROOM_ACCESS',
      message: 'You are not assigned to this match room.',
    });
  });

  it('should allow assigned authorized player to join the room and update activity', async () => {
    const mockSocket: any = {
      id: 'legit-socket',
      join: vi.fn(),
      emit: vi.fn(),
    };
    (gateway as any).clientMapping.set('legit-socket', 'legit-user');
    matchmakingService.getPlayerRoom.mockResolvedValue('match-room-valid-456');
    matchmakingService.getRoomState.mockResolvedValue(
      JSON.stringify({
        roomId: 'match-room-valid-456',
        status: 'PLAYER_READY',
        maxPlayers: 10,
        players: [{ userId: 'legit-user' }],
      }),
    );

    await gateway.handleJoinRoom({ roomId: 'match-room-valid-456' }, mockSocket);

    expect(mockSocket.join).toHaveBeenCalledWith('match-room-valid-456');
    expect(gamesService.updateMatchActivity).toHaveBeenCalledWith('match-room-valid-456');
    expect(mockSocket.emit).toHaveBeenCalledWith('room_joined', {
      roomId: 'match-room-valid-456',
      status: 'joined',
    });
  });

  it('should reject join_room if room state does not exist in Redis', async () => {
    const mockSocket: any = {
      id: 'ghost-socket',
      join: vi.fn(),
      emit: vi.fn(),
    };
    (gateway as any).clientMapping.set('ghost-socket', 'ghost-user');
    matchmakingService.getPlayerRoom.mockResolvedValue('ghost-room');
    matchmakingService.getRoomState.mockResolvedValue(null);

    await gateway.handleJoinRoom({ roomId: 'ghost-room' }, mockSocket);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'ROOM_NOT_FOUND',
      message: 'Room not found.',
    });
  });

  it('should reject join_room if room is already GAME_FINISHED', async () => {
    const mockSocket: any = {
      id: 'late-socket',
      join: vi.fn(),
      emit: vi.fn(),
    };
    (gateway as any).clientMapping.set('late-socket', 'late-user');
    matchmakingService.getPlayerRoom.mockResolvedValue('finished-room');
    matchmakingService.getRoomState.mockResolvedValue(
      JSON.stringify({
        roomId: 'finished-room',
        status: 'GAME_FINISHED',
        players: [{ userId: 'late-user' }],
      }),
    );

    await gateway.handleJoinRoom({ roomId: 'finished-room' }, mockSocket);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'ROOM_CLOSED',
      message: 'Room is already finished.',
    });
  });

  it('should reject join_room if user is not a member of the room (capacity exceeded/unauthorized)', async () => {
    const mockSocket: any = {
      id: 'outsider-socket',
      join: vi.fn(),
      emit: vi.fn(),
    };
    (gateway as any).clientMapping.set('outsider-socket', 'outsider-user');
    matchmakingService.getPlayerRoom.mockResolvedValue('full-room');
    matchmakingService.getRoomState.mockResolvedValue(
      JSON.stringify({
        roomId: 'full-room',
        status: 'PLAYER_READY',
        maxPlayers: 2,
        players: [{ userId: 'p1' }, { userId: 'p2' }],
      }),
    );

    await gateway.handleJoinRoom({ roomId: 'full-room' }, mockSocket);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'ROOM_CAPACITY_EXCEEDED',
      message: 'Room capacity exceeded or user is not a member of this room.',
    });
  });
});

