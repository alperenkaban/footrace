'use client';

import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSocket } from '@/providers/SocketProvider';
import { Coins, Trophy, LogOut, Loader2, Zap } from 'lucide-react';

export default function LobbyPage() {
  const { user, isAuthenticated, initialized, logout } = useAuthStore();
  const router = useRouter();
  const { socket, socketState } = useSocket();
  
  const [matchStatus, setMatchStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialized && !isAuthenticated) {
      router.replace('/login');
      return;
    }
  }, [initialized, isAuthenticated, router]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    console.log('[LOBBY] Setting up socket listeners. Socket connected:', socket.connected);

    const onWalletUpdated = (data: any) => {
      console.log('[LOBBY] wallet_updated:', data);
      useAuthStore.getState().updateWallet(data.balance, data.heldBalance);
    };

    const onError = (err: any) => {
      console.error('[LOBBY] Socket error:', err);
      if (err.code === 'INSUFFICIENT_FUNDS') {
        alert('Bakiye yetersiz! Maça giriş için 100 Coin gereklidir.');
      } else {
        alert(`Sunucu Hatası: ${err.message || err.code || JSON.stringify(err)}`);
      }
      setMatchStatus(null);
    };

    const onMatchmakingStatus = (data: any) => {
      console.log('[LOBBY] matchmaking_status:', data);
      if (data.status === 'searching') {
        setMatchStatus('Rakip aranıyor...');
      } else {
        setMatchStatus(null);
      }
    };

    const onMatchFound = (data: any) => {
      console.log('[LOBBY] match_found:', data);
      setMatchStatus('Rakip bulundu!');
      // Navigate immediately, no delay
      router.push(`/game/${data.roomId}`);
    };

    socket.on('wallet_updated', onWalletUpdated);
    socket.on('error', onError);
    socket.on('matchmaking_status', onMatchmakingStatus);
    socket.on('match_found', onMatchFound);

    return () => {
      socket.off('wallet_updated', onWalletUpdated);
      socket.off('error', onError);
      socket.off('matchmaking_status', onMatchmakingStatus);
      socket.off('match_found', onMatchFound);
    };
  }, [socket, router]);

  const handleLogout = () => {
    logout();
  };

  const handleQuickJoin = () => {
    console.log('[LOBBY] handleQuickJoin clicked. Socket:', socket ? 'exists' : 'null', 'connected:', socket?.connected, 'socketState:', socketState);
    if (socket && socket.connected) {
      console.log('[LOBBY] Emitting join_matchmaking');
      socket.emit('join_matchmaking', { gameModeId: 'quick_2' });
    } else {
      alert(`Socket bağlı değil! Durum: ${socketState}. Sayfayı yenileyin.`);
    }
  };

  if (!initialized || !isAuthenticated || !user) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      {/* HEADER */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-center">
        <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
          FOOTQUIZ
        </h1>
        <button 
          onClick={handleLogout}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Çıkış</span>
        </button>
      </div>

      {/* PROFILE CARD */}
      <div className="w-full max-w-sm bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 flex flex-col items-center shadow-2xl mb-8">
        <div className="w-24 h-24 bg-gradient-to-tr from-emerald-500 to-cyan-500 rounded-full mb-4 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)]">
          <span className="text-4xl font-bold text-white">{user.displayName.charAt(0).toUpperCase()}</span>
        </div>
        
        <h2 className="text-2xl font-bold text-white mb-6">{user.displayName}</h2>
        
        <div className="w-full flex justify-between gap-4">
          <div className="flex-1 bg-black/40 rounded-2xl p-4 flex flex-col items-center border border-white/5">
            <Coins className="text-amber-400 mb-2" size={24} />
            <span className="text-sm text-gray-400">Available</span>
            <span className="text-xl font-bold text-white">{user.balance} 🪙</span>
            {user.heldBalance > 0 && (
              <span className="text-xs text-orange-400 mt-1">Held: {user.heldBalance}</span>
            )}
          </div>
          <div className="flex-1 bg-black/40 rounded-2xl p-4 flex flex-col items-center border border-white/5">
            <Trophy className="text-emerald-400 mb-2" size={24} />
            <span className="text-sm text-gray-400">Rating</span>
            <span className="text-xl font-bold text-white">⭐ {user.rating}</span>
          </div>
        </div>
      </div>

      {/* ACTION AREA */}
      <div className="w-full max-w-sm flex flex-col gap-4">
        {matchStatus ? (
          <div className="w-full py-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/50 flex flex-col items-center justify-center animate-pulse">
            <Loader2 className="text-emerald-400 animate-spin mb-2" size={24} />
            <span className="text-emerald-400 font-bold">{matchStatus}</span>
          </div>
        ) : (
          <button
            onClick={handleQuickJoin}
            disabled={socketState !== 'CONNECTED'}
            className="w-full relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-2xl blur opacity-25 group-hover:opacity-75 transition duration-200"></div>
            <div className="relative w-full py-5 rounded-2xl bg-gray-900 border border-white/10 flex flex-col items-center justify-center gap-1 group-hover:border-emerald-500/50 transition-colors">
              <div className="flex items-center gap-2 text-white font-bold text-xl">
                <Zap className="text-emerald-400" />
                QUICK JOIN
              </div>
              <span className="text-sm text-gray-400 font-medium">Entry Fee: 100 🪙</span>
            </div>
          </button>
        )}

        <button
          onClick={() => router.push('/leaderboard')}
          className="w-full bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 group border border-white/10"
        >
          <Trophy className="text-yellow-500 group-hover:scale-110 transition-transform" size={20} />
          <span className="text-lg tracking-wide">Liderlik Tablosu</span>
        </button>
        
        {socketState === 'CONNECTING' && (
          <p className="text-center text-xs text-gray-500">Sunucuya bağlanılıyor...</p>
        )}
        {socketState === 'AUTH_ERROR' && (
          <p className="text-center text-xs text-red-400">Bağlantı reddedildi. Yeniden giriş yapın.</p>
        )}
        {socketState === 'DISCONNECTED' && (
          <p className="text-center text-xs text-yellow-400">Sunucu bağlantısı bekleniyor...</p>
        )}
      </div>
    </div>
  );
}
