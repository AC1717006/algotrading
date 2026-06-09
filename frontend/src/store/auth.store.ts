import { create } from 'zustand';
import { saveTokens, clearTokens } from '../lib/auth';

interface User {
  id: string;
  email: string;
  role: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User) => void;
  login: (accessToken: string, refreshToken: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  login: (accessToken, refreshToken, user) => {
    saveTokens(accessToken, refreshToken);
    set({ user, isLoading: false });
  },
  logout: () => {
    clearTokens();
    set({ user: null });
    window.location.href = '/login';
  },
}));
