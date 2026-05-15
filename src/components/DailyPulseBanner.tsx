'use client';

import { useEffect, useState } from 'react';

interface PulseItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  source: string;
  scan_date: string;
}

interface Props {
  orgId: string;
}

const DISMISS_KEY = 'goldfish_pulse_dismissed';

export default function DailyPulseBanner({ orgId }: Props) {
  const [items, setItems] = useState<PulseItem[]>([]);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!orgId) return;

    // Check if already dismissed today
    const dismissed = localStorage.getItem(DISMISS_KEY);
    const today = new Date().toISOString().split('T')[0];
    if (dismissed === today) return;

    fetch('/api/daily-pulse', { headers: { 'x-org-id': orgId } })
      .then(r => r.json())
      .then(data => {
        if (data.items && data.items.length > 0) {
          setItems(data.items);
          setVisible(true);
        }
      })
      .catch(() => {});
  }, [orgId]);

  const dismiss = () => {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(DISMISS_KEY, today);
    setVisible(false);
    setExpanded(false);
  };

  if (!visible) return null;

  const first = items[0];

  return (
    <div className="relative z-50" dir="rtl">
      {/* Banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-3 text-sm">
        <span className="text-amber-600 text-base shrink-0">🔔</span>
        <span className="font-medium text-amber-800 shrink-0">עדכון יומי</span>
        <span className="text-amber-700 truncate flex-1">{first.title}</span>
        {items.length > 1 && (
          <span className="text-amber-500 shrink-0">+{items.length - 1} נוספים</span>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-amber-600 hover:text-amber-800 shrink-0 underline text-xs"
        >
          {expanded ? 'סגור' : 'קרא עוד'}
        </button>
        <button
          onClick={dismiss}
          className="text-amber-400 hover:text-amber-700 shrink-0 text-lg leading-none"
          aria-label="סגור"
        >
          ✕
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="bg-white border-b border-amber-100 px-4 py-3 space-y-3 shadow-sm">
          {items.map(item => (
            <div key={item.id} className="border border-gray-100 rounded-lg p-3">
              <div className="font-medium text-gray-800 text-sm mb-1">{item.title}</div>
              <div className="text-gray-600 text-xs leading-relaxed">{item.summary}</div>
              <div className="text-gray-400 text-xs mt-1">{item.source}</div>
            </div>
          ))}
          <button
            onClick={dismiss}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            אל תציג שוב היום
          </button>
        </div>
      )}
    </div>
  );
}
