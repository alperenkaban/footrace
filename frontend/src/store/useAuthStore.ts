import { create } from 'zustand';

export interface User {
  id: string;
  displayName: string;
  isGuest: boolean;
  balance: number;
  heldBalance: number;
  rating: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  initialized: boolean;
  
  guestLogin: (displayName?: string) => Promise<void>;
  logout: () => void;
  initializeAuth: () => void;
  setUser: (user: User, token: string) => void;
  updateWallet: (balance: number, heldBalance: number) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: false,
  initialized: false,

  guestLogin: async (displayName?: string) => {
    set({ isLoading: true });
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${API_URL}/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) throw new Error('Guest login failed');
      const data = await res.json();
      
      // Kaydet ve Auth yap
      localStorage.setItem('footquiz_token', data.access_token);
      localStorage.setItem('footquiz_user', JSON.stringify(data.user));
      
      set({ 
        user: data.user, 
        accessToken: data.access_token, 
        isAuthenticated: true, 
        isLoading: false,
        initialized: true
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('footquiz_token');
    localStorage.removeItem('footquiz_user');
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  initializeAuth: () => {
    const token = localStorage.getItem('footquiz_token');
    const userStr = localStorage.getItem('footquiz_user');
    
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        set({ user, accessToken: token, isAuthenticated: true, initialized: true });
      } catch (e) {
        localStorage.removeItem('footquiz_token');
        localStorage.removeItem('footquiz_user');
        set({ initialized: true });
      }
    } else {
      set({ initialized: true });
    }
  },

  setUser: (user, token) => {
    localStorage.setItem('footquiz_token', token);
    localStorage.setItem('footquiz_user', JSON.stringify(user));
    set({ user, accessToken: token, isAuthenticated: true });
  },

  updateWallet: (balance, heldBalance) => {
    const { user } = get();
    if (!user) return;
    
    const updatedUser = { ...user, balance, heldBalance };
    localStorage.setItem('footquiz_user', JSON.stringify(updatedUser));
    set({ user: updatedUser });
  },
}));
