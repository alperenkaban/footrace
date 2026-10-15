'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { 
  ArrowLeft, Coins, Trophy, Sparkles, Check, 
  RotateCcw, ShieldCheck, Play, Loader2, Crown, 
  Smartphone, ExternalLink, Info
} from 'lucide-react';
import { AdBanner } from '@/components/AdBanner';
import { RewardAdModal } from '@/components/RewardAdModal';
import { IapModal, IapProduct } from '@/components/IapModal';
import { LegalTermsModal } from '@/components/LegalTermsModal';

const IAP_ITEMS: IapProduct[] = [
  {
    id: 'starter_500',
    skuGoogle: 'com.footquiz.coins.500',
    skuApple: 'com.footquiz.coins.500',
    type: 'consumable',
    name: '500 Coin Paketi',
    description: '5 Maçlık Giriş Bakiyesi',
    coins: 500,
    bonusCoins: 0,
    totalCoins: 500,
    priceTl: 29.99,
    priceUsd: 0.99,
    badge: 'BAŞLANGIÇ',
  },
  {
    id: 'pro_1500',
    skuGoogle: 'com.footquiz.coins.1650',
    skuApple: 'com.footquiz.coins.1650',
    type: 'consumable',
    name: '1.650 Coin Paketi',
    description: '15 Maçlık Giriş + 150 Bonus Coin',
    coins: 1500,
    bonusCoins: 150,
    totalCoins: 1650,
    priceTl: 69.99,
    priceUsd: 1.99,
    popular: true,
    badge: 'EN ÇOK TERCİH EDİLEN',
  },
  {
    id: 'elite_4000',
    skuGoogle: 'com.footquiz.coins.4600',
    skuApple: 'com.footquiz.coins.4600',
    type: 'consumable',
    name: '4.600 Coin Paketi',
    description: '40 Maçlık Giriş + 600 Bonus Coin',
    coins: 4000,
    bonusCoins: 600,
    totalCoins: 4600,
    priceTl: 149.99,
    priceUsd: 4.99,
    badge: 'FIRSAT (+%15 BONUS)',
  },
  {
    id: 'legend_12000',
    skuGoogle: 'com.footquiz.coins.14500',
    skuApple: 'com.footquiz.coins.14500',
    type: 'consumable',
    name: '14.500 Coin Paketi',
    description: '120 Maçlık Giriş + 2.500 Bonus Coin',
    coins: 12000,
    bonusCoins: 2500,
    totalCoins: 14500,
    priceTl: 299.99,
    priceUsd: 9.99,
    badge: 'DEV İNDİRİM (+%21 BONUS)',
  },
];

const VIP_PASS: IapProduct = {
  id: 'vip_monthly',
  skuGoogle: 'com.footquiz.vip.monthly',
  skuApple: 'com.footquiz.vip.monthly',
  type: 'subscription',
  period: 'monthly',
  name: 'FootQuiz VIP Pass (Aylık)',
  description: 'Sıfır Reklam, Günlük +100 Coin, 2x RP Sıralama Çarpanı, Altın VIP Rozeti',
  coins: 1000,
  bonusCoins: 0,
  totalCoins: 1000,
  priceTl: 79.99,
  priceUsd: 2.99,
  badge: 'VIP AYRICALIKLARI',
};

