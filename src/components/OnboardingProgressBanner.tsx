'use client';

import { useState, useEffect, useRef } from 'react';
import type { ScanProgress, ScanStatus } from '@/app/api/onboarding/scan/route';

interface Props {
  orgId: string;
  onComplete?: (completeness: number) => void;
}

const STATUS_LABELS: Record<ScanStatus, string> = {
  pending: 'ממתין...',
  scanning_drive: 'סורק Google Drive...',
  identifying_files: 'מזהה מסמכים...',
  building_profile: 'בונה פרופיל ארגון...',
  done: 'הפרופיל מוכן',
  error: 'שגיאה בסריקה',
};

const STATUS_ICONS: Record<ScanStatus, string> = {
  pending: '⏳',
  scanning_drive: '🔍',
  identifying_files: '📂',
  building_profile: '🧬',
  done: '✅',
  error: '⚠️',
};

export default function OnboardingProgressBanner({ orgId, onComplete }: Props) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [scanStarted, setScanStarted] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check if this org has a Drive folder and needs an initial scan
  useEffect(() => {
    if (!orgId) return;

    const dismissKey = `goldfish_scan_dismissed_${orgId}`;
    if (sessionStorage.getItem(dismissKey)) return;

    checkAndStartScan();
  }, [orgId]);

  const checkAndStartScan = async () => {
    try {
      const res = await fetch(`/api/onboarding/scan?org_id=${orgId}`);
      if (!res.ok) return;
      const data = await res.json();
      const p = data.progress as ScanProgress;

      // Show banner if scan is active or was recently done (completeness > 0)
      if (p.status === 'done' && p.files_processed === 0) return; // nothing to show
      if (p.status === 'error') { setProgress(p); setVisible(true); return; }

      if (['scanning_drive', 'identifying_files', 'building_profile'].includes(p.status)) {
        // Scan in progress — show and poll
        setProgress(p);
        setVisible(true);
        startPolling();
      } else if (p.status === 'done' && p.files_processed > 0 && data.profile_completeness < 80) {
        // Scan done but profile still weak — show completeness nudge
        setProgress(p);
        setVisible(true);
        if (onComplete) onComplete(data.profile_completeness);
      } else if (p.status === 'pending' || (p.status === 'done' && p.files_found === 0)) {
        // Try to trigger initial scan (only if Drive is connected)
        await triggerScan();
      }
    } catch {
      // Silently ignore — banner is non-critical
    }
  };

  const triggerScan = async () => {
    if (scanStarted) return;
    setScanStarted(true);

    try {
      setProgress({ status: 'scanning_drive', message: 'מאתחל סריקה...', files_found: 0, files_processed: 0, profile_completeness: 0 });
      setVisible(true);

      // Fire-and-forget — the scan runs server-side and we poll for updates
      fetch('/api/onboarding/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ org_id: orgId }),
      }).catch(() => {});

      startPolling();
    } catch {
      // ignore
    }
  };

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/onboarding/scan?org_id=${orgId}`);
        if (!res.ok) return;
        const data = await res.json();
        const p = data.progress as ScanProgress;
        setProgress(p);

        if (p.status === 'done' || p.status === 'error') {
          stopPolling();
          if (p.status === 'done' && onComplete) onComplete(data.profile_completeness);
          // Auto-dismiss after 8s on success
          if (p.status === 'done') {
            setTimeout(() => dismiss(), 8000);
          }
        }
      } catch { /* ignore */ }
    }, 2500);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const dismiss = () => {
    stopPolling();
    setDismissed(true);
    sessionStorage.setItem(`goldfish_scan_dismissed_${orgId}`, '1');
    setTimeout(() => setVisible(false), 400);
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  if (!visible || !progress) return null;

  const isActive = ['scanning_drive', 'identifying_files', 'building_profile'].includes(progress.status);
  const isDone = progress.status === 'done';
  const isError = progress.status === 'error';

  const barWidth = isDone
    ? 100
    : progress.files_found > 0
    ? Math.round((progress.files_processed / progress.files_found) * 100)
    : isActive ? 20 : 0;

  return (
    <div
      className={`transition-all duration-400 overflow-hidden ${
        dismissed ? 'max-h-0 opacity-0' : 'max-h-24 opacity-100'
      }`}
      dir="rtl"
    >
      <div className={`mx-3 my-2 rounded-xl border px-4 py-2.5 flex items-center gap-3 text-sm ${
        isDone
          ? 'bg-green-50 border-green-200'
          : isError
          ? 'bg-orange-50 border-orange-200'
          : 'bg-accent/5 border-accent/20'
      }`}>
        {/* Icon / spinner */}
        <span className="flex-shrink-0 text-base">
          {isActive ? (
            <span className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            STATUS_ICONS[progress.status]
          )}
        </span>

        {/* Text + progress bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className={`text-[12px] font-medium ${isDone ? 'text-green-700' : isError ? 'text-orange-700' : 'text-accent'}`}>
              {STATUS_LABELS[progress.status]}
            </span>
            {progress.files_found > 0 && (
              <span className="text-[10px] text-muted flex-shrink-0">
                {progress.files_processed}/{progress.files_found} קבצים
              </span>
            )}
          </div>
          {isActive && (
            <div className="w-full h-1 bg-accent/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-700"
                style={{ width: `${Math.max(barWidth, 8)}%` }}
              />
            </div>
          )}
          {isDone && progress.profile_completeness > 0 && (
            <div className="text-[10px] text-green-600 mt-0.5">
              פרופיל ארגוני: {progress.profile_completeness}% מלא
              {progress.profile_completeness < 70 && ' — הוסיפו עוד מסמכים לדיוק גבוה יותר'}
            </div>
          )}
          {isError && (
            <div className="text-[10px] text-orange-600 mt-0.5">{progress.message}</div>
          )}
        </div>

        {/* Dismiss */}
        {(isDone || isError) && (
          <button
            onClick={dismiss}
            className="flex-shrink-0 text-muted hover:text-text transition-colors p-0.5"
            title="סגור"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
