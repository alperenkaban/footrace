'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { ArrowLeft, Coins, Trophy, Sparkles, Check, CreditCard, ShieldCheck, Play, Loader2 } from 'lucide-react';
import { AdBanner } from '@/components/AdBanner';
import { RewardAdModal } from '@/components/RewardAdModal';

interface ShopPackage {
  id: string;
  name: string;
  coins: number;
  bonusCoins: number;
  totalCoins: number;
  priceTl: number;
  badge?: string;
  popular?: boolean;
}

const PACKAGES: ShopPackage[] = [
  {
    id: 'starter_500',
    name: 'Başlangıç Paketi',
    coins: 500,
    bonusCoins: 0,
    totalCoins: 500,
    priceTl: 29.99,
    badge: 'POPÜLER',
  },
  {
    id: 'pro_1500',
    name: 'Pro Oyuncu Paketi',
    coins: 1500,
    bonusCoins: 150,
    totalCoins: 1650,
    priceTl: 69.99,
    popular: true,
    badge: 'EN ÇOK TERCİH EDİLEN',
  },
  {
    id: 'elite_4000',
    name: 'Yıldız Paketi',
    coins: 4000,
    bonusCoins: 600,
    totalCoins: 4600,
    priceTl: 149.99,
    badge: 'FIRSAT (+%15 BONUS)',
  },
  {
    id: 'legend_12000',
    name: 'Efsane Paketi',
    coins: 12000,
    bonusCoins: 2500,
    totalCoins: 14500,
    priceTl: 299.99,
    badge: 'DEV İNDİRİM (+%21 BONUS)',
  },
];

