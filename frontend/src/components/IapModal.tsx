'use client';

import React, { useState } from 'react';
import { X, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react';

export interface IapProduct {
  id: string;
  skuGoogle: string;
  skuApple: string;
  type: 'consumable' | 'subscription';
  name: string;
  description: string;
  coins?: number;
  bonusCoins?: number;
  totalCoins?: number;
  priceTl: number;
  priceUsd: number;
  period?: 'monthly' | 'yearly';
  badge?: string;
  popular?: boolean;
}

interface IapModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: IapProduct | null;
  platform: 'apple' | 'google';
  onConfirmPurchase: (product: IapProduct, platform: 'apple' | 'google') => Promise<boolean>;
  userEmail?: string;
}

export function IapModal({
  isOpen,
  onClose,
  product,
  platform,
  onConfirmPurchase,
  userEmail = 'player@footquiz.app',
}: IapModalProps) {
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState<'prompt' | 'success'>('prompt');

  if (!isOpen || !product) return null;

  const sku = platform === 'apple' ? product.skuApple : product.skuGoogle;
  const priceDisplay = `${product.priceTl.toFixed(2).replace('.', ',')} ₺`;

  const handleBuy = async () => {
    setProcessing(true);
    try {
      const ok = await onConfirmPurchase(product, platform);
      if (ok) {
        setStep('success');
        setTimeout(() => {
          setStep('prompt');
          onClose();
        }, 1800);
      }
    } catch (err) {
      console.error('IAP purchase error:', err);
    } finally {
      setProcessing(false);
    }
  };

  const handleCancel = () => {
    if (!processing) {
      setStep('prompt');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      {/* APPLE APP STORE (STOREKIT) MODAL */}
      {platform === 'apple' ? (
        <div className="w-full max-w-sm bg-[#1c1c1e] text-white rounded-t-3xl sm:rounded-3xl border border-white/10 p-6 flex flex-col shadow-2xl relative animate-slide-up">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg font-black text-lg text-white">
                FQ
              </div>
              <div>
                <h4 className="font-bold text-base leading-snug">FootQuiz</h4>
                <p className="text-xs text-gray-400">Canlı Futbol Bilgi Yarışması</p>
                <span className="text-[10px] text-cyan-400 font-medium">Uygulama İçi Satın Alma (StoreKit)</span>
              </div>
            </div>
            <button
              onClick={handleCancel}
              disabled={processing}
              className="p-1 rounded-full bg-white/10 hover:bg-white/20 text-gray-300 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="h-px bg-white/10 w-full my-2" />

          {step === 'prompt' ? (
            <>
              {/* Product Info */}
              <div className="bg-[#2c2c2e] rounded-2xl p-4 my-2 border border-white/5 flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-white">{product.name}</span>
                  <span className="text-base font-bold text-emerald-400">{priceDisplay}</span>
                </div>
                <p className="text-xs text-gray-300">{product.description}</p>
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                  <span>Ürün Kimliği:</span>
                  <span className="font-mono text-gray-300">{sku}</span>
                </div>
                {product.type === 'subscription' && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md self-start border border-amber-500/20 mt-1">
                    Aylık Otomatik Yenilenen Abonelik
                  </span>
                )}
              </div>

              {/* Apple ID Info */}
              <div className="text-xs text-gray-400 px-1 py-1 flex items-center justify-between">
                <span>Apple Kimliği:</span>
                <span className="text-gray-200 font-medium truncate max-w-[190px]">{userEmail}</span>
              </div>

              {/* Legal Notice */}
              <p className="text-[10px] text-gray-500 mt-2 text-center leading-relaxed">
                Satın alımı onayladığınızda ödeme Apple Kimliğiniz üzerinden tahsil edilecektir.
              </p>

              {/* Action Button: Apple Pay / Face ID simulation */}
              <button
                onClick={handleBuy}
                disabled={processing}
                className="w-full mt-4 py-3.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
              >
                {processing ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    <span>StoreKit Doğrulanıyor...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 170 170">
                      <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.08-7.7-7.93-12.01-14.54-6.3-9.69-11.25-20.73-14.85-33.12-3.6-12.39-5.4-23.71-5.4-33.97 0-14.28 3.59-26.04 10.77-35.29 7.18-9.25 16.27-13.97 27.27-14.15 4.58 0 9.87 1.25 15.86 3.76 5.99 2.51 9.77 3.82 11.35 3.94 1.8.12 5.86-1.29 12.19-4.22 6.33-2.93 11.75-4.29 16.27-4.08 12.63.63 22.86 5.37 30.68 14.22-11.05 6.72-16.43 15.93-16.14 27.63.29 9.38 3.91 17.29 10.86 23.73 6.95 6.44 15.17 10.15 24.66 11.13-2.32 7.12-5.48 14.74-9.48 22.87zM119.22 33.12c0-7.25 2.65-14.11 7.95-20.57 5.3-6.46 11.77-10.78 19.41-12.95-.29 1.34-.48 2.69-.58 4.05-.33 4.29-1.57 8.64-3.72 13.06-2.15 4.42-5.07 8.07-8.76 10.95-3.69 2.88-7.66 4.96-11.91 6.24-.76-.25-1.55-.49-2.39-.78z"/>
                    </svg>
                    <span>Apple ile Onayla • {priceDisplay}</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="py-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 animate-bounce">
                <CheckCircle2 size={36} />
              </div>
              <h4 className="text-lg font-bold text-white">Satın Alım Başarılı!</h4>
              <p className="text-xs text-gray-400">
                {product.name} hesabınıza tanımlandı. İyi oyunlar!
              </p>
            </div>
          )}
        </div>
      ) : (
        /* GOOGLE PLAY BILLING MODAL */
        <div className="w-full max-w-sm bg-[#1f2125] text-white rounded-t-3xl sm:rounded-3xl border border-white/10 p-6 flex flex-col shadow-2xl relative animate-slide-up">
          {/* Header */}
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M3.6 1.7L13.1 12 3.6 22.3c-.4-.3-.6-.8-.6-1.4V3.1c0-.6.2-1.1.6-1.4z"/>
                <path fill="#FBBC04" d="M16.5 8.6L13.1 12l3.4 3.4 3.9-2.2c1.1-.6 1.1-1.7 0-2.3l-3.9-2.3z"/>
                <path fill="#34A853" d="M3.6 22.3l12.9-7.4-3.4-3.4L3.6 22.3z"/>
                <path fill="#EA4335" d="M3.6 1.7l9.5 9.8 3.4-3.4L3.6 1.7z"/>
              </svg>
              <span className="font-bold text-sm tracking-wide text-gray-200">Google Play</span>
            </div>
            <button
              onClick={handleCancel}
              disabled={processing}
              className="p-1 rounded-full bg-white/10 hover:bg-white/20 text-gray-400 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="h-px bg-white/10 w-full mb-3" />

          {step === 'prompt' ? (
            <>
              {/* App & Product Header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center font-bold text-white shadow-md">
                  FQ
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-sm text-white">FootQuiz: Canlı Futbol</h4>
                  <p className="text-xs text-gray-400">Google Play Billing Servisi</p>
                </div>
              </div>

              {/* Item Card */}
              <div className="bg-[#2a2d32] rounded-2xl p-4 mb-3 border border-white/5 flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-white">{product.name}</span>
                  <span className="text-base font-black text-emerald-400">{priceDisplay}</span>
                </div>
                <p className="text-xs text-gray-300">{product.description}</p>
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                  <span>Paket SKU:</span>
                  <span className="font-mono text-gray-300">{sku}</span>
                </div>
              </div>

              {/* Payment Method Selector Simulation */}
              <div className="bg-[#181a1d] rounded-xl p-3 mb-3 flex items-center justify-between border border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                    GPay
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-white">Google Play Bakiyesi / Kart</span>
                    <span className="text-[10px] text-gray-400">{userEmail}</span>
                  </div>
                </div>
                <ShieldCheck size={16} className="text-emerald-400" />
              </div>

              <p className="text-[10px] text-gray-500 text-center leading-relaxed mb-3">
                "1 Dokunuşla Satın Al"a dokunarak Google Play Hizmet Şartları'nı kabul etmiş olursunuz.
              </p>

              {/* Action Button: Google Play 1-Tap Buy */}
              <button
                onClick={handleBuy}
                disabled={processing}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
              >
                {processing ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    <span>Google Play İşleniyor...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} />
                    <span>1 Dokunuşla Satın Al • {priceDisplay}</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="py-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 animate-bounce">
                <CheckCircle2 size={36} />
              </div>
              <h4 className="text-lg font-bold text-white">Google Play Ödemesi Onaylandı!</h4>
              <p className="text-xs text-gray-400">
                {product.name} hesabınıza başarıyla yüklendi.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
