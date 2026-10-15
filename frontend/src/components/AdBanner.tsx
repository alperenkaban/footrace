'use client';

import React, { useState } from 'react';
import { ExternalLink, Sparkles, X } from 'lucide-react';
import Link from 'next/link';

interface AdBannerProps {
  placement?: 'lobby' | 'game' | 'leaderboard' | 'shop';
  className?: string;
}

const ADS = [
  {
    title: 'EA SPORTS FC 26',
    tagline: 'Futbolun Kalbi Burada Atıyor. Hemen Ön Sipariş Ver!',
    cta: 'Keşfet',
    gradient: 'from-blue-600/30 via-indigo-600/20 to-purple-600/30',
    borderColor: 'border-blue-500/30',
    iconColor: 'text-cyan-400',
    link: 'https://www.ea.com',
  },
  {
    title: 'NIKE PHANTOM GX',
    tagline: 'Sahada Kusursuz Kontrol. Yeni Sezon Kramponlarını İncele.',
    cta: 'İncele',
    gradient: 'from-amber-600/30 via-orange-600/20 to-red-600/30',
    borderColor: 'border-amber-500/30',
    iconColor: 'text-amber-400',
    link: 'https://www.nike.com',
  },
  {
    title: 'FOOTQUIZ VIP PASS',
    tagline: 'Sıfır Reklam, 2x RP ve Özel Profil Çerçeveleri!',
    cta: 'Mağazaya Git',
    gradient: 'from-emerald-600/30 via-teal-600/20 to-cyan-600/30',
    borderColor: 'border-emerald-500/30',
    iconColor: 'text-emerald-400',
    internalLink: '/shop',
  },
];

export function AdBanner({ placement = 'lobby', className = '' }: AdBannerProps) {
  const [closed, setClosed] = useState(false);
  const [adIndex] = useState(() => Math.floor(Math.random() * ADS.length));
  const ad = ADS[adIndex];

  if (closed) return null;

  return (
    <div
      className={`w-full max-w-sm relative overflow-hidden rounded-2xl bg-gradient-to-r ${ad.gradient} backdrop-blur-md border ${ad.borderColor} p-3.5 shadow-lg transition-all ${className}`}
    >
      {/* Top Meta Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-gray-300 border border-white/10">
            Sponsorlu
          </span>
          <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
            <Sparkles size={10} className={ad.iconColor} />
            Reklam
          </span>
        </div>
        <button
          onClick={() => setClosed(true)}
          className="text-gray-400 hover:text-white p-0.5 rounded-full hover:bg-white/10 transition-colors"
          title="Reklamı Gizle"
        >
          <X size={12} />
        </button>
      </div>

      {/* Ad Content */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-bold text-white truncate">{ad.title}</h4>
          <p className="text-[11px] text-gray-300 line-clamp-1 opacity-90">{ad.tagline}</p>
        </div>

        {ad.internalLink ? (
          <Link
            href={ad.internalLink}
            className="shrink-0 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 flex items-center gap-1 transition-all hover:scale-105 active:scale-95"
          >
            <span>{ad.cta}</span>
          </Link>
        ) : (
          <a
            href={ad.link}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 flex items-center gap-1 transition-all hover:scale-105 active:scale-95"
          >
            <span>{ad.cta}</span>
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}
