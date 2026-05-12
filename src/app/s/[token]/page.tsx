'use client';

import { useEffect, useState, useRef } from 'react';
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

interface Submission {
  id: string;
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
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorName, setEditorName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState<SubmissionBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [lockError, setLockError] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentName, setCommentName] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const lockInterval = useRef<ReturnType<typeof setInterval> | null>(null);

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

    setEditContent(submission?.content ? JSON.parse(JSON.stringify(submission.content)) : []);
    setEditing(true);

    // Renew lock every 30 seconds
    lockInterval.current = setInterval(async () => {
      await fetch(`/api/submissions/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lock', editor_name: editorName }),
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
    setEditing(false);
    setSaving(false);
    await load();
  };

  const cancelEditing = async () => {
    await fetch(`/api/submissions/${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock' }),
    });
    if (lockInterval.current) clearInterval(lockInterval.current);
    setEditing(false);
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

        {/* Editor name prompt */}
        {!editorName && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="text-sm font-medium text-gray-700 mb-3">מה שמך? (לצורך עריכה והערות)</div>
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
            <div className="text-sm text-blue-700 font-medium">מצב עריכה פעיל</div>
            <div className="flex gap-2">
              <button onClick={cancelEditing} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                ביטול
              </button>
              <button
                onClick={saveEdits}
                disabled={saving}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'שומר...' : 'שמור שינויים'}
              </button>
            </div>
          </div>
        )}

        {/* Submission content */}
        <div className="space-y-4">
          {(editing ? editContent : submission.content).map((block, i) => (
            <div key={block.id} className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="text-xs font-semibold text-gray-400 mb-2">שאלה {i + 1}</div>
              <div className="text-sm font-medium text-gray-800 mb-3">{block.question}</div>
              {block.max_chars && (
                <div className="text-xs text-gray-400 mb-2">עד {block.max_chars} תווים</div>
              )}
              {editing ? (
                <div>
                  <textarea
                    value={editContent[i]?.answer || ''}
                    onChange={e => {
                      const updated = [...editContent];
                      updated[i] = { ...updated[i], answer: e.target.value };
                      setEditContent(updated);
                    }}
                    maxLength={block.max_chars || undefined}
                    rows={6}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400 resize-none"
                  />
                  {block.max_chars && (
                    <div className="text-xs text-gray-400 mt-1 text-left">
                      {editContent[i]?.answer?.length || 0} / {block.max_chars}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {block.answer || <span className="text-gray-400 italic">אין תשובה עדיין</span>}
                </div>
              )}
            </div>
          ))}
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
