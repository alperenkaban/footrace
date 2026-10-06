'use client';

import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { useEffect } from 'next/useState';
import { useState } from 'react';

export default function LoginPage() {
  const { guestLogin, isAuthenticated, initialized } = useAuthStore();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialized && isAuthenticated) {
      router.replace('/lobby');
    }
  }, [initialized, isAuthenticated, router]);

  const handleGuestLogin = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await guestLogin();
      // Zustand state change will trigger the useEffect redirect
    } catch (e) {
      setError('Bağlantı kurulamadı. Tekrar deneyin.');
      setIsSubmitting(false);
    }
  };

  if (!initialized) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">Yükleniyor...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 flex flex-col items-center shadow-2xl">
        <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 mb-2">
          FOOTQUIZ
        </h1>
        <p className="text-gray-400 text-center mb-8">
          Futbol bilginizi gerçek oyunculara karşı test edin.
        </p>

        <button
          onClick={handleGuestLogin}
          disabled={isSubmitting}
          className={`w-full py-4 rounded-xl font-bold text-lg text-white mb-4 transition-all ${
            isSubmitting
              ? 'bg-emerald-500/50 cursor-not-allowed'
              : 'bg-emerald-500 hover:bg-emerald-400 hover:scale-[1.02] active:scale-[0.98]'
          }`}
        >
          {isSubmitting ? 'Profil oluşturuluyor...' : '⚡ MİSAFİR OLARAK OYNA'}
        </button>

        <p className="text-xs text-gray-500 mb-8">
          Ücretsiz başla • Hesap gerektirmez
        </p>

        {error && (
          <div className="w-full p-3 mb-6 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm text-center">
            {error}
          </div>
        )}

        <div className="w-full border-t border-white/10 pt-6 flex flex-col gap-3">
          <button 
            onClick={() => window.location.href = 'http://localhost:4000/auth/google'}
            className="w-full py-3 rounded-xl font-semibold text-gray-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center justify-center gap-2"
          >
            <span>G</span> GOOGLE İLE GİRİŞ YAP
          </button>
          
          <button 
            onClick={() => window.location.href = 'http://localhost:4000/auth/facebook'}
            className="w-full py-3 rounded-xl font-semibold text-gray-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center justify-center gap-2"
          >
            <span>F</span> FACEBOOK İLE GİRİŞ YAP
          </button>
        </div>
      </div>
    </div>
  );
}
