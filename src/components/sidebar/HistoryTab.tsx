'use client';

import { useEffect, useState } from 'react';
import type { AppStage } from '@/types';
import { createClient } from '@/lib/supabase/client';

interface HistoryTabProps {
  stage: AppStage;
  orgId: string | null;
}

interface ConversationItem {
  id: string;
  title: string | null;
  messages: { role: string; content: string }[];
  created_at: string;
  updated_at: string;
}

interface SubmissionItem {
  id: string;
  status: string;
  version: number;
  created_at: string;
  submitted_at: string | null;
  outcome: string | null;
  approved_amount: number | null;
  requested_amount: number | null;
  funder_feedback: string | null;
  lessons_learned: string | null;
  content: Record<string, unknown> | null;
  opportunity: { title: string; funder: string | null; contact_info: string | null } | null;
}

export default function HistoryTab({ stage, orgId }: HistoryTabProps) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'conversations' | 'submissions'>('conversations');
  const [editingSub, setEditingSub] = useState<SubmissionItem | null>(null);
  const [savingOutcome, setSavingOutcome] = useState(false);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    const supabase = createClient();

    Promise.all([
      supabase
        .from('conversations')
        .select('id, title, messages, created_at, updated_at')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(20),
      supabase
        .from('submissions')
        .select('id, status, version, created_at, submitted_at, outcome, approved_amount, requested_amount, funder_feedback, lessons_learned, content, opportunity:opportunities(title, funder, contact_info)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]).then(([convRes, subRes]) => {
      if (convRes.data) setConversations(convRes.data as ConversationItem[]);
      if (subRes.data) setSubmissions(subRes.data as unknown as SubmissionItem[]);
      setLoading(false);
    });
  }, [orgId]);

  const getPreview = (conv: ConversationItem) => {
    if (conv.title) return conv.title;
    const firstUser = conv.messages?.find(m => m.role === 'user');
    if (firstUser) return firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? '...' : '');
    return 'שיחה חדשה';
  };

  const buildMailto = (sub: SubmissionItem) => {
    const contact = sub.opportunity?.contact_info || '';
    const emailMatch = contact.match(/[\w.-]+@[\w.-]+\.\w+/);
    const to = emailMatch ? emailMatch[0] : '';
    const subject = encodeURIComponent(`הגשה: ${sub.opportunity?.title || 'בקשת מענק'}`);
    const bodyParts: string[] = [];
    if (sub.content) {
      const c = sub.content as Record<string, unknown>;
      if (typeof c.body === 'string') bodyParts.push(c.body);
      else if (typeof c.text === 'string') bodyParts.push(c.text);
      else bodyParts.push(JSON.stringify(c, null, 2));
    }
    const body = encodeURIComponent(bodyParts.join('\n\n') || 'טקסט ההגשה');
    return `mailto:${to}?subject=${subject}&body=${body}`;
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} דק׳`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} שע׳`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ימים`;
    return new Date(dateStr).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  };

  const statusLabels: Record<string, { text: string; color: string }> = {
    draft: { text: 'טיוטה', color: 'bg-gray-200 text-gray-700' },
    review: { text: 'בבדיקה', color: 'bg-amber-100 text-amber-700' },
    submitted: { text: 'הוגש', color: 'bg-blue-100 text-blue-700' },
    approved: { text: 'אושר', color: 'bg-green-100 text-green-700' },
    rejected: { text: 'נדחה', color: 'bg-red-100 text-red-700' },
  };

  const outcomeLabels: Record<string, { text: string; color: string }> = {
    approved: { text: 'אושר', color: 'bg-green-100 text-green-700' },
    rejected: { text: 'נדחה', color: 'bg-red-100 text-red-700' },
    partial: { text: 'אושר חלקית', color: 'bg-amber-100 text-amber-700' },
    pending: { text: 'ממתין לתשובה', color: 'bg-blue-100 text-blue-700' },
    no_response: { text: 'ללא מענה', color: 'bg-gray-200 text-gray-500' },
  };

  const saveOutcome = async (sub: SubmissionItem) => {
    if (!orgId) return;
    setSavingOutcome(true);
    const supabase = createClient();
    await supabase
      .from('submissions')
      .update({
        outcome: sub.outcome,
        approved_amount: sub.approved_amount,
        requested_amount: sub.requested_amount,
        funder_feedback: sub.funder_feedback,
        lessons_learned: sub.lessons_learned,
        outcome_at: new Date().toISOString(),
      })
      .eq('id', sub.id);

    setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, ...sub } : s));
    setSavingOutcome(false);
    setEditingSub(null);
  };

  const loadConversation = (convId: string) => {
    window.dispatchEvent(new CustomEvent('fishgold:loadConversation', { detail: { conversationId: convId } }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toggle */}
      <div className="flex gap-1 bg-surf2 rounded-lg p-0.5">
        <button
          onClick={() => setView('conversations')}
          className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
            view === 'conversations' ? 'bg-bg text-text shadow-sm' : 'text-muted hover:text-text'
          }`}
        >
          שיחות ({conversations.length})
        </button>
        <button
          onClick={() => setView('submissions')}
          className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
            view === 'submissions' ? 'bg-bg text-text shadow-sm' : 'text-muted hover:text-text'
          }`}
        >
          הגשות ({submissions.length})
        </button>
      </div>

      {/* Conversations list */}
      {view === 'conversations' && (
        <div className="space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center py-8">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-muted2 mb-2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              <p className="text-xs text-muted2">עדיין אין שיחות</p>
              <p className="text-[10px] text-muted2 mt-1">שלחו הודעה ל-Goldfish כדי להתחיל</p>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                className="w-full text-right flex items-start gap-2.5 py-2.5 px-3 rounded-lg hover:bg-surf2 transition-colors group"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2 mt-0.5 flex-shrink-0 group-hover:text-accent transition-colors">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">{getPreview(conv)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-muted2">{getTimeAgo(conv.updated_at)}</span>
                    <span className="text-[9px] text-muted2">{conv.messages?.length || 0} הודעות</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Submissions list */}
      {view === 'submissions' && (
        <div className="space-y-1">
          {submissions.length === 0 ? (
            <div className="text-center py-8">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-muted2 mb-2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p className="text-xs text-muted2">עדיין אין הגשות</p>
              <p className="text-[10px] text-muted2 mt-1">בקשו מ-Goldfish לכתוב הגשה</p>
            </div>
          ) : (
            submissions.map(sub => {
              const status = statusLabels[sub.status] || statusLabels.draft;
              const outcome = sub.outcome ? outcomeLabels[sub.outcome] : null;
              return (
                <div
                  key={sub.id}
                  className="flex items-start gap-2.5 py-2.5 px-3 rounded-lg hover:bg-surf2 transition-colors cursor-pointer"
                  onClick={() => setEditingSub({ ...sub })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2 mt-0.5 flex-shrink-0">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium truncate">
                      {sub.opportunity?.title || 'הגשה'}
                    </p>
                    {sub.opportunity?.funder && (
                      <p className="text-[9px] text-muted2 truncate">{sub.opportunity.funder}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${status.color}`}>
                        {status.text}
                      </span>
                      {outcome && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${outcome.color}`}>
                          {outcome.text}
                        </span>
                      )}
                      {!!sub.approved_amount && (
                        <span className="text-[9px] text-green-600 font-medium">
                          {Number(sub.approved_amount).toLocaleString('he-IL')} ש&quot;ח
                        </span>
                      )}
                      <span className="text-[9px] text-muted2">v{sub.version}</span>
                      <span className="text-[9px] text-muted2">{getTimeAgo(sub.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Outcome editing modal */}
      {!!editingSub && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditingSub(null)}>
          <div className="bg-bg rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold">
              {editingSub.opportunity?.title || 'הגשה'}
            </h3>
            {editingSub.opportunity?.funder && (
              <p className="text-xs text-muted2">{editingSub.opportunity.funder}</p>
            )}

            <div>
              <label className="text-[10px] font-medium text-muted2 block mb-1">תוצאה</label>
              <select
                value={editingSub.outcome || ''}
                onChange={e => setEditingSub({ ...editingSub, outcome: e.target.value || null })}
                className="w-full text-xs border border-surf2 rounded-lg px-2.5 py-1.5 bg-bg"
              >
                <option value="">לא ידוע</option>
                <option value="approved">אושר</option>
                <option value="partial">אושר חלקית</option>
                <option value="rejected">נדחה</option>
                <option value="pending">ממתין לתשובה</option>
                <option value="no_response">ללא מענה</option>
              </select>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-medium text-muted2 block mb-1">סכום שבוקש</label>
                <input
                  type="number"
                  value={editingSub.requested_amount || ''}
                  onChange={e => setEditingSub({ ...editingSub, requested_amount: e.target.value ? Number(e.target.value) : null })}
                  placeholder="ש&quot;ח"
                  className="w-full text-xs border border-surf2 rounded-lg px-2.5 py-1.5 bg-bg"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-medium text-muted2 block mb-1">סכום שאושר</label>
                <input
                  type="number"
                  value={editingSub.approved_amount || ''}
                  onChange={e => setEditingSub({ ...editingSub, approved_amount: e.target.value ? Number(e.target.value) : null })}
                  placeholder="ש&quot;ח"
                  className="w-full text-xs border border-surf2 rounded-lg px-2.5 py-1.5 bg-bg"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-medium text-muted2 block mb-1">משוב מהקרן</label>
              <textarea
                value={editingSub.funder_feedback || ''}
                onChange={e => setEditingSub({ ...editingSub, funder_feedback: e.target.value || null })}
                placeholder="מה הקרן אמרה? מה אהבו? מה חסר?"
                rows={2}
                className="w-full text-xs border border-surf2 rounded-lg px-2.5 py-1.5 bg-bg resize-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-medium text-muted2 block mb-1">לקחים להגשות הבאות</label>
              <textarea
                value={editingSub.lessons_learned || ''}
                onChange={e => setEditingSub({ ...editingSub, lessons_learned: e.target.value || null })}
                placeholder="מה ללמוד מהפעם הזו?"
                rows={2}
                className="w-full text-xs border border-surf2 rounded-lg px-2.5 py-1.5 bg-bg resize-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setEditingSub(null)}
                className="flex-1 text-xs py-1.5 rounded-lg border border-surf2 hover:bg-surf2 transition-colors"
              >
                ביטול
              </button>
              <button
                onClick={() => saveOutcome(editingSub)}
                disabled={savingOutcome}
                className="flex-1 text-xs py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {savingOutcome ? 'שומר...' : 'שמירה'}
              </button>
            </div>

            {editingSub.content && (
              <a
                href={buildMailto(editingSub)}
                className="flex items-center justify-center gap-1.5 w-full text-xs py-1.5 rounded-lg border border-surf2 hover:bg-surf2 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,12 2,6" />
                </svg>
                שלח במייל
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
