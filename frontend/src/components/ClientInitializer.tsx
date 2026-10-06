'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { usePathname, useRouter } from 'next/navigation';

export default function ClientInitializer({ children }: { children: React.ReactNode }) {
  const { initializeAuth, initialized, isAuthenticated } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (!initialized) return;

    // Protected Routes Check
    const protectedRoutes = ['/lobby', '/game', '/profile', '/leaderboard'];
    const isProtected = protectedRoutes.some(route => pathname.startsWith(route));

    if (isProtected && !isAuthenticated) {
      router.replace('/login');
    } else if (pathname === '/' && isAuthenticated) {
      router.replace('/lobby');
    } else if (pathname === '/' && !isAuthenticated) {
      router.replace('/login');
    }
  }, [initialized, isAuthenticated, pathname, router]);

  // Flash of wrong screen engellemesi
  if (!initialized) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">Yükleniyor...</div>;
  }

  return <>{children}</>;
}
