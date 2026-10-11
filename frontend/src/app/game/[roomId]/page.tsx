'use client';

import { useEffect, useState, useRef, useCallback } from "react";
import { useSocket } from "@/providers/SocketProvider";
import { useAuthStore } from "@/store/useAuthStore";
import { useRouter, useParams } from "next/navigation";
import { Loader2, Trophy, Coins, Clock, RotateCcw, CheckCircle2, XCircle } from "lucide-react";

export default function GamePage() {
  const { user, initialized, isAuthenticated } = useAuthStore();
  const router = useRouter();
  const params = useParams();
  const roomId = params.roomId as string;
  const { socket } = useSocket();
  
  const [gameState, setGameState] = useState<"WAITING" | "PLAYING" | "FINISHED">("WAITING");
  const [question, setQuestion] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [result, setResult] = useState<any>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [winner, setWinner] = useState<string | null>(null);
  const [rewards, setRewards] = useState<{ coins: number; ratingChange: number } | null>(null);
  const [finalLeaderboard, setFinalLeaderboard] = useState<any[]>([]);

  // BUG FIX: track answered state separately to prevent double-submit
  const [isAnswered, setIsAnswered] = useState(false);

  // Estimation State
  const [estimationAnswer, setEstimationAnswer] = useState<string>('');
  
  // Ranking State
  const [rankingPool, setRankingPool] = useState<string[]>([]);
  const [rankingAnswer, setRankingAnswer] = useState<string[]>([]);

  // BUG FIX: Use ref to track join_room so we don't send it multiple times on re-render
  const joinedRoomRef = useRef<string | null>(null);
  // BUG FIX: use ref for timer to clean up properly
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Join room whenever socket or roomId becomes available
  useEffect(() => {
    if (!socket || !roomId) return;
    if (joinedRoomRef.current === roomId) return; // already joined

    console.log('[GAME PAGE] Emitting join_room for:', roomId);
    socket.emit('join_room', { roomId });
    joinedRoomRef.current = roomId;
  }, [socket, roomId]);

  // Auth guard
  useEffect(() => {
    if (initialized && !isAuthenticated) {
      console.log('[GAME PAGE] Not authenticated, redirecting to login');
      router.replace('/login');
    }
  }, [initialized, isAuthenticated, router]);

  // Socket event listeners — run once socket is ready
  useEffect(() => {
    if (!socket) {
      console.log('[GAME PAGE] No socket yet, waiting...');
      return;
    }
    console.log('[GAME PAGE] Setting up socket event listeners');

    const onQuestionStarted = (data: any) => {
      console.log('[GAME PAGE] question_started received:', data);
      
      // BUG FIX: clear previous timer before starting new one
      clearTimer();

      setGameState("PLAYING");
      setQuestion(data.question || data);
      setResult(null);
      setIsAnswered(false);
      setEstimationAnswer('');
      
      if (data.type === 'RANKING' && data.metadata?.items) {
        setRankingPool([...data.metadata.items]);
        setRankingAnswer([]);
      }

      // BUG FIX: prefer serverTime from server to avoid clock drift
      const serverNow = data.serverTime || Date.now();
      const clientNow = Date.now();
      const drift = clientNow - serverNow;
      const endTime = (data.questionEndsAt) 
        ? data.questionEndsAt + drift 
        : (Date.now() + (data.durationMs || 10000));

      timerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) clearTimer();
      }, 1000);
    };

    const onScoreUpdated = (data: any) => {
      console.log('[GAME PAGE] score_updated:', data);
      if (data.leaderboard) {
         const newScores: Record<string, number> = {};
         data.leaderboard.forEach((p: any) => {
           newScores[p.userId] = p.totalScore;
         });
         setScores(newScores);
      }
    };

    const onQuestionEnded = (data: any) => {
      console.log('[GAME PAGE] question_ended:', data);
      // BUG FIX: stop timer on question end
      clearTimer();
      setTimeLeft(0);
      setIsAnswered(true); // prevent further submissions

      setQuestion((prev: any) => prev ? { ...prev, correctAnswer: data.correctAnswer } : prev);
      if (user && data.playerResults) {
        const myResult = data.playerResults.find((p: any) => p.userId === user.id);
        if (myResult) {
          setResult(myResult);
        }
      }
    };

    const onGameFinished = (data: any) => {
      console.log('[GAME PAGE] game_finished:', data);
      clearTimer();
      setWinner(data.winnerId);
      setRewards(data.rewards || null);
      setFinalLeaderboard(data.finalLeaderboard || []);
      setGameState("FINISHED");
    };

    const onWalletUpdated = (data: any) => {
      useAuthStore.getState().updateWallet(data.balance, data.heldBalance);
    };

    const onError = (err: any) => {
      console.error('[GAME PAGE] Error:', err);
      // BUG FIX: don't block with alert — show inline or just log
      console.warn(`Game error: ${err.message || JSON.stringify(err)}`);
    };

    socket.on("question_started", onQuestionStarted);
    socket.on("score_updated", onScoreUpdated);
    socket.on("question_ended", onQuestionEnded);
    socket.on("game_finished", onGameFinished);
    socket.on("wallet_updated", onWalletUpdated);
    socket.on("error", onError);

    return () => {
      socket.off("question_started", onQuestionStarted);
      socket.off("score_updated", onScoreUpdated);
      socket.off("question_ended", onQuestionEnded);
      socket.off("game_finished", onGameFinished);
      socket.off("wallet_updated", onWalletUpdated);
      socket.off("error", onError);
    };
  }, [socket, user, clearTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const submitAnswer = useCallback((answer: any) => {
    // BUG FIX: Guard against double-submit
    if (!question || !user || !socket || isAnswered) return;
    setIsAnswered(true);
    
    const qIndex = question.questionIndex ?? question.index ?? 0;
    console.log('[GAME PAGE] Submitting answer:', answer, 'for question index:', qIndex);
    socket.emit("submit_answer", {
      questionIndex: qIndex,
      answer: answer,
    });
  }, [question, user, socket, isAnswered]);

  const handleRankingSelect = (item: string) => {
    if (isAnswered) return;
    setRankingPool(prev => prev.filter(i => i !== item));
    setRankingAnswer(prev => [...prev, item]);
  };

  const handleRankingDeselect = (item: string) => {
    if (isAnswered) return;
    setRankingAnswer(prev => prev.filter(i => i !== item));
    setRankingPool(prev => [...prev, item]);
  };

  if (!initialized || !isAuthenticated || !user) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>;
  }

  // Soru Tipi Render Fonksiyonları
  const renderQuestionInput = () => {
    if (!question) return null;

    if (question.type === 'MULTIPLE_CHOICE') {
      return (
        <div className="grid grid-cols-1 gap-3 mt-6">
          {question.metadata?.options?.map((option: string) => {
            let btnColor = "bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200";
            if (question.correctAnswer) {
              if (option === question.correctAnswer) {
                btnColor = "bg-emerald-500 border-emerald-400 text-white";
              } else if (result && result.givenAnswer === option && !result.isCorrect) {
                btnColor = "bg-red-500/40 border-red-400 text-white"; // BUG FIX: highlight wrong selection
              }
            }
            return (
              <button
                key={option}
                onClick={() => !isAnswered && submitAnswer(option)}
                disabled={isAnswered}
                className={`w-full py-4 px-6 rounded-xl font-bold text-lg transition-all ${btnColor} disabled:cursor-not-allowed`}
              >
                {option}
              </button>
            );
          })}
        </div>
      );
    }

    if (question.type === 'ESTIMATION') {
      return (
        <div className="flex flex-col items-center gap-4 mt-6">
          <input
            type="number"
            value={estimationAnswer}
            onChange={(e) => setEstimationAnswer(e.target.value)}
            placeholder="Tahmininizi yazın..."
            disabled={isAnswered}
            className="w-full max-w-xs bg-white/10 border border-white/20 rounded-xl py-3 px-4 text-white text-center text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
          />
          <button
            onClick={() => submitAnswer(Number(estimationAnswer))}
            disabled={isAnswered || !estimationAnswer}
            className="w-full max-w-xs py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnswered ? 'Cevap Gönderildi' : 'Gönder'}
          </button>
          {question.correctAnswer !== undefined && (
            <p className="text-emerald-400 font-bold text-lg">Doğru Cevap: {question.correctAnswer}</p>
          )}
        </div>
      );
    }

    if (question.type === 'RANKING') {
      return (
        <div className="mt-6">
          <p className="text-gray-400 text-sm mb-2">Sıralamak için seçin:</p>
          <div className="flex flex-col gap-2 mb-4">
            {rankingAnswer.map((item, idx) => (
              <button
                key={item}
                onClick={() => handleRankingDeselect(item)}
                disabled={isAnswered}
                className="py-2 px-4 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-white text-left disabled:cursor-not-allowed"
              >
                {idx + 1}. {item}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {rankingPool.map((item) => (
              <button
                key={item}
                onClick={() => handleRankingSelect(item)}
                disabled={isAnswered}
                className="py-2 px-4 bg-white/5 border border-white/10 rounded-lg text-gray-300 text-left hover:bg-white/10 disabled:cursor-not-allowed"
              >
                {item}
              </button>
            ))}
          </div>
          {rankingPool.length === 0 && rankingAnswer.length > 0 && !isAnswered && (
            <button
              onClick={() => submitAnswer(rankingAnswer)}
              className="w-full mt-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl"
            >
              Sıralamayı Gönder
            </button>
          )}
        </div>
      );
    }

    return null;
  };

  // GAME FINISHED SCREEN
  if (gameState === "FINISHED") {
    const isWinner = winner === user?.id;
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white/5 backdrop-blur-xl rounded-3xl p-6 border border-white/10 flex flex-col items-center shadow-2xl">
          {/* Winner Icon & Header */}
          <div 
            className="w-20 h-20 rounded-full flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
            style={{
              background: isWinner 
                ? 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)' 
                : 'linear-gradient(135deg, #ef4444 0%, #f97316 100%)'
            }}
          >
            {isWinner ? <Trophy className="text-white" size={36} /> : <span className="text-3xl">💔</span>}
          </div>

          <h1 className={`text-3xl font-black mb-1 tracking-tight ${isWinner ? 'text-emerald-400' : 'text-red-400'}`}>
            {isWinner ? 'KAZANDIN!' : 'KAYBETTİN'}
          </h1>
          <p className="text-gray-400 text-xs text-center mb-6">
            {isWinner ? 'Tebrikler! Rakibini mağlup ederek ödülleri topladın.' : 'Üzülme, futbol şansı bir sonraki maçta seninle olabilir.'}
          </p>

          {/* Rewards Grid */}
          <div className="w-full grid grid-cols-2 gap-3 mb-6">
            <div className="bg-black/40 rounded-2xl p-3 flex flex-col items-center border border-white/5">
              <span className="text-xs text-gray-400 mb-1">Altın</span>
              <div className="flex items-center gap-1.5">
                <span className={`text-base font-bold ${isWinner ? 'text-amber-400' : 'text-gray-400'}`}>
                  {isWinner ? `+${rewards?.coins || 180}` : '0'}
                </span>
                <Coins size={14} className="text-amber-400" />
              </div>
            </div>
            <div className="bg-black/40 rounded-2xl p-3 flex flex-col items-center border border-white/5">
              <span className="text-xs text-gray-400 mb-1">Puan (RP)</span>
              <span className={`text-base font-bold ${isWinner ? 'text-emerald-400' : 'text-red-400'}`}>
                {isWinner ? `+${rewards?.ratingChange || 20}` : `-${rewards?.ratingChange || 10}`}
              </span>
            </div>
          </div>

          {/* Leaderboard */}
          <div className="w-full bg-black/40 rounded-2xl p-4 border border-white/5 mb-6">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Maç Sonucu</h3>
            <div className="space-y-2">
              {finalLeaderboard.length > 0 ? (
                finalLeaderboard.map((player: any, idx: number) => {
                  const isMe = player.userId === user?.id;
                  const isMatchWinner = player.userId === winner;
                  return (
                    <div 
                      key={player.userId || idx} 
                      className={`flex items-center justify-between p-3 rounded-xl border ${
                        isMatchWinner 
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                          : 'bg-white/5 border-white/5 text-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500">#{idx + 1}</span>
                        <span className="font-semibold text-sm flex items-center gap-1">
                          {isMe ? `${user?.displayName} (Sen)` : (player.isBot ? `🤖 Bot Oyuncu` : `Rakip`)}
                          {isMatchWinner && <span className="text-amber-400 text-xs">👑</span>}
                        </span>
                      </div>
                      <span className="font-bold text-sm">{player.score ?? player.totalScore ?? 0} Puan</span>
                    </div>
                  );
                })
              ) : (
                Object.entries(scores).map(([id, score]) => {
                  const isMe = id === user?.id;
                  const isMatchWinner = id === winner;
                  return (
                    <div key={id} className={`flex justify-between p-3 rounded-xl ${isMatchWinner ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-gray-300'}`}>
                      <span className="font-medium text-sm flex items-center gap-1">
                        {isMe ? `${user?.displayName} (Sen)` : 'Rakip'}
                        {isMatchWinner && <span className="text-amber-400 text-xs">👑</span>}
                      </span>
                      <span className="font-bold text-sm">{score} Puan</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="w-full flex flex-col gap-2.5">
            <button
              onClick={() => router.push('/lobby')}
              className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} />
              <span>Tekrar Oyna</span>
            </button>
            <button
              onClick={() => router.push('/lobby')}
              className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-300 font-semibold rounded-xl border border-white/10 transition-colors"
            >
              Lobiye Dön
            </button>
          </div>
        </div>
      </div>
    );
  }

  // WAITING / PLAYING SCREEN
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      {gameState === "WAITING" && !question && (
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-emerald-400" size={48} />
          <p className="text-white text-xl font-bold">Oyun başlatılıyor...</p>
          <p className="text-gray-400 text-sm">Sorular yükleniyor, lütfen bekleyin.</p>
        </div>
      )}

      {question && (
        <div className="w-full max-w-md">
          {/* Header Bar: Question index & Timer */}
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold tracking-wider uppercase text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
              Soru {(question.questionIndex ?? question.index ?? 0) + 1}
            </span>
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-mono font-bold text-sm ${
              timeLeft <= 3 ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' : 'bg-white/10 text-white border border-white/10'
            }`}>
              <Clock size={14} />
              <span>{timeLeft}s</span>
            </div>
          </div>

          {/* Timer Progress Bar */}
          <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mb-4">
            <div 
              className={`h-full transition-all duration-1000 ease-linear rounded-full ${
                timeLeft <= 3 ? 'bg-red-500' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, (timeLeft / 10) * 100))}%` }}
            />
          </div>

          {/* Score Header */}
          {Object.keys(scores).length > 0 && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {Object.entries(scores).map(([id, score]) => {
                const isMe = id === user?.id;
                return (
                  <div 
                    key={id} 
                    className={`px-3 py-2 rounded-xl flex items-center justify-between border ${
                      isMe 
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' 
                        : 'bg-white/5 border-white/10 text-gray-300'
                    }`}
                  >
                    <span className="text-xs font-medium truncate max-w-[90px]">
                      {isMe ? 'Sen' : 'Rakip'}
                    </span>
                    <span className="text-sm font-bold">{score} Puan</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Question Card */}
          <div className="w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white text-center mb-2">
              {question.text || question.questionText}
            </h2>
            {renderQuestionInput()}
          </div>

          {/* Result Feedback */}
          {result && (
            <div className={`mt-4 p-4 rounded-xl text-center font-bold ${result.isCorrect ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
              {result.isCorrect ? `✅ Doğru! +${result.scoreGained} puan` : '❌ Yanlış!'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
