'use client';

import ChatPanel from '@/components/chat/ChatPanel';
import DailyPulseBanner from '@/components/DailyPulseBanner';
import { useAuth } from '@/lib/auth-context';

export default function DashboardPage() {
  const { orgId, userId, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <DailyPulseBanner orgId={orgId || ''} />
      <div className="flex-1 min-h-0">
        <ChatPanel
          orgId={orgId || ''}
          userId={userId || ''}
          onStageChange={(stage) => {
            localStorage.setItem('fishgold_stage', String(stage));
          }}
        />
      </div>
    </div>
  );
}
