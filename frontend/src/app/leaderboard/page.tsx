'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Trophy, Medal, Bot } from "lucide-react";

interface LeaderboardPlayer {
  rank: number;
  userId: string;
  name: string;
  isBot: boolean;
  rating: number;
  wins: number;
}

export default function LeaderboardPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/leaderboard`);
        const result = await res.json();
        if (result.success) {
          setPlayers(result.data);
        }
      } catch (err) {
        console.error("Leaderboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchLeaderboard();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 p-6 font-[family-name:var(--font-geist-sans)] text-white flex flex-col items-center">
      <div className="w-full max-w-2xl flex flex-col gap-6 relative">
        <button 
          onClick={() => router.back()}
          className="absolute -left-2 top-0 p-3 bg-white/5 hover:bg-white/10 rounded-full transition-all"
        >
          <ArrowLeft size={24} />
        </button>

        <div className="text-center mt-2 mb-6">
          <h1 className="text-4xl font-black uppercase tracking-tight flex items-center justify-center gap-3">
            <Trophy className="text-yellow-400" size={36} />
            Liderlik Tablosu
          </h1>
          <p className="text-gray-400 mt-2 font-medium">En yüksek rating'e sahip ustalar (Top 100)</p>
        </div>

        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="animate-spin text-emerald-500" size={48} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {players.length === 0 && (
              <div className="text-center text-gray-500 p-8">Henüz kimse listeye giremedi.</div>
            )}
            
            {players.map((player) => {
              let rankStyle = "bg-white/5 border-transparent text-gray-200";
              let RankIcon = null;
              
              if (player.rank === 1) {
                rankStyle = "bg-yellow-500/20 border-yellow-500/50 text-yellow-300 font-bold scale-[1.02] shadow-lg shadow-yellow-500/10";
                RankIcon = <Trophy size={20} className="text-yellow-400" />;
              } else if (player.rank === 2) {
                rankStyle = "bg-gray-300/20 border-gray-400/50 text-gray-300 font-bold";
                RankIcon = <Medal size={20} className="text-gray-300" />;
              } else if (player.rank === 3) {
                rankStyle = "bg-amber-700/20 border-amber-700/50 text-amber-500 font-bold";
                RankIcon = <Medal size={20} className="text-amber-500" />;
              }

              return (
                <div 
                  key={player.userId}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${rankStyle}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-8 text-center font-black text-xl opacity-80">
                      {player.rank}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-lg flex items-center gap-2">
                        {player.name}
                        {player.isBot && <Bot size={16} className="text-emerald-400 opacity-80" />}
                      </span>
                      <span className="text-xs opacity-60 font-medium">Toplam Galibiyet: {player.wins}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-2xl font-black">{player.rating}</span>
                    <span className="text-xs uppercase tracking-wider opacity-60">Rating</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
