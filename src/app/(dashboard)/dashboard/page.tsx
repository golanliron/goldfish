'use client';

import ChatPanel from '@/components/chat/ChatPanel';
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
      <ChatPanel
        orgId={orgId || ''}
        userId={userId || ''}
        onStageChange={(stage) => {
          localStorage.setItem('fishgold_stage', String(stage));
        }}
      />
    </div>
  );
}
