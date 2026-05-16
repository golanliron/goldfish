'use client';

import { useState, useEffect } from 'react';
import ChatPanel from '@/components/chat/ChatPanel';
import WhatUrgentNow from '@/components/WhatUrgentNow';
import { useAuth } from '@/lib/auth-context';

export default function DashboardPage() {
  const { orgId, userId, loading } = useAuth();
  const [showChat, setShowChat] = useState(false);

  // Focus chat if event fired (e.g. from WhatUrgentNow CTA)
  useEffect(() => {
    const handler = () => setShowChat(true);
    window.addEventListener('fishgold:focusChat', handler);
    return () => window.removeEventListener('fishgold:focusChat', handler);
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (showChat) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0 px-3 pt-2">
          <button
            onClick={() => setShowChat(false)}
            className="text-xs text-muted hover:text-accent transition-colors flex items-center gap-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
            חזרה למה דחוף עכשיו
          </button>
        </div>
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

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-shrink-0 px-3 pt-3 pb-1 flex justify-end">
        <button
          onClick={() => setShowChat(true)}
          className="text-xs text-muted hover:text-accent transition-colors flex items-center gap-1 border border-border px-2.5 py-1.5 rounded-lg hover:bg-surf2"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          שאלו את Goldfish
        </button>
      </div>
      <div className="flex-1">
        <WhatUrgentNow orgId={orgId || ''} />
      </div>
    </div>
  );
}
