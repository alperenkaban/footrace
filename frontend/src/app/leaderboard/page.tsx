'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Trophy, Medal, Bot, Swords, Flame } from "lucide-react";
import { AdBanner } from "@/components/AdBanner";

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
  const [activeTab, setActiveTab] = useState<'rating' | 'wins'>('rating');
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://footrace-6lnc.onrender.com';

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/leaderboard?type=${activeTab}`);
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
  }, [activeTab, API_URL]);

  return (
    <div className="min-h-screen bg-gray-950 p-4 font-[family-name:var(--font-geist-sans)] text-white flex flex-col items-center">
      <div className="w-full max-w-md flex flex-col gap-5 relative">
        {/* HEADER */}
        <div className="flex items-center justify-between py-2">
          <button 
            onClick={() => router.push('/lobby')}
            className="p-2.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-colors flex items-center gap-1.5 text-gray-300 hover:text-white"
          >
            <ArrowLeft size={18} />
            <span className="text-xs font-bold">Lobi</span>
          </button>

          <h1 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
            <Trophy className="text-yellow-400" size={22} />
            <span>LİDERLİK TABLOSU</span>
          </h1>

          <div className="w-10" />
        </div>

        {/* TABS (EN ÇOK PUAN vs EN ÇOK MAÇ KAZANAN) */}
        <div className="grid grid-cols-2 gap-2 p-1.5 bg-black/40 rounded-2xl border border-white/10">
          <button
            onClick={() => setActiveTab('rating')}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'rating'
                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black shadow-lg shadow-yellow-500/10'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Flame size={15} />
            <span>En Çok Puan (RP)</span>
          </button>

          <button
            onClick={() => setActiveTab('wins')}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'wins'
                ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/10'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Swords size={15} />
            <span>En Çok Kazanan</span>
          </button>
        </div>

        {/* SUBTITLE */}
        <p className="text-center text-xs text-gray-400 -mt-2">
          {activeTab === 'rating' 
            ? 'En yüksek rating puanına (RP) sahip şampiyonlar' 
            : 'En çok maç kazanan namağlup yarışmacılar'}
        </p>

        {/* LIST */}
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="animate-spin text-emerald-500" size={40} />
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {players.length === 0 && (
              <div className="text-center text-gray-500 p-8">Henüz sıralamaya giren oyuncu bulunamadı.</div>
            )}
            
            {players.map((player) => {
              let rankStyle = "bg-white/5 border-white/5 text-gray-200";
              let RankIcon = null;
              
              if (player.rank === 1) {
                rankStyle = "bg-yellow-500/15 border-yellow-500/40 text-yellow-300 font-bold shadow-lg shadow-yellow-500/5";
                RankIcon = <Trophy size={18} className="text-yellow-400 shrink-0" />;
              } else if (player.rank === 2) {
                rankStyle = "bg-gray-300/15 border-gray-400/40 text-gray-300 font-bold";
                RankIcon = <Medal size={18} className="text-gray-300 shrink-0" />;
              } else if (player.rank === 3) {
                rankStyle = "bg-amber-700/15 border-amber-700/40 text-amber-500 font-bold";
                RankIcon = <Medal size={18} className="text-amber-500 shrink-0" />;
              }

              return (
                <div 
                  key={player.userId}
                  className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${rankStyle}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 text-center font-black text-lg opacity-80 flex items-center justify-center">
                      {RankIcon || player.rank}
                    </div>

                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-bold truncate flex items-center gap-1.5">
                        {player.name}
                        {player.isBot && <Bot size={14} className="text-emerald-400 opacity-80" />}
                      </span>
                      <span className="text-[11px] opacity-60 font-medium">
                        {activeTab === 'rating' ? `Galibiyet: ${player.wins}` : `Rating: ${player.rating} RP`}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0 pl-2">
                    {activeTab === 'rating' ? (
                      <>
                        <span className="text-lg font-black text-amber-400">{player.rating}</span>
                        <span className="text-[10px] uppercase tracking-wider opacity-60 font-semibold">RP</span>
                      </>
                    ) : (
                      <>
                        <span className="text-lg font-black text-emerald-400">{player.wins}</span>
                        <span className="text-[10px] uppercase tracking-wider opacity-60 font-semibold">Galibiyet</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* BOTTOM AD BANNER */}
        <AdBanner placement="leaderboard" className="mt-2" />
      </div>
    </div>
  );
}
