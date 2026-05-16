'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import FishLogo from './FishLogo';
import type { ChatMessage } from '@/types';
import { FISHGOLD_WELCOME, getRandomLoadingPhrase } from '@/lib/ai/fishgold';

function linkifyText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /(https?:\/\/[^\s<>"')\]]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-accent underline break-all hover:opacity-80">$1</a>'
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 left-2 p-1.5 rounded-lg bg-bg/80 hover:bg-surf2 border border-border text-muted hover:text-accent"
      title="העתק"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
      )}
    </button>
  );
}

const TAB_LABELS: Record<string, string> = {
  chat: 'שיחה כללית',
  org: 'הארגון שלי',
  opportunities: 'הזדמנויות פתוחות',
  business: 'חברות ועסקים',
  foundations: 'קרנות ופדרציות',
};

const TAB_QUICK_ACTIONS: Record<string, { label: string; prompt: string }[]> = {
  opportunities: [
    { label: '🔍 סרוק קולות קוראים', prompt: 'סרוק בשבילי קולות קוראים פתוחים שמתאימים לארגון' },
    { label: '📝 כתוב טיוטת הגשה', prompt: 'כתוב לי טיוטת הגשה לקול הקורא הכי מתאים' },
    { label: '📋 סכם דדליינים', prompt: 'תסכם לי את כל הדדליינים הקרובים של קולות קוראים רלוונטיים' },
  ],
  business: [
    { label: '🏢 חברות מתאימות', prompt: 'מצא לי חברות וקרנות שמתאימות לארגון שלנו' },
    { label: '✉️ נסח מייל פנייה', prompt: 'כתוב מייל פנייה מקצועי לחברה הכי מתאימה לנו' },
    { label: '📊 ניתוח תורמים', prompt: 'תנתח את התורמים הפוטנציאליים הכי גדולים שמתאימים לנו' },
  ],
  org: [
    { label: '📄 מה חסר בפרופיל?', prompt: 'מה חסר בפרופיל הארגון שלנו כדי לשפר התאמות?' },
    { label: '✨ שפר תיאור', prompt: 'שפר את תיאור הארגון שלנו לצורך הגשות' },
    { label: '🎯 נקודות חוזק', prompt: 'מה נקודות החוזק של הארגון שכדאי להדגיש בהגשות?' },
  ],
};

interface ChatPanelProps {
  orgId: string | null;
  userId: string | null;
  onStageChange?: (stage: number) => void;
}

