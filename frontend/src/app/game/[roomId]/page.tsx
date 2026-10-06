'use client';

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import { useAuthStore } from "@/store/useAuthStore";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function GamePage() {
  const { user, initialized, isAuthenticated } = useAuthStore();
  const router = useRouter();
  
  const [gameState, setGameState] = useState<"PLAYING" | "FINISHED">("PLAYING");
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

  useEffect(() => {
    if (initialized && !isAuthenticated) {
      router.replace('/login');
      return;
    }

    const socket = getSocket();
    if (!socket) {
      router.replace('/lobby');
      return;
    }

    socket.on("question_started", (data) => {
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
    });

    socket.on("score_updated", (data) => {
      // data.leaderboard = [{ userId, totalScore }]
      if (data.leaderboard) {
         const newScores: Record<string, number> = {};
         data.leaderboard.forEach((p: any) => {
           newScores[p.userId] = p.totalScore;
         });
         setScores(newScores);
      }
    });

    socket.on("question_ended", (data) => {
      setQuestion((prev: any) => ({ ...prev, correctAnswer: data.correctAnswer }));
      if (user && data.playerResults) {
        const myResult = data.playerResults.find((p: any) => p.userId === user.id);
        if (myResult) {
          setResult(myResult);
        }
      }
    });

    socket.on("game_finished", (data) => {
      setWinner(data.winnerId);
      setGameState("FINISHED");
    });

    socket.on('wallet_updated', (data) => {
      useAuthStore.getState().updateWallet(data.balance, data.heldBalance);
    });

    socket.on("error", (err) => {
      alert(`Hata: ${err.message}`);
    });

    return () => {
      socket.off("question_started");
      socket.off("score_updated");
      socket.off("question_ended");
      socket.off("game_finished");
      socket.off("wallet_updated");
      socket.off("error");
    };
  }, [initialized, isAuthenticated, user, router]);

  const submitAnswer = (answer: any) => {
    if (!question || !user) return;
    const socket = getSocket();
    if (socket) {
      socket.emit("submit_answer", {
        questionIndex: question.questionIndex ?? question.index,
        answer: answer,
      });
    }
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
                onClick={() => submitAnswer(option)}
                disabled={!!question.correctAnswer}
                className={`py-4 px-6 rounded-2xl font-bold transition-all text-lg ${btnColor} disabled:opacity-90 disabled:cursor-not-allowed active:scale-[0.98]`}
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
        <div className="flex flex-col gap-4 mt-6">
          <input 
            type="number"
            value={estimationAnswer}
            onChange={(e) => setEstimationAnswer(e.target.value)}
            disabled={!!question.correctAnswer}
            placeholder="Tahmininizi girin..."
            className="w-full bg-white/5 border border-white/20 rounded-2xl p-4 text-center text-2xl font-bold text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          />
          <button 
            onClick={() => submitAnswer(Number(estimationAnswer))}
            disabled={!!question.correctAnswer || estimationAnswer === ''}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-700 text-white font-bold py-4 rounded-2xl transition-all active:scale-[0.98]"
          >
            Gönder
          </button>

          {question.correctAnswer && (
            <div className="mt-4 p-4 bg-emerald-500/20 border border-emerald-500/50 rounded-2xl text-center">
              <span className="text-gray-400 text-sm block mb-1">Doğru Cevap</span>
              <span className="text-2xl font-bold text-emerald-400">{question.correctAnswer}</span>
            </div>
          )}
        </div>
      );
    }

    if (question.type === 'RANKING') {
      return (
        <div className="flex flex-col gap-6 mt-6">
          
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold text-gray-400 uppercase tracking-wider">Sıralamanız (Önce 1. gelsin)</span>
            <div className="min-h-[100px] border border-dashed border-white/20 rounded-2xl p-4 flex flex-col gap-2 bg-black/20">
              {rankingAnswer.map((item, idx) => (
                <button
                  key={item}
                  onClick={() => handleRankingDeselect(item)}
                  disabled={!!question.correctAnswer}
                  className="w-full py-3 px-4 bg-emerald-500/20 border border-emerald-500/50 rounded-xl text-white font-bold flex gap-4 disabled:opacity-80"
                >
                  <span className="text-emerald-400">{idx + 1}.</span> {item}
                </button>
              ))}
              {rankingAnswer.length === 0 && (
                <span className="text-gray-500 text-center m-auto">Seçenekleri buraya ekleyin</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold text-gray-400 uppercase tracking-wider">Seçenekler</span>
            <div className="flex flex-wrap gap-2">
              {rankingPool.map((item) => (
                <button
                  key={item}
                  onClick={() => handleRankingSelect(item)}
                  disabled={!!question.correctAnswer}
                  className="py-3 px-6 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-bold transition-all"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <button 
            onClick={() => submitAnswer(rankingAnswer)}
            disabled={!!question.correctAnswer || rankingPool.length > 0}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-700 text-white font-bold py-4 rounded-2xl transition-all active:scale-[0.98]"
          >
            Sıralamayı Gönder
          </button>

          {question.correctAnswer && (
             <div className="mt-4 p-4 bg-emerald-500/20 border border-emerald-500/50 rounded-2xl text-center flex flex-col gap-2">
               <span className="text-gray-400 text-sm block">Doğru Sıralama</span>
               {question.correctAnswer.map((item: string, idx: number) => (
                 <div key={item} className="text-emerald-400 font-bold">{idx + 1}. {item}</div>
               ))}
             </div>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 font-[family-name:var(--font-geist-sans)]">
      <div className="w-full max-w-xl flex flex-col gap-8 items-center">
        
        {gameState === "FINISHED" && winner && (
          <div className="bg-emerald-500/20 border border-emerald-500/50 p-8 rounded-3xl text-center w-full shadow-2xl backdrop-blur-xl text-white">
            <h2 className="text-3xl font-bold mb-4">Oyun Bitti!</h2>
            <p className="text-xl font-medium mb-8 text-emerald-200">
              Kazanan: {winner === user.id ? "Sensin! 🎉" : winner}
            </p>
            <button 
              onClick={() => router.replace('/lobby')}
              className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-3 px-8 rounded-xl transition-all"
            >
              Lobiye Dön
            </button>
          </div>
        )}

        {gameState === "PLAYING" && !question && (
          <div className="text-white text-xl animate-pulse flex flex-col items-center gap-4">
            <Loader2 className="animate-spin" size={32} />
            İlk soru bekleniyor...
          </div>
        )}

        {gameState === "PLAYING" && question && (
          <div className="w-full flex flex-col gap-6 bg-white/5 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-white/10 text-white">
            <div className="flex justify-between items-center w-full">
              <span className="bg-emerald-500/20 text-emerald-300 px-4 py-1.5 rounded-full text-sm font-bold border border-emerald-500/30">
                {question.type === 'ESTIMATION' ? 'Tahmin' : question.type === 'RANKING' ? 'Sıralama' : 'Çoktan Seçmeli'}
              </span>
              <span className={`font-mono text-3xl font-black ${timeLeft <= 3 ? 'text-red-400 animate-pulse' : 'text-gray-200'}`}>
                {timeLeft}s
              </span>
            </div>
            
            <h2 className="text-2xl font-bold text-center mt-2 leading-relaxed">{question.text}</h2>
            
            {renderQuestionInput()}

            {result && (
              <div className="text-center mt-6 p-4 bg-black/40 rounded-2xl border border-white/5">
                <div className={`font-black text-2xl mb-1 ${result.scoreGained > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {result.scoreGained > 0 ? `+${result.scoreGained} Puan!` : "Puan Alamadın"}
                </div>
                {result.givenAnswer && (
                  <div className="text-gray-400 text-sm">
                    Senin Cevabın: {Array.isArray(result.givenAnswer) ? result.givenAnswer.join(' > ') : result.givenAnswer}
                  </div>
                )}
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-white/10">
              <h3 className="font-bold text-gray-400 uppercase text-xs tracking-wider mb-4">Skor Tablosu</h3>
              <div className="flex flex-col gap-2">
                {Object.entries(scores).sort((a,b) => b[1] - a[1]).map(([id, score]) => (
                  <div key={id} className={`flex justify-between p-3 rounded-xl border ${id === user.id ? 'bg-emerald-500/10 border-emerald-500/30 font-bold text-emerald-300' : 'bg-white/5 border-transparent text-gray-300'}`}>
                    <span>{id === user.id ? "Sen" : id.substring(0,8)}</span>
                    <span>{score} Puan</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
