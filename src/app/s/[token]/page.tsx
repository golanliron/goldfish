'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface SubmissionBlock {
  id: string;
  question: string;
  answer: string;
  max_chars?: number | null;
}

interface Comment {
  id: string;
  author_name: string;
  content: string;
  created_at: string;
}

interface RfpInfo {
  rfp_title?: string;
  funder_name?: string;
  deadline?: string;
  required_documents?: string[];
  rfp_url?: string;
}

interface Submission {
  id: string;
  org_id: string;
  status: string;
  version: number;
  content: SubmissionBlock[];
  locked_by?: string;
  locked_until?: string;
  share_token: string;
}

export default function SharedSubmissionPage() {
  const { token } = useParams<{ token: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [rfp, setRfp] = useState<RfpInfo | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorName, setEditorName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState<SubmissionBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [autoSaved, setAutoSaved] = useState<Date | null>(null);
  const [lockError, setLockError] = useState('');
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentName, setCommentName] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const lockInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Export / email
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [emailModal, setEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // AI assist per block
  const [aiPrompt, setAiPrompt] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiOpen, setAiOpen] = useState<Record<string, boolean>>({});

  const improveWithAI = useCallback(async (blockId: string, blockIndex: number) => {
    const prompt = aiPrompt[blockId] || '';
    const block = editContent[blockIndex];
    if (!block) return;
    setAiLoading(prev => ({ ...prev, [blockId]: true }));
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `אני עורך טיוטת הגשה לקרן.\n\nהשאלה: ${block.question}\n\nהתשובה הנוכחית:\n${block.answer}\n\n${prompt || 'שפר את התשובה — הפוך אותה ממוקדת, משכנעת ומקצועית יותר.'}\n\nהחזר רק את התשובה המשופרת, ללא הסברים.`,
          org_id: submission?.org_id || '',
          user_id: 'shared_editor',
          active_tab: 'chat',
        }),
      });
      if (!res.ok || !res.body) throw new Error('failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let result = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
      const clean = result.trim();
      const updated = [...editContent];
      updated[blockIndex] = { ...updated[blockIndex], answer: clean };
      setEditContent(updated);
      setAiOpen(prev => ({ ...prev, [blockId]: false }));
      setAiPrompt(prev => ({ ...prev, [blockId]: '' }));
    } catch {
      // ignore
    } finally {
      setAiLoading(prev => ({ ...prev, [blockId]: false }));
    }
  }, [editContent, aiPrompt]);

  useEffect(() => {
    load();
  }, [token]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/submissions/${token}`);
      const data = await res.json();
      if (data.submission) {
        setSubmission(data.submission);
        setComments(data.comments || []);
        setRfp(data.rfp || null);
      }
    } finally {
      setLoading(false);
    }
  };

  const startEditing = async () => {
    if (!editorName) return;
    setLockError('');

    const res = await fetch(`/api/submissions/${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lock', editor_name: editorName }),
    });
    const data = await res.json();

    if (data.error === 'locked') {
      setLockError(`${data.locked_by} עורך כרגע. נסי שוב בעוד דקה.`);
      return;
    }

    const initialContent = submission?.content ? JSON.parse(JSON.stringify(submission.content)) : [];
    setEditContent(initialContent);
    setEditing(true);
    setAutoSaved(null);

    // Renew lock every 30 seconds + autosave
    lockInterval.current = setInterval(async () => {
      await fetch(`/api/submissions/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lock', editor_name: editorName }),
      });
    }, 30000);

    // Autosave every 30 seconds
    autoSaveRef.current = setInterval(async () => {
      setEditContent(current => {
        fetch(`/api/submissions/${token}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: current, editor_name: editorName, version: submission?.version }),
        }).then(() => setAutoSaved(new Date()));
        return current;
      });
    }, 30000);
  };

  const saveEdits = async () => {
    setSaving(true);
    await fetch(`/api/submissions/${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent, editor_name: editorName, version: submission?.version }),
    });
    if (lockInterval.current) clearInterval(lockInterval.current);
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    setEditing(false);
    setSaving(false);
    setAutoSaved(null);
    await load();
  };

  const cancelEditing = async () => {
    await fetch(`/api/submissions/${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock' }),
    });
    if (lockInterval.current) clearInterval(lockInterval.current);
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    setEditing(false);
    setAutoSaved(null);
  };

  const addComment = async () => {
    if (!commentText || !commentName) return;
    setAddingComment(true);
    const res = await fetch(`/api/submissions/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author_name: commentName, content: commentText }),
    });
    const data = await res.json();
    if (data.comment) {
      setComments(prev => [...prev, data.comment]);
      setCommentText('');
    }
    setAddingComment(false);
  };

  // ===== Export functions =====
  const content = submission?.content || [];
  const orgName = rfp?.funder_name || '';
  const rfpTitle = rfp?.rfp_title || 'טיוטת הגשה';

  const exportPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>${rfpTitle}</title>
    <style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;direction:rtl;}
    h1{font-size:20px;margin-bottom:4px;}h2{font-size:13px;color:#666;font-weight:normal;margin-bottom:24px;}
    .block{margin-bottom:28px;page-break-inside:avoid;}
    .q{font-size:12px;font-weight:bold;color:#333;margin-bottom:8px;}
    .a{font-size:13px;line-height:1.7;color:#111;white-space:pre-wrap;border:1px solid #e5e7eb;border-radius:8px;padding:12px;}
    .footer{margin-top:40px;font-size:10px;color:#999;text-align:center;}
    @media print{body{margin:0;}}</style></head><body>
    <h1>${rfpTitle}</h1><h2>${orgName}</h2>
    ${content.map((b, i) => `<div class="block"><div class="q">שאלה ${i+1}: ${b.question}</div><div class="a">${b.answer}</div></div>`).join('')}
    <div class="footer">נוצר על ידי Goldfish · goldfish.co.il</div>
    </body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  };

  const exportWord = () => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" dir="rtl">
    <head><meta charset="utf-8"><title>${rfpTitle}</title>
    <style>body{font-family:Arial;direction:rtl;}h1{font-size:16pt;}h2{font-size:11pt;color:#666;}
    .q{font-weight:bold;font-size:11pt;margin-top:20pt;}
    .a{font-size:11pt;line-height:1.6;border:1pt solid #ccc;padding:8pt;}</style></head>
    <body><h1>${rfpTitle}</h1><h2>${orgName}</h2>
    ${content.map((b, i) => `<div><p class="q">שאלה ${i+1}: ${b.question}</p><p class="a">${b.answer.replace(/\n/g, '<br>')}</p></div>`).join('')}
    </body></html>`;
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rfpTitle}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyBlock = async (blockId: string, answer: string) => {
    await navigator.clipboard.writeText(answer);
    setCopied(prev => ({ ...prev, [blockId]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [blockId]: false })), 2000);
  };

  const sendEmail = async () => {
    if (!emailTo) return;
    setEmailSending(true);
    const body = `${rfpTitle}\n${orgName}\n\n` +
      content.map((b, i) => `שאלה ${i+1}: ${b.question}\n\n${b.answer}`).join('\n\n---\n\n');
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: emailTo, subject: `טיוטת הגשה: ${rfpTitle}`, body, from_name: 'Goldfish' }),
    });
    const data = await res.json();
    if (data.mailto_url) {
      window.open(data.mailto_url, '_blank');
    }
    setEmailSending(false);
    setEmailSent(true);
    setTimeout(() => { setEmailModal(false); setEmailSent(false); setEmailTo(''); }, 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">טוען הגשה...</div>
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-red-500 text-sm">הגשה לא נמצאה או שהלינק אינו תקף.</div>
      </div>
    );
  }

  const isLocked = submission.locked_by && submission.locked_until && new Date(submission.locked_until) > new Date();

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Goldfish — טיוטת הגשה משותפת</div>
            <div className="text-sm font-medium text-gray-700">
              גרסה {submission.version} · {submission.status === 'draft' ? 'טיוטה' : submission.status}
            </div>
          </div>
          {isLocked && !editing && (
            <div className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
              {submission.locked_by} עורך כרגע
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* RFP Info */}
        {rfp && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <div>
              <div className="text-xs text-gray-400 mb-1">קול קורא</div>
              <div className="text-lg font-bold text-gray-900">{rfp.rfp_title || 'ללא שם'}</div>
              {rfp.funder_name && (
                <div className="text-sm text-gray-500 mt-0.5">{rfp.funder_name}</div>
              )}
            </div>

            <div className="flex flex-wrap gap-4">
              {rfp.deadline && (
                <div className="flex items-center gap-2 bg-red-50 rounded-xl px-4 py-2 border border-red-100">
                  <span className="text-base">📅</span>
                  <div>
                    <div className="text-xs text-red-500 font-medium">דדליין להגשה</div>
                    <div className="text-sm font-bold text-red-700">
                      {new Date(rfp.deadline).toLocaleDateString('he-IL', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </div>
                  </div>
                </div>
              )}
              {rfp.rfp_url && (
                <a href={rfp.rfp_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-blue-50 rounded-xl px-4 py-2 border border-blue-100 text-blue-600 hover:text-blue-800 text-sm">
                  🔗 לינק לקול הקורא המקורי
                </a>
              )}
            </div>

            {rfp.required_documents && (rfp.required_documents as string[]).length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2">📎 מסמכים שצריך להכין מבעוד מועד</div>
                <ul className="space-y-1">
                  {(rfp.required_documents as string[]).map((doc, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-gray-400 mt-0.5">•</span>
                      {doc}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ===== Export Bar ===== */}
        <div className="flex flex-wrap gap-2">
          <button onClick={exportPDF}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            🖨️ הורד PDF
          </button>
          <button onClick={exportWord}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            📄 הורד Word
          </button>
          <button onClick={() => setEmailModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            ✉️ שלח למייל
          </button>
        </div>

        {/* Email modal */}
        {emailModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEmailModal(false)}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="font-semibold text-gray-800 mb-1">שלח טיוטה למייל</h3>
              <p className="text-xs text-gray-500 mb-4">הטיוטה תישלח כטקסט מסודר לכתובת שתבחרי</p>
              {emailSent ? (
                <div className="text-center py-4 text-green-600 font-medium">✓ נשלח!</div>
              ) : (
                <>
                  <input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)}
                    placeholder="your@email.com" dir="ltr"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 mb-3"
                    onKeyDown={e => e.key === 'Enter' && sendEmail()} />
                  <div className="flex gap-2">
                    <button onClick={() => setEmailModal(false)}
                      className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                      ביטול
                    </button>
                    <button onClick={sendEmail} disabled={!emailTo || emailSending}
                      className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 disabled:opacity-50">
                      {emailSending ? 'שולח...' : 'שלח'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Editor name prompt */}
        {!editorName && (
          <div className="bg-orange-50 rounded-2xl border border-orange-200 p-6">
            <div className="text-base font-semibold text-orange-800 mb-1">✏️ רוצה לערוך או לשפר עם AI?</div>
            <div className="text-sm text-orange-600 mb-3">הכניסי שם כדי להתחיל לערוך ולהשתמש בגולדפיש לשיפור תשובות</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                placeholder="שם מלא"
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
                onKeyDown={e => e.key === 'Enter' && nameInput.trim() && setEditorName(nameInput.trim())}
              />
              <button
                onClick={() => nameInput.trim() && setEditorName(nameInput.trim())}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700"
              >
                המשך
              </button>
            </div>
          </div>
        )}

        {/* Action bar */}
        {editorName && !editing && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">שלום, {editorName}</div>
            <div className="flex gap-2">
              {lockError && <div className="text-xs text-red-500 self-center">{lockError}</div>}
              <button
                onClick={startEditing}
                disabled={!!isLocked && submission.locked_by !== editorName}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-40"
              >
                ערוך הגשה
              </button>
            </div>
          </div>
        )}

        {editing && (
          <div className="flex items-center justify-between bg-blue-50 rounded-xl px-4 py-3 border border-blue-200">
            <div className="flex flex-col">
              <div className="text-sm text-blue-700 font-medium">מצב עריכה פעיל</div>
              {autoSaved && (
                <div className="text-[10px] text-blue-400 mt-0.5">
                  נשמר אוטומטית · {autoSaved.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={cancelEditing} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                ביטול
              </button>
              <button
                onClick={saveEdits}
                disabled={saving}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'שומר...' : 'שמור וסיים'}
              </button>
            </div>
          </div>
        )}

        {/* Submission content */}
        <div className="space-y-4">
          {(editing ? editContent : submission.content).map((block, i) => {
            const isMetaBlock = block.id === '_rfp_info' || block.id === '_goldfish_notes' || block.id === '_missing';
            const isReadonly = (block as SubmissionBlock & { readonly?: boolean }).readonly || block.id === '_rfp_info' || block.id === '_goldfish_notes';

            // Meta blocks: styled differently, never editable
            if (isMetaBlock) {
              const metaBg =
                block.id === '_rfp_info' ? 'bg-blue-50 border-blue-100' :
                block.id === '_goldfish_notes' ? 'bg-orange-50 border-orange-100' :
                'bg-amber-50 border-amber-100';
              const metaText =
                block.id === '_rfp_info' ? 'text-blue-800' :
                block.id === '_goldfish_notes' ? 'text-orange-800' :
                'text-amber-800';
              return (
                <div key={block.id} className={`rounded-2xl border p-5 ${metaBg}`}>
                  <div className={`text-xs font-bold mb-2 ${metaText}`}>{block.question}</div>
                  <div className={`text-sm whitespace-pre-wrap leading-relaxed ${metaText}`}>
                    {block.answer}
                  </div>
                </div>
              );
            }

            // Regular editable blocks
            const editIdx = editing ? editContent.findIndex(b => b.id === block.id) : i;
            return (
            <div key={block.id} className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="text-xs font-semibold text-gray-400 mb-2">שאלה {i}</div>
              <div className="text-sm font-medium text-gray-800 mb-3">{block.question}</div>
              {block.max_chars && (
                <div className="text-xs text-gray-400 mb-2 flex items-center gap-2">
                  <span>עד {block.max_chars} תווים</span>
                  {!editing && (
                    <span className={`font-medium ${
                      block.answer.length > block.max_chars ? 'text-red-500' :
                      block.answer.length > block.max_chars * 0.9 ? 'text-amber-500' : 'text-green-500'
                    }`}>
                      · {block.answer.length} כעת
                    </span>
                  )}
                </div>
              )}
              {!editing && !isReadonly && (
                <div className="flex justify-end mt-2">
                  <button onClick={() => copyBlock(block.id, block.answer)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors">
                    {copied[block.id] ? '✓ הועתק' : '📋 העתק תשובה'}
                  </button>
                </div>
              )}
              {editing && !isReadonly ? (
                <div>
                  <textarea
                    value={editContent[editIdx]?.answer || ''}
                    onChange={e => {
                      const updated = [...editContent];
                      updated[editIdx] = { ...updated[editIdx], answer: e.target.value };
                      setEditContent(updated);
                    }}
                    maxLength={block.max_chars || undefined}
                    rows={6}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400 resize-none"
                  />
                  <div className="flex items-center justify-between mt-1">
                    {block.max_chars ? (
                      <div className={`text-xs font-medium ${
                        (editContent[editIdx]?.answer?.length || 0) > block.max_chars
                          ? 'text-red-500'
                          : (editContent[editIdx]?.answer?.length || 0) > block.max_chars * 0.9
                          ? 'text-amber-500'
                          : 'text-gray-400'
                      }`}>
                        {editContent[editIdx]?.answer?.length || 0} / {block.max_chars} תווים
                        {(editContent[editIdx]?.answer?.length || 0) > block.max_chars && ' — חריגה!'}
                      </div>
                    ) : <div />}
                    <button
                      onClick={() => setAiOpen(prev => ({ ...prev, [block.id]: !prev[block.id] }))}
                      className="text-xs text-orange-500 hover:text-orange-700 flex items-center gap-1"
                    >
                      ✨ שפר עם גולדפיש
                    </button>
                  </div>
                  {aiOpen[block.id] && (
                    <div className="mt-2 bg-orange-50 rounded-xl border border-orange-200 p-3 space-y-2">
                      <div className="text-xs text-orange-700 font-medium">מה לשפר?</div>
                      <input
                        type="text"
                        value={aiPrompt[block.id] || ''}
                        onChange={e => setAiPrompt(prev => ({ ...prev, [block.id]: e.target.value }))}
                        placeholder="למשל: קצר ל-300 תווים, הדגש את האימפקט, הוסף נתונים..."
                        className="w-full px-3 py-2 rounded-lg border border-orange-200 text-sm focus:outline-none focus:border-orange-400 bg-white"
                        onKeyDown={e => e.key === 'Enter' && !aiLoading[block.id] && improveWithAI(block.id, editIdx)}
                      />
                      <button
                        onClick={() => improveWithAI(block.id, editIdx)}
                        disabled={!!aiLoading[block.id]}
                        className="w-full py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50"
                      >
                        {aiLoading[block.id] ? 'מעבד...' : 'שפר'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {block.answer || <span className="text-gray-400 italic">אין תשובה עדיין</span>}
                </div>
              )}
            </div>
            );
          })}
        </div>

        {/* Comments */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="text-sm font-semibold text-gray-700 mb-4">הערות ({comments.length})</div>

          {comments.length === 0 && (
            <div className="text-sm text-gray-400 mb-4">אין הערות עדיין. היי הראשון/ה!</div>
          )}

          <div className="space-y-3 mb-4">
            {comments.map(c => (
              <div key={c.id} className="bg-gray-50 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-gray-700">{c.author_name}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(c.created_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-sm text-gray-700">{c.content}</div>
              </div>
            ))}
          </div>

          {/* Add comment */}
          <div className="space-y-2">
            {!editorName && (
              <input
                type="text"
                value={commentName}
                onChange={e => setCommentName(e.target.value)}
                placeholder="שמך"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
              />
            )}
            <div className="flex gap-2">
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="הוסיפי הערה..."
                rows={2}
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400 resize-none"
              />
              <button
                onClick={addComment}
                disabled={addingComment || !commentText || !(editorName || commentName)}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-40 self-end"
              >
                שלח
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
