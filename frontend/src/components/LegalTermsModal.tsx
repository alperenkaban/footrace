'use client';

import React, { useState } from 'react';
import { X, Shield, FileText } from 'lucide-react';

interface LegalTermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'terms' | 'privacy';
}

export function LegalTermsModal({ isOpen, onClose, initialTab = 'terms' }: LegalTermsModalProps) {
  const [activeTab, setActiveTab] = useState<'terms' | 'privacy'>(initialTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-lg bg-gray-900 border border-white/10 rounded-3xl p-6 flex flex-col shadow-2xl max-h-[85vh] text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Shield className="text-emerald-400" size={20} />
            <h3 className="font-bold text-lg">Yasal Bilgilendirme ve Koşullar</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex gap-2 my-4 bg-black/40 p-1.5 rounded-xl border border-white/5">
          <button
            onClick={() => setActiveTab('terms')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'terms' ? 'bg-white/10 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            <FileText size={14} />
            <span>Kullanım Koşulları (EULA)</span>
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'privacy' ? 'bg-white/10 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Shield size={14} />
            <span>Gizlilik Politikası</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto pr-2 space-y-4 text-xs text-gray-300 leading-relaxed max-h-[50vh]">
          {activeTab === 'terms' ? (
            <>
              <section>
                <h4 className="font-bold text-white text-sm mb-1">1. Uygulama İçi Satın Alımlar ve Abonelikler</h4>
                <p>
                  FootQuiz içerisinde sunulan tüketilebilir dijital ürünler (Coin Paketleri) ve yenilenebilir abonelikler (VIP Pass), Apple App Store ve Google Play Store altyapısı üzerinden faturalandırılır.
                </p>
              </section>

              <section>
                <h4 className="font-bold text-white text-sm mb-1">2. Otomatik Yenileme ve İptal Şartları</h4>
                <p>
                  FootQuiz VIP Pass aylık bir aboneliktir. Ödeme, satın alma onayınızla birlikte Apple Kimliğiniz veya Google Play Hesabınızdan tahsil edilir. Geçerli fatura döneminin bitiminden en az 24 saat önce iptal edilmediği sürece aboneliğiniz otomatik olarak yenilenir.
                </p>
                <p className="mt-1">
                  Aboneliğinizi dilediğiniz zaman cihazınızın ayarlarından (iOS: Ayarlar &gt; Apple Kimliği &gt; Abonelikler; Android: Google Play Store &gt; Profil &gt; Ödemeler ve Abonelikler) yönetebilir ve iptal edebilirsiniz.
                </p>
              </section>

              <section>
                <h4 className="font-bold text-white text-sm mb-1">3. İadeler</h4>
                <p>
                  Tüketilen dijital jetonlar (coinler) için iadeler ilgili platformun (Apple App Store veya Google Play Store) standart mağaza iade koşullarına tabidir.
                </p>
              </section>
            </>
          ) : (
            <>
              <section>
                <h4 className="font-bold text-white text-sm mb-1">1. Veri Gizliliği ve Toplanan Bilgiler</h4>
                <p>
                  FootQuiz olarak kullanıcılarımızın gizliliğine saygı duyuyoruz. Oyun deneyimini iyileştirmek, skor tablolarını senkronize etmek ve hile koruması sağlamak amacıyla sadece kullanıcı kimliği, skor ve bakiye verileri işlenir.
                </p>
              </section>

              <section>
                <h4 className="font-bold text-white text-sm mb-1">2. Ödeme Bilgileri Güvenliği</h4>
                <p>
                  FootQuiz sunucularında hiçbir kredi kartı, banka bilgisi veya Apple/Google şifresi saklanmaz. Tüm ödeme işlemleri Apple StoreKit ve Google Play Billing uçtan uca şifreli altyapısı ile doğrudan işlenir.
                </p>
              </section>

              <section>
                <h4 className="font-bold text-white text-sm mb-1">3. İletişim</h4>
                <p>
                  Gizlilik politikamız ile ilgili her türlü soru için support@footquiz.app adresinden ekibimize ulaşabilirsiniz.
                </p>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
