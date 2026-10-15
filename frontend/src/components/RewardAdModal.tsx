'use client';

import React, { useState, useEffect } from 'react';
import { X, Play, Coins, Sparkles, CheckCircle2 } from 'lucide-react';

interface RewardAdModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReward: () => Promise<void> | void;
  rewardAmount?: number;
  title?: string;
}

export function RewardAdModal({
  isOpen,
  onClose,
  onReward,
  rewardAmount = 50,
  title = 'Sponsorlu Reklam',
}: RewardAdModalProps) {
  const [countdown, setCountdown] = useState(5);
  const [completed, setCompleted] = useState(false);
  const [loadingReward, setLoadingReward] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(5);
      setCompleted(false);
      setLoadingReward(false);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setCompleted(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen]);

  const handleClaim = async () => {
    setLoadingReward(true);
    try {
      await onReward();
      onClose();
    } catch (err) {
      console.error('Reward claim error:', err);
    } finally {
      setLoadingReward(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-sm bg-gray-900 border border-white/10 rounded-3xl p-6 flex flex-col items-center shadow-2xl overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header */}
        <div className="w-full flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 text-xs font-semibold text-gray-300 border border-white/5">
            <Sparkles size={12} className="text-amber-400" />
            <span>{title}</span>
          </div>

          {completed && (
            <button
              onClick={onClose}
              className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Simulated Video Area */}
        <div className="w-full h-44 rounded-2xl bg-gradient-to-tr from-gray-950 to-gray-800 border border-white/10 flex flex-col items-center justify-center relative overflow-hidden mb-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent animate-pulse" />
          
          <div className="relative z-10 flex flex-col items-center text-center p-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-3 animate-bounce">
              <Play size={24} className="text-white fill-white ml-1" />
            </div>
            <p className="text-sm font-bold text-white">FootQuiz Sponsor Video</p>
            <p className="text-xs text-gray-400 mt-1">Ödülünüz hazırlanıyor...</p>
          </div>

          {/* Progress / Countdown overlay */}
          <div className="absolute bottom-3 right-3 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-mono font-bold text-white flex items-center gap-1.5">
            {!completed ? (
              <span>Kalan Süre: {countdown}s</span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 size={13} /> Tamamlandı
              </span>
            )}
          </div>
        </div>

        {/* Reward Action */}
        <div className="w-full flex flex-col items-center">
          <div className="flex items-center gap-2 mb-4">
            <Coins size={24} className="text-amber-400 animate-spin" />
            <span className="text-2xl font-black text-white">+{rewardAmount} Coin</span>
          </div>

          {completed ? (
            <button
              onClick={handleClaim}
              disabled={loadingReward}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              {loadingReward ? 'Yükleniyor...' : 'Ödülü Hesaba Al'}
            </button>
          ) : (
            <div className="w-full py-3.5 rounded-2xl bg-white/5 border border-white/10 text-gray-400 font-semibold text-xs text-center">
              Ödülü almak için {countdown} saniye bekleyin
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
