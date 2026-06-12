'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { TickerBar } from '@/components/TickerBar';
import { Header } from '@/components/Header';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setUser, logout } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
      return;
    }
    authApi.me()
      .then(({ data }) => {
        const u = (data as { data: { id: string; email: string; role: string } }).data;
        setUser(u);
      })
      .catch(() => logout());
  }, [router, setUser, logout]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 pt-9">
      <TickerBar />
      <Sidebar />
      <main className="flex-1 ml-[200px] overflow-y-auto">
        <Header />
        <div className="max-w-7xl mx-auto px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