export default function ShopPage() {
  const router = useRouter();
  const { user, accessToken, updateWallet } = useAuthStore();
  const [selectedPackage, setSelectedPackage] = useState<ShopPackage | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);
  const [isAdModalOpen, setIsAdModalOpen] = useState(false);
  const [adSuccessMessage, setAdSuccessMessage] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://footrace-6lnc.onrender.com';

  const handleCheckout = async () => {
    if (!selectedPackage || !user) return;
    setPurchasing(true);

    try {
      const res = await fetch(`${API_URL}/shop/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          packageId: selectedPackage.id,
          userId: user.id,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        updateWallet(data.data.balance, data.data.heldBalance);
        setPurchaseSuccess(`${selectedPackage.totalCoins} Coin hesabınıza yüklendi!`);
        setTimeout(() => {
          setSelectedPackage(null);
          setPurchaseSuccess(null);
        }, 2000);
      } else {
        alert(data.message || 'Satın alma işlemi başarısız');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Ödeme sunucusuna bağlanılamadı.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleClaimAdReward = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_URL}/shop/claim-ad-reward`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        updateWallet(data.data.balance, data.data.heldBalance);
        setAdSuccessMessage('+50 Coin hesabınıza eklendi!');
        setTimeout(() => setAdSuccessMessage(null), 3000);
      } else {
        alert(data.message || 'Reklam ödülü alınamadı');
      }
    } catch (err) {
      console.error('Ad reward error:', err);
      alert('Ödül sunucusuna bağlanılamadı.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 font-[family-name:var(--font-geist-sans)] text-white flex flex-col items-center">
      {/* HEADER */}
      <div className="w-full max-w-md flex justify-between items-center py-4 mb-4">
        <button
          onClick={() => router.push('/lobby')}
          className="p-2.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-colors flex items-center gap-1.5 text-gray-300 hover:text-white"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-bold">Lobi</span>
        </button>

        <h1 className="text-xl font-black bg-gradient-to-r from-amber-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent">
          COIN MAĞAZASI
        </h1>

        <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-2xl border border-white/10">
          <Coins size={16} className="text-amber-400" />
          <span className="text-sm font-bold">{user?.balance ?? 0}</span>
        </div>
      </div>

      <div className="w-full max-w-md flex flex-col gap-4">
        {/* SUCCESS NOTIFICATION */}
        {adSuccessMessage && (
          <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-2xl text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 animate-bounce">
            <Coins size={16} className="text-amber-400" />
            <span>{adSuccessMessage}</span>
          </div>
        )}

        {/* FREE COIN CARD (REWARD AD) */}
        <div className="p-5 rounded-3xl bg-gradient-to-r from-emerald-950/60 to-cyan-950/60 border border-emerald-500/30 flex items-center justify-between shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">ÜCRETSİZ FIRSAT</span>
            <h3 className="text-base font-bold text-white mt-0.5">Reklam İzle, Coin Kazan!</h3>
            <p className="text-xs text-gray-400 mt-0.5">Kısa bir video izleyerek anında 50 Coin kazan.</p>
          </div>

          <button
            onClick={() => setIsAdModalOpen(true)}
            className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-bold text-xs shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 shrink-0 transition-all active:scale-95"
          >
            <Play size={14} className="fill-white" />
            <span>+50 Coin</span>
          </button>
        </div>

        {/* PACKAGES GRID */}
        <div className="grid grid-cols-1 gap-3">
          {PACKAGES.map((pkg) => {
            const isPopular = pkg.popular;
            return (
              <div
                key={pkg.id}
                className={`relative p-5 rounded-3xl border transition-all duration-200 flex items-center justify-between ${
                  isPopular
                    ? 'bg-gradient-to-r from-amber-950/40 via-gray-900 to-emerald-950/30 border-amber-500/40 shadow-xl shadow-amber-500/5'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
              >
                {/* Badge */}
                {pkg.badge && (
                  <div
                    className={`absolute -top-2.5 left-5 text-[9px] font-black tracking-wider uppercase px-2.5 py-0.5 rounded-full border shadow-sm ${
                      isPopular
                        ? 'bg-gradient-to-r from-amber-500 to-emerald-500 text-black border-amber-300'
                        : 'bg-white/10 text-gray-300 border-white/10'
                    }`}
                  >
                    {pkg.badge}
                  </div>
                )}

                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center">
                    <Coins size={26} className={isPopular ? 'text-amber-400' : 'text-amber-500/80'} />
                  </div>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xl font-black text-white">{pkg.totalCoins.toLocaleString('tr-TR')}</span>
                      <span className="text-xs font-bold text-amber-400">Coin</span>
                    </div>
                    {pkg.bonusCoins > 0 ? (
                      <span className="text-[11px] text-emerald-400 font-semibold">
                        {pkg.coins.toLocaleString('tr-TR')} + {pkg.bonusCoins} Bonus!
                      </span>
                    ) : (
                      <span className="text-[11px] text-gray-400 font-medium">{pkg.name}</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedPackage(pkg)}
                  className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold text-sm border border-white/20 transition-all flex items-center gap-1"
                >
                  <span>{pkg.priceTl.toFixed(2)} ₺</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* SECURITY NOTE */}
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-gray-500">
          <ShieldCheck size={16} className="text-emerald-500" />
          <span>256-Bit SSL Güvenli Simülasyon Ödemesi</span>
        </div>

        {/* AD BANNER */}
        <AdBanner placement="shop" className="mt-2" />
      </div>

      {/* REWARD AD MODAL */}
      <RewardAdModal
        isOpen={isAdModalOpen}
        onClose={() => setIsAdModalOpen(false)}
        onReward={handleClaimAdReward}
        rewardAmount={50}
        title="Coin Ödüllü Sponsor Reklamı"
      />

      {/* CHECKOUT MODAL */}
      {selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-sm bg-gray-900 border border-white/10 rounded-3xl p-6 flex flex-col shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Satın Alımı Onayla</h3>
            <p className="text-xs text-gray-400 mb-4">Güvenli ödeme simülasyonu ile coin hesabınıza anında aktarılacak.</p>

            {/* Order Summary */}
            <div className="p-4 rounded-2xl bg-black/40 border border-white/10 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Coins size={28} className="text-amber-400" />
                <div className="flex flex-col">
                  <span className="text-base font-bold text-white">{selectedPackage.totalCoins} Coin</span>
                  <span className="text-xs text-gray-400">{selectedPackage.name}</span>
                </div>
              </div>
              <span className="text-lg font-black text-emerald-400">{selectedPackage.priceTl.toFixed(2)} ₺</span>
            </div>

            {/* Payment Method Badge */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-300 mb-6">
              <CreditCard size={16} className="text-cyan-400" />
              <span>Simüle Edilmiş Test Ödeme Yöntemi</span>
            </div>

            {purchaseSuccess ? (
              <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-sm text-center flex items-center justify-center gap-2 animate-pulse">
                <Check size={18} />
                <span>{purchaseSuccess}</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedPackage(null)}
                  disabled={purchasing}
                  className="flex-1 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-gray-400 font-bold text-xs transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  onClick={handleCheckout}
                  disabled={purchasing}
                  className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-bold text-xs shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  {purchasing ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      <span>İşleniyor...</span>
                    </>
                  ) : (
                    <span>Ödemeyi Onayla</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