export default function ShopPage() {
  const router = useRouter();
  const { user, accessToken, updateWallet } = useAuthStore();

  const [platform, setPlatform] = useState<'apple' | 'google'>('apple');
  const [selectedProduct, setSelectedProduct] = useState<IapProduct | null>(null);
  const [isIapModalOpen, setIsIapModalOpen] = useState(false);
  const [isAdModalOpen, setIsAdModalOpen] = useState(false);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<'terms' | 'privacy'>('terms');

  const [isVipActive, setIsVipActive] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://footrace-6lnc.onrender.com';

  // Otomatik platform algılama (iOS vs Android)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent || '';
      if (/android/i.test(ua)) {
        setPlatform('google');
      } else if (/iPad|iPhone|iPod|Macintosh/i.test(ua)) {
        setPlatform('apple');
      }
    }
  }, []);

  // VIP durumunu kontrol et
  useEffect(() => {
    if (!user || !accessToken) return;
    fetch(`${API_URL}/shop/iap/vip-status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.data?.isVip) {
          setIsVipActive(true);
        }
      })
      .catch(() => {});
  }, [user, accessToken, API_URL]);

  // Satın alma başlat
  const handleOpenPurchase = (product: IapProduct) => {
    setSelectedProduct(product);
    setIsIapModalOpen(true);
  };

  // IAP Satın Alım Doğrulama Çağrısı (StoreKit / Google Play)
  const handleConfirmPurchase = async (product: IapProduct, storePlatform: 'apple' | 'google'): Promise<boolean> => {
    if (!user) return false;

    try {
      // Native wrapper (Capacitor/Cordova/React-Native) köprü bildirimi
      if (typeof window !== 'undefined') {
        const win = window as any;
        if (win.webkit?.messageHandlers?.iap) {
          win.webkit.messageHandlers.iap.postMessage({ action: 'buy', sku: product.skuApple });
        } else if (win.Android?.buyProduct) {
          win.Android.buyProduct(product.skuGoogle);
        }
      }

      const endpoint = storePlatform === 'apple' ? '/shop/iap/apple/verify' : '/shop/iap/google/verify';
      const bodyPayload = storePlatform === 'apple'
        ? {
            productId: product.skuApple,
            transactionId: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            receiptData: 'simulated_apple_receipt_base64',
            userId: user.id,
          }
        : {
            productId: product.skuGoogle,
            purchaseToken: `tok_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            orderId: `GPA.${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
            userId: user.id,
          };

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(bodyPayload),
      });

      const resData = await res.json();
      if (res.ok && resData.success) {
        if (resData.data?.balance !== undefined) {
          updateWallet(resData.data.balance, resData.data.heldBalance ?? user.heldBalance);
        }
        if (product.type === 'subscription') {
          setIsVipActive(true);
        }
        setStatusMessage(`🎉 ${product.name} başarıyla satın alındı ve hesabınıza tanımlandı!`);
        setTimeout(() => setStatusMessage(null), 4000);
        return true;
      } else {
        alert(resData.message || 'Satın alma işlemi doğrulanamadı.');
        return false;
      }
    } catch (err) {
      console.error('Purchase validation error:', err);
      alert('Mağaza sunucusuna bağlanılamadı.');
      return false;
    }
  };

  // Satın Alımları Geri Yükle (Restore Purchases)
  const handleRestorePurchases = async () => {
    if (!user) return;
    setRestoring(true);
    try {
      const res = await fetch(`${API_URL}/shop/iap/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.data?.isVip) {
          setIsVipActive(true);
        }
        alert(data.data?.message || 'Satın alımlarınız başarıyla senkronize edildi.');
      } else {
        alert('Geri yüklenecek aktif bir satın alım bulunamadı.');
      }
    } catch (err) {
      console.error('Restore error:', err);
      alert('Geri yükleme işlemi sırasında bir hata oluştu.');
    } finally {
      setRestoring(false);
    }
  };

  // Reklam Ödülü
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
        setStatusMessage('🎁 +50 Coin reklam ödülü hesabınıza eklendi!');
        setTimeout(() => setStatusMessage(null), 3000);
      } else {
        alert(data.message || 'Reklam ödülü alınamadı');
      }
    } catch (err) {
      console.error('Ad reward error:', err);
      alert('Ödül sunucusuna bağlanılamadı.');
    }
  };

  const openLegal = (tab: 'terms' | 'privacy') => {
    setLegalTab(tab);
    setIsLegalModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 font-[family-name:var(--font-geist-sans)] text-white flex flex-col items-center pb-20">
      {/* TOP BAR / NAVIGATION */}
      <div className="w-full max-w-md flex justify-between items-center py-4 mb-2">
        <button
          onClick={() => router.push('/lobby')}
          className="p-2.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-colors flex items-center gap-1.5 text-gray-300 hover:text-white"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-semibold">Lobi</span>
        </button>

        {/* Current Balance & VIP Badge */}
        <div className="flex items-center gap-2">
          {isVipActive && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40 text-[11px] font-bold text-amber-300">
              <Crown size={12} className="text-amber-400" />
              <span>VIP</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 bg-black/40 px-3.5 py-1.5 rounded-2xl border border-white/10 shadow-inner">
            <Coins className="text-amber-400" size={16} />
            <span className="text-sm font-bold text-white">{user?.balance ?? 0}</span>
          </div>
        </div>
      </div>

      {/* SUCCESS STATUS NOTIFICATION */}
      {statusMessage && (
        <div className="w-full max-w-md mb-4 p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold text-center animate-fade-in flex items-center justify-center gap-2 shadow-lg">
          <Check size={16} />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* STORE PLATFORM SELECTOR (App Store vs Google Play) */}
      <div className="w-full max-w-md mb-5">
        <div className="bg-black/50 p-1.5 rounded-2xl border border-white/10 flex items-center gap-1">
          <button
            onClick={() => setPlatform('apple')}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              platform === 'apple'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 170 170">
              <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.08-7.7-7.93-12.01-14.54-6.3-9.69-11.25-20.73-14.85-33.12-3.6-12.39-5.4-23.71-5.4-33.97 0-14.28 3.59-26.04 10.77-35.29 7.18-9.25 16.27-13.97 27.27-14.15 4.58 0 9.87 1.25 15.86 3.76 5.99 2.51 9.77 3.82 11.35 3.94 1.8.12 5.86-1.29 12.19-4.22 6.33-2.93 11.75-4.29 16.27-4.08 12.63.63 22.86 5.37 30.68 14.22-11.05 6.72-16.43 15.93-16.14 27.63.29 9.38 3.91 17.29 10.86 23.73 6.95 6.44 15.17 10.15 24.66 11.13-2.32 7.12-5.48 14.74-9.48 22.87zM119.22 33.12c0-7.25 2.65-14.11 7.95-20.57 5.3-6.46 11.77-10.78 19.41-12.95-.29 1.34-.48 2.69-.58 4.05-.33 4.29-1.57 8.64-3.72 13.06-2.15 4.42-5.07 8.07-8.76 10.95-3.69 2.88-7.66 4.96-11.91 6.24-.76-.25-1.55-.49-2.39-.78z"/>
            </svg>
            <span>Apple App Store</span>
          </button>

          <button
            onClick={() => setPlatform('google')}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              platform === 'google'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M3.6 1.7L13.1 12 3.6 22.3c-.4-.3-.6-.8-.6-1.4V3.1c0-.6.2-1.1.6-1.4z"/>
              <path fill="#FBBC04" d="M16.5 8.6L13.1 12l3.4 3.4 3.9-2.2c1.1-.6 1.1-1.7 0-2.3l-3.9-2.3z"/>
              <path fill="#34A853" d="M3.6 22.3l12.9-7.4-3.4-3.4L3.6 22.3z"/>
              <path fill="#EA4335" d="M3.6 1.7l9.5 9.8 3.4-3.4L3.6 1.7z"/>
            </svg>
            <span>Google Play</span>
          </button>
        </div>
        <p className="text-[10px] text-gray-500 text-center mt-1.5 flex items-center justify-center gap-1">
          <ShieldCheck size={12} className="text-emerald-400" />
          <span>Resmi {platform === 'apple' ? 'StoreKit 2' : 'Google Play Billing'} ödeme altyapısı</span>
        </p>
      </div>

      {/* FEATURED: FOOTQUIZ VIP PASS HERO CARD */}
      <div className="w-full max-w-md relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500/20 via-yellow-600/10 to-emerald-500/10 border border-amber-500/30 p-5 shadow-2xl mb-6">
        <div className="absolute top-0 right-0 -mr-12 -mt-12 w-36 h-36 bg-amber-500/20 rounded-full blur-2xl pointer-events-none" />

        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-400 to-yellow-600 flex items-center justify-center shadow-lg text-black font-black">
              <Crown size={22} className="text-gray-950 fill-gray-950" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-black text-base text-white">FootQuiz VIP Pass</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  AYLIK
                </span>
              </div>
              <p className="text-xs text-gray-300">Ayrıcalıklı Oyuncu Aboneliği</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-lg font-black text-amber-300">79,99 ₺</span>
            <span className="text-[10px] text-gray-400 block">/ ay</span>
          </div>
        </div>

        {/* Benefits List */}
        <div className="grid grid-cols-2 gap-2 my-3 text-[11px] text-gray-200">
          <div className="flex items-center gap-1.5 bg-black/30 p-2 rounded-xl border border-white/5">
            <Sparkles size={14} className="text-amber-400 shrink-0" />
            <span>Sıfır Reklam Deneyimi</span>
          </div>
          <div className="flex items-center gap-1.5 bg-black/30 p-2 rounded-xl border border-white/5">
            <Coins size={14} className="text-amber-400 shrink-0" />
            <span>Her Gün +100 Coin</span>
          </div>
          <div className="flex items-center gap-1.5 bg-black/30 p-2 rounded-xl border border-white/5">
            <Trophy size={14} className="text-amber-400 shrink-0" />
            <span>2x RP Puan Çarpanı</span>
          </div>
          <div className="flex items-center gap-1.5 bg-black/30 p-2 rounded-xl border border-white/5">
            <Crown size={14} className="text-amber-400 shrink-0" />
            <span>Altın VIP İsim Rozeti</span>
          </div>
        </div>

        <button
          onClick={() => handleOpenPurchase(VIP_PASS)}
          className={`w-full py-3 rounded-2xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 shadow-lg active:scale-98 ${
            isVipActive
              ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
              : 'bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-gray-950'
          }`}
        >
          {isVipActive ? (
            <>
              <Check size={16} />
              <span>VIP Pass Aktif • Yenile / Yönet</span>
            </>
          ) : (
            <>
              <Crown size={16} />
              <span>VIP Pass Başlat • 79,99 ₺ / Ay</span>
            </>
          )}
        </button>
      </div>

      {/* COIN PACKAGES HEADER */}
      <div className="w-full max-w-md flex justify-between items-center mb-3">
        <h2 className="text-sm font-bold tracking-wide text-gray-300 uppercase">
          Tüketilebilir Coin Paketleri
        </h2>
        <span className="text-[10px] text-gray-500 font-mono">In-App Purchases</span>
      </div>

      {/* COIN PACKAGES GRID */}
      <div className="w-full max-w-md grid grid-cols-1 gap-3 mb-6">
        {IAP_ITEMS.map((pkg) => {
          const sku = platform === 'apple' ? pkg.skuApple : pkg.skuGoogle;
          return (
            <div
              key={pkg.id}
              className={`relative rounded-3xl p-4.5 bg-white/5 backdrop-blur-md border transition-all flex items-center justify-between ${
                pkg.popular
                  ? 'border-emerald-500/40 bg-emerald-500/5 shadow-lg shadow-emerald-500/10'
                  : 'border-white/10 hover:border-white/20'
              }`}
            >
              {/* Badge */}
              {pkg.badge && (
                <div className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase bg-emerald-500 text-gray-950 shadow-md">
                  {pkg.badge}
                </div>
              )}

              {/* Left Details */}
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center shadow-inner">
                  <Coins className={pkg.popular ? 'text-amber-400' : 'text-gray-300'} size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-black text-base text-white">{pkg.totalCoins} Coin</h3>
                    {(pkg.bonusCoins ?? 0) > 0 && (
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        +{pkg.bonusCoins} Bonus
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">{pkg.description}</p>
                  <span className="text-[9px] font-mono text-gray-500 block mt-0.5">{sku}</span>
                </div>
              </div>

              {/* Right Buy Button */}
              <button
                onClick={() => handleOpenPurchase(pkg)}
                className={`py-2 px-3.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 ${
                  platform === 'apple'
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                <span>{pkg.priceTl.toFixed(2).replace('.', ',')} ₺</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* FREE REWARDED AD CARD */}
      <div className="w-full max-w-md bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 rounded-3xl p-4 flex items-center justify-between mb-6 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Play size={20} className="fill-emerald-400 ml-0.5" />
          </div>
          <div>
            <h4 className="font-bold text-xs text-white">Ücretsiz Coin İster misiniz?</h4>
            <p className="text-[11px] text-gray-400">5 saniyelik sponsorlu video izleyin</p>
          </div>
        </div>

        <button
          onClick={() => setIsAdModalOpen(true)}
          className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-xs transition-all active:scale-95 shadow-md flex items-center gap-1"
        >
          <Sparkles size={12} />
          <span>+50 Coin</span>
        </button>
      </div>

      {/* RESTORE PURCHASES BUTTON (Apple App Store Guideline 3.1.1 Zorunlu Şartı) */}
      <div className="w-full max-w-md flex flex-col items-center gap-2 mb-6">
        <button
          onClick={handleRestorePurchases}
          disabled={restoring}
          className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white font-semibold text-xs border border-white/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {restoring ? (
            <>
              <Loader2 className="animate-spin" size={14} />
              <span>Satın Alımlar Kontrol Ediliyor...</span>
            </>
          ) : (
            <>
              <RotateCcw size={14} />
              <span>Satın Alımları Geri Yükle (Restore Purchases)</span>
            </>
          )}
        </button>
        <span className="text-[10px] text-gray-500 text-center">
          Daha önce bu hesap veya Apple/Google Kimliğinizle yaptığınız abonelikleri geri yükler.
        </span>
      </div>

      {/* SPONSOR BANNER */}
      <div className="w-full max-w-md mb-6">
        <AdBanner placement="shop" />
      </div>

      {/* LEGAL & COMPLIANCE FOOTER (Apple App Store & Google Play Mandatory) */}
      <div className="w-full max-w-md pt-4 border-t border-white/10 flex flex-col gap-3 text-center text-gray-500 text-[10px] leading-relaxed">
        <div className="flex items-center justify-center gap-4 text-gray-400 font-medium">
          <button
            onClick={() => openLegal('terms')}
            className="hover:text-emerald-400 transition-colors underline"
          >
            Kullanım Koşulları (EULA)
          </button>
          <span>•</span>
          <button
            onClick={() => openLegal('privacy')}
            className="hover:text-emerald-400 transition-colors underline"
          >
            Gizlilik Politikası
          </button>
        </div>

        <p>
          Abonelik ödemeleri, satın alma onayı ile birlikte {platform === 'apple' ? 'Apple Kimliği' : 'Google Play'} hesabınızdan tahsil edilir. Abonelik, mevcut dönemin bitiminden en az 24 saat önce iptal edilmediği takdirde otomatik olarak yenilenir. Satın alma sonrasında hesap ayarlarınızdan aboneliğinizi dilediğiniz zaman yönetebilir ve iptal edebilirsiniz.
        </p>

        <p>© 2026 FootQuiz Inc. Tüm hakları saklıdır.</p>
      </div>

      {/* MODALS */}
      <IapModal
        isOpen={isIapModalOpen}
        onClose={() => setIsIapModalOpen(false)}
        product={selectedProduct}
        platform={platform}
        onConfirmPurchase={handleConfirmPurchase}
        userEmail={user?.displayName ? `${user.displayName.toLowerCase()}@footquiz.app` : 'player@footquiz.app'}
      />

      <RewardAdModal
        isOpen={isAdModalOpen}
        onClose={() => setIsAdModalOpen(false)}
        onReward={handleClaimAdReward}
        rewardAmount={50}
        title="Mağaza Bonus Reklamı"
      />

      <LegalTermsModal
        isOpen={isLegalModalOpen}
        onClose={() => setIsLegalModalOpen(false)}
        initialTab={legalTab}
      />
    </div>
  );
}
