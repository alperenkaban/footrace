'use client';

import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/providers/SocketProvider';
import { Coins, Trophy, LogOut, Loader2, Zap, ShoppingBag, Bot, Plus } from 'lucide-react';
import { AdBanner } from '@/components/AdBanner';

export default function LobbyPage() {
  const { user, isAuthenticated, initialized, logout } = useAuthStore();
  const router = useRouter();
  const { socket, socketState } = useSocket();
  
  const [selectedMode, setSelectedMode] = useState<'quick_2' | 'classic_10'>('classic_10');
  const [matchStatus, setMatchStatus] = useState<string | null>(null);
  const [searchSeconds, setSearchSeconds] = useState<number>(0);
  // BUG FIX: prevent double-click sending duplicate matchmaking requests
  const isJoiningRef = useRef(false);

  useEffect(() => {
    if (initialized && !isAuthenticated) {
      router.replace('/login');
      return;
    }
  }, [initialized, isAuthenticated, router]);

  // Matchmaking elapsed timer (max 15s countdown)
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (matchStatus) {
      setSearchSeconds(0);
      interval = setInterval(() => {
        setSearchSeconds((s) => s + 1);
      }, 1000);
    } else {
      setSearchSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [matchStatus]);

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
      // BUG FIX: reset joining lock on error
      isJoiningRef.current = false;
      setMatchStatus(null);
      if (err.code === 'INSUFFICIENT_FUNDS') {
        alert('Bakiye yetersiz! Maça giriş için 100 Coin gereklidir. Mağazadan bakiye yükleyebilirsiniz.');
      } else {
        alert(`Eşleştirme Bildirimi: ${err.message || err.code || 'Bir hata oluştu'}`);
      }
    };

    const onMatchmakingStatus = (data: any) => {
      console.log('[LOBBY] matchmaking_status:', data);
      if (data.status === 'searching') {
        setMatchStatus('Rakip aranıyor...');
      } else {
        // BUG FIX: reset joining lock when cancelled
        isJoiningRef.current = false;
        setMatchStatus(null);
      }
    };

    const onMatchFound = (data: any) => {
      console.log('[LOBBY] match_found:', data);
      setMatchStatus('Rakip bulundu! Odaya giriliyor...');
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

  const handleJoin = (modeId: 'quick_2' | 'classic_10') => {
    console.log('[LOBBY] handleJoin clicked:', modeId);
    if (isJoiningRef.current) {
      console.log('[LOBBY] Already joining, ignoring click');
      return;
    }
    if (socket && socket.connected) {
      isJoiningRef.current = true;
      setMatchStatus('Odaya bağlanılıyor...');
      socket.emit('join_matchmaking', { gameModeId: modeId });
    } else {
      alert(`Sunucuya bağlanılıyor (Durum: ${socketState}). Lütfen 1-2 saniye bekleyin.`);
    }
  };

  const handleForceBotMatch = () => {
    if (socket && socket.connected) {
      console.log('[LOBBY] Triggering quick bot match for:', selectedMode);
      setMatchStatus('Botlarla maç başlatılıyor...');
      socket.emit('request_bot_match', { gameModeId: selectedMode });
    }
  };

  const handleCancelMatchmaking = () => {
    if (socket && socket.connected) {
      socket.emit('leave_matchmaking', { gameModeId: selectedMode });
      isJoiningRef.current = false;
      setMatchStatus(null);
    }
  };

  if (!initialized || !isAuthenticated || !user) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>;
  }

  const searchProgress = Math.min(100, Math.round((searchSeconds / 15) * 100));

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 py-16">
      {/* HEADER */}
      <div className="absolute top-0 left-0 w-full p-4 sm:p-6 flex justify-between items-center">
        <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
          FOOTQUIZ
        </h1>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => router.push('/shop')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold transition-all active:scale-95 shadow-sm"
          >
            <ShoppingBag size={14} />
            <span>Mağaza</span>
          </button>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-gray-400 hover:text-white transition-colors text-xs font-medium"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Çıkış</span>
          </button>
        </div>
      </div>

      {/* PROFILE CARD */}
      <div className="w-full max-w-sm bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-7 flex flex-col items-center shadow-2xl mb-4">
        <div className="w-20 h-20 bg-gradient-to-tr from-emerald-500 to-cyan-500 rounded-full mb-3 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)]">
          <span className="text-3xl font-bold text-white">{user.displayName.charAt(0).toUpperCase()}</span>
        </div>
        
        <h2 className="text-xl font-bold text-white mb-5">{user.displayName}</h2>
        
        <div className="w-full flex justify-between gap-3">
          {/* Wallet / Coin Tile */}
          <div 
            onClick={() => router.push('/shop')}
            className="flex-1 bg-black/40 hover:bg-black/60 rounded-2xl p-3.5 flex flex-col items-center border border-white/5 hover:border-amber-500/30 transition-all cursor-pointer group"
            title="Coin Satın Al veya Ücretsiz Kazan"
          >
            <Coins className="text-amber-400 mb-1 group-hover:scale-110 transition-transform" size={20} />
            <span className="text-xs text-gray-400">Bakiye</span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-lg font-bold text-white">{user.balance}</span>
              <Coins size={14} className="text-amber-400" />
            </div>
            <div className="mt-1 flex items-center gap-0.5 text-[10px] text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded">
              <Plus size={10} />
              <span>Yükle</span>
            </div>
            {user.heldBalance > 0 && (
              <span className="text-[10px] text-orange-400 mt-1">Rezerve: {user.heldBalance}</span>
            )}
          </div>

          {/* Rating Tile */}
          <div 
            onClick={() => router.push('/leaderboard')}
            className="flex-1 bg-black/40 hover:bg-black/60 rounded-2xl p-3.5 flex flex-col items-center border border-white/5 hover:border-emerald-500/30 transition-all cursor-pointer group"
            title="Liderlik Sıralamasını Gör"
          >
            <Trophy className="text-emerald-400 mb-1 group-hover:scale-110 transition-transform" size={20} />
            <span className="text-xs text-gray-400">Puan (RP)</span>
            <span className="text-lg font-bold text-white mt-0.5">{user.rating}</span>
            <span className="mt-1 text-[10px] text-emerald-400 font-medium group-hover:underline">Sıralama Gör</span>
          </div>
        </div>
      </div>

      {/* GAME MODE SELECTION TABS */}
      <div className="w-full max-w-sm mb-4">
        <div className="grid grid-cols-2 gap-2 p-1.5 bg-black/40 rounded-2xl border border-white/10">
          <button
            onClick={() => setSelectedMode('classic_10')}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-1 ${
              selectedMode === 'classic_10'
                ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-1">
              <Trophy size={14} />
              <span>10 Kişilik Turnuva</span>
            </div>
            <span className="text-[10px] opacity-80 font-normal">10 Soru • 900 Ödül</span>
          </button>

          <button
            onClick={() => setSelectedMode('quick_2')}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-1 ${
              selectedMode === 'quick_2'
                ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-1">
              <Zap size={14} />
              <span>2 Kişilik Hızlı</span>
            </div>
            <span className="text-[10px] opacity-80 font-normal">3 Soru • 180 Ödül</span>
          </button>
        </div>
      </div>

      {/* ACTION AREA */}
      <div className="w-full max-w-sm flex flex-col gap-3">
        {matchStatus ? (
          <div className="w-full p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col items-center justify-center gap-3">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <Loader2 className="animate-spin" size={20} />
              <span>{matchStatus}</span>
            </div>

            {/* Live 15s Countdown Bar */}
            <div className="w-full flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-xs text-gray-400">
                <span>Arama Süresi</span>
                <span className="font-mono font-bold text-emerald-300">
                  0:{searchSeconds.toString().padStart(2, '0')} / 0:15
                </span>
              </div>
              <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-1000 ease-linear rounded-full"
                  style={{ width: `${searchProgress}%` }}
                />
              </div>
            </div>

            <p className="text-[11px] text-gray-400 text-center leading-tight">
              {searchSeconds >= 12
                ? '🤖 Oyuncu aranıyor... 15s dolunca botlarla otomatik başlatılıyor!'
                : selectedMode === 'classic_10'
                  ? 'Turnuva için diğer yarışmacılar toplanıyor (Maks. 15 sn)'
                  : 'Rakip aranıyor (Maks. 15 sn)'}
            </p>

            <div className="w-full flex items-center gap-2 mt-1">
              <button
                onClick={handleForceBotMatch}
                className="flex-1 py-2 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-bold border border-cyan-500/30 transition-all flex items-center justify-center gap-1.5"
              >
                <Bot size={14} />
                <span>Hemen Başlat</span>
              </button>
              <button
                onClick={handleCancelMatchmaking}
                className="py-2 px-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold border border-red-500/30 transition-colors"
              >
                İptal Et
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => handleJoin(selectedMode)}
            disabled={socketState !== 'CONNECTED'}
            className={`w-full relative group transition-all duration-200 ${
              socketState !== 'CONNECTED' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'
            }`}
          >
            <div className={`absolute -inset-1 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-2xl blur opacity-25 ${socketState === 'CONNECTED' ? 'group-hover:opacity-75' : ''} transition duration-200`}></div>
            <div className="relative w-full py-4.5 rounded-2xl bg-gray-900 border border-white/10 flex flex-col items-center justify-center gap-1 group-hover:border-emerald-500/50 transition-colors">
              <div className="flex items-center gap-2 text-white font-bold text-lg">
                {socketState === 'CONNECTING' ? (
                  <>
                    <Loader2 className="animate-spin text-emerald-400" size={20} />
                    <span>SUNUCUYA BAĞLANILIYOR...</span>
                  </>
                ) : (
                  <>
                    {selectedMode === 'classic_10' ? <Trophy className="text-emerald-400" size={20} /> : <Zap className="text-emerald-400" size={20} />}
                    <span>{selectedMode === 'classic_10' ? '10 KİŞİLİK MAÇA KATIL' : '2 KİŞİLİK MAÇA KATIL'}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
                <span>Giriş: 100</span>
                <Coins size={12} className="text-amber-400" />
                <span className="mx-1">•</span>
                <span>Ödül: {selectedMode === 'classic_10' ? '900' : '180'}</span>
                <Coins size={12} className="text-amber-400" />
              </div>
            </div>
          </button>
        )}

        {/* BOTTOM NAV BUTTONS */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => router.push('/shop')}
            className="w-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold py-3.5 px-3 rounded-2xl transition-all flex items-center justify-center gap-2 group border border-amber-500/20 active:scale-95"
          >
            <ShoppingBag className="text-amber-400 group-hover:scale-110 transition-transform" size={18} />
            <span className="text-sm">Coin Mağazası</span>
          </button>

          <button
            onClick={() => router.push('/leaderboard')}
            className="w-full bg-white/5 hover:bg-white/10 text-white font-bold py-3.5 px-3 rounded-2xl transition-all flex items-center justify-center gap-2 group border border-white/10 active:scale-95"
          >
            <Trophy className="text-yellow-500 group-hover:scale-110 transition-transform" size={18} />
            <span className="text-sm">Liderlik Tablosu</span>
          </button>
        </div>
        
        {socketState === 'CONNECTING' && (
          <p className="text-center text-xs text-gray-500">Sunucuya bağlanılıyor...</p>
        )}
        {socketState === 'AUTH_ERROR' && (
          <p className="text-center text-xs text-red-400">Bağlantı reddedildi. Yeniden giriş yapın.</p>
        )}
        {socketState === 'DISCONNECTED' && (
          <p className="text-center text-xs text-yellow-400">Sunucu bağlantısı bekleniyor...</p>
        )}

        {/* SPONSOR / AD BANNER */}
        <AdBanner placement="lobby" className="mt-2" />
      </div>
    </div>
  );
}

