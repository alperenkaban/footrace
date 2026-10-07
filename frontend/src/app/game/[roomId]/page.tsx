'use client';

import { useEffect, useState } from "react";
import { useSocket } from "@/providers/SocketProvider";
import { useAuthStore } from "@/store/useAuthStore";
import { useRouter, useParams } from "next/navigation";
import { Loader2 } from "lucide-react";

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

  // Estimation State
  const [estimationAnswer, setEstimationAnswer] = useState<string>('');
  
  // Ranking State
  const [rankingPool, setRankingPool] = useState<string[]>([]);
  const [rankingAnswer, setRankingAnswer] = useState<string[]>([]);

  // Join room and setup listeners
  useEffect(() => {
    console.log('[GAME PAGE] useEffect running. roomId:', roomId, 'socket:', socket ? 'exists' : 'null', 'connected:', socket?.connected);
    
    if (initialized && !isAuthenticated) {
      console.log('[GAME PAGE] Not authenticated, redirecting to login');
      router.replace('/login');
      return;
    }

    if (!socket) {
      console.log('[GAME PAGE] No socket yet, waiting...');
      return; // Don't redirect! Just wait for socket to be ready.
    }

    // Join the socket room so we receive server.to(roomId) events
    if (roomId) {
      console.log('[GAME PAGE] Emitting join_room for:', roomId);
      socket.emit('join_room', { roomId });
    }

    const onQuestionStarted = (data: any) => {
      console.log('[GAME PAGE] question_started received:', data);
      setGameState("PLAYING");
      setQuestion(data.question || data);
      setResult(null); 
      setEstimationAnswer('');
      
      if (data.type === 'RANKING' && data.metadata?.items) {
        setRankingPool([...data.metadata.items]);
        setRankingAnswer([]);
      }

      const endTime = data.questionEndsAt || (Date.now() + data.durationMs);
      const timer = setInterval(() => {
        const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) clearInterval(timer);
      }, 1000);
      
      return () => clearInterval(timer);
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
      setQuestion((prev: any) => ({ ...prev, correctAnswer: data.correctAnswer }));
      if (user && data.playerResults) {
        const myResult = data.playerResults.find((p: any) => p.userId === user.id);
        if (myResult) {
          setResult(myResult);
        }
      }
    };

    const onGameFinished = (data: any) => {
      console.log('[GAME PAGE] game_finished:', data);
      setWinner(data.winnerId);
      setGameState("FINISHED");
    };

    const onWalletUpdated = (data: any) => {
      useAuthStore.getState().updateWallet(data.balance, data.heldBalance);
    };

    const onError = (err: any) => {
      console.error('[GAME PAGE] Error:', err);
      alert(`Hata: ${err.message || JSON.stringify(err)}`);
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
  }, [initialized, isAuthenticated, user, router, socket, roomId]);

  const submitAnswer = (answer: any) => {
    if (!question || !user || !socket) return;
    console.log('[GAME PAGE] Submitting answer:', answer);
    socket.emit("submit_answer", {
      questionIndex: question.questionIndex ?? question.index,
      answer: answer,
    });
  };

  const handleRankingSelect = (item: string) => {
    setRankingPool(prev => prev.filter(i => i !== item));
    setRankingAnswer(prev => [...prev, item]);
  };

  const handleRankingDeselect = (item: string) => {
    setRankingAnswer(prev => prev.filter(i => i !== item));
    setRankingPool(prev => [...prev, item]);
  };

  if (!initialized || !isAuthenticated || !user) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>;
  }

  // Soru Tipi Render Fonksiyonları
  const renderQuestionInput = () => {
    if (!question) return null;
    const isAnswered = result !== null;

    if (question.type === 'MULTIPLE_CHOICE') {
      return (
        <div className="grid grid-cols-1 gap-3 mt-6">
          {question.metadata?.options?.map((option: string) => {
            let btnColor = "bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200";
            if (question.correctAnswer) {
              if (option === question.correctAnswer) {
                btnColor = "bg-emerald-500 border-emerald-400 text-white"; // Doğru Cevap
              }
            }
            return (
              <button
                key={option}
                onClick={() => !isAnswered && submitAnswer(option)}
                disabled={isAnswered}
                className={`w-full py-4 px-6 rounded-xl font-bold text-lg transition-all ${btnColor}`}
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
            className="w-full max-w-xs bg-white/10 border border-white/20 rounded-xl py-3 px-4 text-white text-center text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            onClick={() => submitAnswer(Number(estimationAnswer))}
            disabled={isAnswered || !estimationAnswer}
            className="w-full max-w-xs py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            Gönder
          </button>
          {question.correctAnswer && (
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
                onClick={() => !isAnswered && handleRankingDeselect(item)}
                className="py-2 px-4 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-white text-left"
              >
                {idx + 1}. {item}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {rankingPool.map((item) => (
              <button
                key={item}
                onClick={() => !isAnswered && handleRankingSelect(item)}
                className="py-2 px-4 bg-white/5 border border-white/10 rounded-lg text-gray-300 text-left hover:bg-white/10"
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
        <div className="text-6xl mb-4">{isWinner ? '🏆' : '😢'}</div>
        <h1 className={`text-4xl font-black mb-2 ${isWinner ? 'text-emerald-400' : 'text-red-400'}`}>
          {isWinner ? 'KAZANDINIZ!' : 'KAYBETTİNİZ'}
        </h1>
        
        <div className="w-full max-w-sm mt-8 bg-white/5 rounded-2xl p-6 border border-white/10">
          <h3 className="text-lg font-bold text-white mb-4">Skor Tablosu</h3>
          {Object.entries(scores).map(([id, score]) => (
            <div key={id} className={`flex justify-between py-2 px-3 rounded-lg mb-1 ${id === user?.id ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-300'}`}>
              <span className="font-medium">{id === user?.id ? 'Sen' : 'Rakip'}</span>
              <span className="font-bold">{score} puan</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push('/lobby')}
          className="mt-8 px-8 py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl text-lg transition-colors"
        >
          Lobiye Dön
        </button>
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
          {/* Timer & Question Index */}
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-400 text-sm font-medium">
              Soru {(question.questionIndex ?? question.index ?? 0) + 1}
            </span>
            <div className={`px-4 py-1 rounded-full font-bold text-lg ${timeLeft <= 3 ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white'}`}>
              ⏱️ {timeLeft}s
            </div>
          </div>

          {/* Score Display */}
          {Object.keys(scores).length > 0 && (
            <div className="flex justify-between mb-4 px-2">
              {Object.entries(scores).map(([id, score]) => (
                <span key={id} className={`text-sm font-bold ${id === user?.id ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {id === user?.id ? 'Sen' : 'Rakip'}: {score}
                </span>
              ))}
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
            <div className={`mt-4 p-4 rounded-xl text-center font-bold ${result.isCorrect ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
              {result.isCorrect ? `✅ Doğru! +${result.score} puan` : '❌ Yanlış!'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
