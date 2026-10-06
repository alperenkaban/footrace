import { create } from 'zustand';

export type GameState = 'LOBBY' | 'SEARCHING' | 'COUNTDOWN' | 'QUESTION_ACTIVE' | 'QUESTION_ENDED' | 'FINISHED';

interface PlayerResult {
  userId: string;
  scoreGained: number;
  isCorrect: boolean;
  givenAnswer: any;
}

interface LeaderboardEntry {
  userId: string;
  totalScore: number;
}

interface GameStore {
  userId: string;
  setUserId: (id: string) => void;
  
  gameState: GameState;
  setGameState: (state: GameState) => void;
  
  roomId: string | null;
  setRoomId: (id: string) => void;
  
  countdown: number;
  setCountdown: (count: number) => void;
  
  currentQuestion: any;
  setCurrentQuestion: (question: any) => void;
  
  correctAnswer: any;
  setCorrectAnswer: (answer: any) => void;
  
  playerResults: PlayerResult[];
  setPlayerResults: (results: PlayerResult[]) => void;
  
  leaderboard: LeaderboardEntry[];
  setLeaderboard: (board: LeaderboardEntry[]) => void;
  
  winnerId: string | null;
  setWinnerId: (id: string) => void;
  
  resetGame: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  userId: '', // MVP: basitlik için kullanıcı adı/id'si kendisi girilecek
  setUserId: (id) => set({ userId: id }),
  
  gameState: 'LOBBY',
  setGameState: (state) => set({ gameState: state }),
  
  roomId: null,
  setRoomId: (id) => set({ roomId: id }),
  
  countdown: 0,
  setCountdown: (count) => set({ countdown: count }),
  
  currentQuestion: null,
  setCurrentQuestion: (q) => set({ currentQuestion: q }),
  
  correctAnswer: null,
  setCorrectAnswer: (a) => set({ correctAnswer: a }),
  
  playerResults: [],
  setPlayerResults: (r) => set({ playerResults: r }),
  
  leaderboard: [],
  setLeaderboard: (b) => set({ leaderboard: b }),
  
  winnerId: null,
  setWinnerId: (id) => set({ winnerId: id }),
  
  resetGame: () => set({
    gameState: 'LOBBY',
    roomId: null,
    currentQuestion: null,
    correctAnswer: null,
    playerResults: [],
    winnerId: null,
  }),
}));