export default function ChatPanel({ orgId, userId, onStageChange }: ChatPanelProps) {
  const makeWelcome = (): ChatMessage[] => {
    return [{ id: 'welcome', role: 'assistant', content: FISHGOLD_WELCOME, timestamp: new Date().toISOString() }];
  };
  const [messages, setMessages] = useState<ChatMessage[]>(makeWelcome());
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('chat');
  const activeTabRef = useRef('chat');
  const [loaded, setLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load last conversation on mount - Goldfish remembers you
  useEffect(() => {
    if (!orgId || !userId || loaded) return;

    async function loadLastConversation() {
      try {
        const res = await fetch(`/api/conversations?org_id=${orgId}&user_id=${userId}`);
        const data = await res.json();

        if (data.conversation?.messages?.length > 0) {
          const restored: ChatMessage[] = data.conversation.messages.map(
            (m: { role: string; content: string; timestamp?: string }, i: number) => ({
              id: `restored-${i}`,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: m.timestamp || data.conversation.updated_at,
            })
          );

          // Add a "memory" separator so the user knows this is from last time
          const memoryMsg: ChatMessage = {
            id: 'memory-separator',
            role: 'assistant',
            content: 'אני זוכר אותך. הנה המשך השיחה האחרונה שלנו:',
            timestamp: new Date().toISOString(),
          };

          setMessages([memoryMsg, ...restored]);
          setConversationId(data.conversation.id);
        }
      } catch {
        // First visit or error - keep welcome message
      } finally {
        setLoaded(true);
      }
    }

    loadLastConversation();
  }, [orgId, userId, loaded]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  };

  const sendMessage = useCallback(async (externalText?: string) => {
    const text = (externalText || input).trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    if (!externalText) setInput('');
    setIsStreaming(true);

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    // Start streaming assistant response
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          org_id: orgId,
          user_id: userId,
          active_tab: activeTab,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error('Chat API response:', res.status, errBody);
        throw new Error(`Chat failed (${res.status}): ${errBody.slice(0, 200)}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = '';
        let accumulated = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                accumulated += data.text;
                const snapshot = accumulated;
                setMessages(prev =>
                  prev.map((msg, i) =>
                    i === prev.length - 1 && msg.role === 'assistant'
                      ? { ...msg, content: snapshot }
                      : msg
                  )
                );
              }
              if (data.done && data.conversation_id) {
                setConversationId(data.conversation_id);
              }
            } catch {
              // skip malformed SSE
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant' && !last.content) {
          last.content = `שגיאה: ${errMsg}`;
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, conversationId, orgId, userId, activeTab]);

  // Expose sendMessage to sidebar via window for cross-component communication
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail;
      if (text) sendMessageRef.current(text);
    };
    const tabHandler = (e: Event) => {
      const tab = (e as CustomEvent).detail || 'chat';
      activeTabRef.current = tab;
      setActiveTab(tab);
      // Chat history stays continuous — only activeTab context changes
    };
    const loadConvHandler = async (e: Event) => {
      const { conversationId: convId } = (e as CustomEvent).detail || {};
      if (!convId || !orgId) return;
      try {
        const res = await fetch(`/api/conversations/${convId}?org_id=${orgId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.conversation?.messages?.length > 0) {
          const restored: ChatMessage[] = data.conversation.messages.map(
            (m: { role: string; content: string; timestamp?: string }, i: number) => ({
              id: `restored-${convId}-${i}`,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: m.timestamp || data.conversation.updated_at,
            })
          );
          const separator: ChatMessage = {
            id: `sep-${convId}`,
            role: 'assistant',
            content: `שיחה קודמת — ${data.conversation.title || 'שיחה'}\n\nאפשר להמשיך מכאן.`,
            timestamp: new Date().toISOString(),
          };
          setMessages([separator, ...restored]);
          setConversationId(convId);
          window.dispatchEvent(new CustomEvent('fishgold:closeSidebar'));
        }
      } catch { /* ignore */ }
    };

    const openUploadHandler = () => fileInputRef.current?.click();

    window.addEventListener('fishgold:send', handler);
    window.addEventListener('fishgold:activeTab', tabHandler);
    window.addEventListener('fishgold:loadConversation', loadConvHandler);
    window.addEventListener('fishgold:openUpload', openUploadHandler);
    return () => {
      window.removeEventListener('fishgold:send', handler);
      window.removeEventListener('fishgold:activeTab', tabHandler);
      window.removeEventListener('fishgold:loadConversation', loadConvHandler);
      window.removeEventListener('fishgold:openUpload', openUploadHandler);
    };
  }, [orgId]);

  const placeholderByTab: Record<string, string> = {
    chat: 'כתבו ל-Goldfish...',
    org: 'שלחו חומרים, לינק לאתר, או ספרו על הארגון...',
    opportunities: 'על איזה קול קורא לעבוד? כתבו שם או הדביקו לינק...',

    business: 'שאלו על חברה, קרן, או בקשו ניסוח מייל פנייה...',
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // File upload handler — uploads all files in parallel
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !orgId) return;

    const fileArr = Array.from(files);
    const fileNames = fileArr.map(f => f.name).join(', ');

    // Show a single "uploading" message for all files
    const uploadMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: fileArr.length === 1
        ? `[מעלה קובץ: ${fileArr[0].name}]`
        : `[מעלה ${fileArr.length} קבצים: ${fileNames}]`,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, uploadMsg]);

    // Upload files sequentially to avoid Gemini rate limiting (429)
    const results: PromiseSettledResult<{ name: string; category: string; summary: string; extracted_fields: Record<string, unknown> }>[] = [];
    for (const file of fileArr) {
      const result = await (async () => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('org_id', orgId);
        const res = await fetch('/api/upload', { method: 'POST', body: formData, headers: { 'x-org-id': orgId } });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'שגיאה');
        return { name: file.name, ...data };
      })().then(
        value => ({ status: 'fulfilled' as const, value }),
        reason => ({ status: 'rejected' as const, reason })
      );
      results.push(result);
    }

    const succeeded = results
      .filter((r): r is PromiseFulfilledResult<{ name: string; category: string; summary: string; extracted_fields: Record<string, unknown> }> => r.status === 'fulfilled')
      .map(r => r.value);
    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    if (succeeded.length > 0) onStageChange?.(1);

    // Build a combined summary and ask Goldfish to respond once
    if (succeeded.length > 0) {
      const summaryLines = succeeded.map(s =>
        `- "${s.name}" (${s.category}): ${s.summary || 'נקרא בהצלחה'}`
      ).join('\n');
      const failedLines = failed.length > 0
        ? `\n\nקבצים שנכשלו: ${failed.map((_, i) => fileArr[results.indexOf(_)]?.name).join(', ')}`
        : '';

      const docIds = succeeded.map(s => (s as Record<string, unknown>).document_id).filter(Boolean);
      const rejections = succeeded.filter(s => !!(s as Record<string, unknown>).rejection_insight);
      const rejectionLines = rejections.map(s => `[מכתב דחייה] ${(s as Record<string, unknown>).rejection_insight}`).join('\n');
      const chatPrompt = `[נקראו ${succeeded.length} קבצים בהצלחה]
${summaryLines}${failedLines}
${docIds.length > 0 ? `\n[document_ids: ${docIds.join(',')}]` : ''}
${rejectionLines ? `\n${rejectionLines}\nתנתח את הדחייה: מה היתה הסיבה העיקרית ומה לשנות בפנייה הבאה לאותו גוף?` : 'תגיב בקצרה: מה למדת מהקבצים האלה? ציין 2-3 נתונים חדשים שנכנסו, מה עדיין חסר, והצע פעולה אחת.'}`;

      const fishgoldMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, fishgoldMsg]);
      setIsStreaming(true);

      try {
        const chatRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: chatPrompt,
            conversation_id: conversationId,
            org_id: orgId,
            user_id: userId,
            active_tab: activeTab,
          }),
        });

        const reader = chatRes.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = '';
          let accumulated = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const d = JSON.parse(line.slice(6));
                if (d.text) {
                  accumulated += d.text;
                  const snapshot = accumulated;
                  setMessages(prev =>
                    prev.map((msg, i) =>
                      i === prev.length - 1 && msg.role === 'assistant'
                        ? { ...msg, content: snapshot }
                        : msg
                    )
                  );
                }
                if (d.done && d.conversation_id) {
                  setConversationId(d.conversation_id);
                }
              } catch { /* skip */ }
            }
          }
        }
      } catch {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant' && !last.content) {
            last.content = `קראתי ${succeeded.length} קבצים. המידע נכנס לזיכרון.`;
          }
          return updated;
        });
      } finally {
        setIsStreaming(false);
      }
    } else {
      // All failed
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `לא הצלחתי לקרוא את הקבצים. נסו פורמט אחר (PDF, DOCX, Excel, CSV, TXT).`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    }

    e.target.value = '';
  };

  const startNewChat = () => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: FISHGOLD_WELCOME,
      timestamp: new Date().toISOString(),
    }]);
    setConversationId(null);
    setInput('');
  };

  // History drawer state
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<{ id: string; title: string; updated_at: string; preview: string; message_count: number }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const openHistory = async () => {
    setShowHistory(true);
    if (!orgId || !userId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/conversations?org_id=${orgId}&user_id=${userId}&list=true`);
      const data = await res.json();
      setHistoryList(data.conversations || []);
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
  };

  const loadConversation = (convId: string) => {
    window.dispatchEvent(new CustomEvent('fishgold:loadConversation', { detail: { conversationId: convId } }));
    setShowHistory(false);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return 'היום';
    if (diffDays === 1) return 'אתמול';
    if (diffDays < 7) return `לפני ${diffDays} ימים`;
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Chat header with new chat + history buttons */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg2/50 flex-shrink-0">
        <button
          onClick={openHistory}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted hover:text-accent hover:bg-surf2 rounded-lg transition-colors"
          title="היסטוריית שיחות"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
          היסטוריה
        </button>
        {/* Context indicator */}
        <span className="text-[11px] text-muted/70 px-2 py-1 rounded-md bg-accent/5 border border-accent/10">
          עוזר עם: <span className="text-accent font-medium">{TAB_LABELS[activeTab] || 'שיחה כללית'}</span>
        </span>
        <button
          onClick={startNewChat}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted hover:text-accent hover:bg-surf2 rounded-lg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          שיחה חדשה
        </button>
      </div>

      {/* History drawer */}
      {showHistory && (
        <div className="absolute inset-0 z-20 flex flex-col bg-bg border-r border-border" dir="rtl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium text-text">היסטוריית שיחות</span>
            <button onClick={() => setShowHistory(false)} className="p-1.5 rounded-lg hover:bg-surf2 text-muted hover:text-text transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {historyLoading && (
              <div className="text-center text-muted text-sm py-8">טוען שיחות...</div>
            )}
            {!historyLoading && historyList.length === 0 && (
              <div className="text-center text-muted text-sm py-8">אין שיחות קודמות עדיין</div>
            )}
            {!historyLoading && historyList.map(conv => (
              <button
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                className="w-full text-right px-3 py-2.5 rounded-xl hover:bg-surf2 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-medium text-text truncate flex-1">
                    {conv.title || 'שיחה'}
                  </span>
                  <span className="text-[10px] text-muted flex-shrink-0 mt-0.5">{formatDate(conv.updated_at)}</span>
                </div>
                {conv.preview && (
                  <p className="text-[11px] text-muted mt-0.5 truncate">{conv.preview}</p>
                )}
                <span className="text-[10px] text-muted/60">{conv.message_count} הודעות</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 fade-up ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            {/* Avatar */}
            <div className="flex-shrink-0 mt-1">
              {msg.role === 'assistant' ? (
                <div className="w-8 h-8 rounded-full bg-accent-light flex items-center justify-center">
                  <FishLogo size={24} />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full bg-surf2 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
              )}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed relative group ${
                msg.role === 'user'
                  ? 'bg-accent text-white rounded-br-sm'
                  : 'bg-surf border border-border rounded-bl-sm'
              }`}
            >
              {msg.role === 'assistant' && msg.content && msg.id !== 'welcome' && msg.id !== 'memory-separator' && (
                <CopyButton text={msg.content} />
              )}
              <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: linkifyText(msg.content) }} />
              {msg.role === 'assistant' && isStreaming && msg === messages[messages.length - 1] && !msg.content && (
                <div className="flex items-center gap-2 py-1">
                  <span className="text-[11px] text-muted italic">{getRandomLoadingPhrase()}</span>
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Tab-specific quick actions */}
      {activeTab !== 'chat' && (
        <div className="mx-4 mb-1 flex flex-wrap gap-1.5">
          {(TAB_QUICK_ACTIONS[activeTab] || []).map((action, i) => (
            <button
              key={i}
              onClick={() => sendMessage(action.prompt)}
              disabled={isStreaming}
              className="px-3 py-1.5 text-[11px] bg-accent/8 hover:bg-accent/15 border border-accent/20 rounded-full text-text2 transition-colors disabled:opacity-40"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border bg-bg2 p-4">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          {/* File upload */}
          <label className="flex-shrink-0 cursor-pointer p-2 rounded-lg hover:bg-surf2 transition-colors text-muted hover:text-accent">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md"
              onChange={handleFileUpload}
            />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </label>

          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholderByTab[activeTab] || 'כתבי ל-Goldfish...'}
              rows={1}
              className="w-full resize-none rounded-xl border border-border bg-surf px-4 py-3 pr-12 text-sm focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Send button */}
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isStreaming}
            className="flex-shrink-0 p-2.5 rounded-xl bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
