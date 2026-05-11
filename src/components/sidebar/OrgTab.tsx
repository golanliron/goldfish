'use client';

import { useEffect, useState, useRef } from 'react';
import type { AppStage, OrgProfileData, Document as FgDoc } from '@/types';

interface OrgTabProps {
  stage: AppStage;
  orgId: string | null;
}

// Category badge config
const CATEGORY_BADGES: Record<string, { label: string; color: string }> = {
  identity: { label: 'היכרות', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  official: { label: 'רשמי', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  programs: { label: 'תוכניות', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  budget: { label: 'תקציב', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  project_budget: { label: 'תקציב פרויקט', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  impact: { label: 'אימפקט', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  submission: { label: 'הגשה', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  grant: { label: 'גיוס', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  other: { label: 'כללי', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

// Official doc patterns — identity in DB but "רשמי" in display
const OFFICIAL_DOC_PATTERNS = /ניהול תקין|ניהול ספרים|סעיף 46|אישור 46|ניכוי מס|תעודת רישום|חברי ועד|בעלות חשבון|פרוטוקול ועד|רישום עמותה/i;

function getDocBadgeKey(doc: { filename?: string; category?: string }): string {
  const cat = doc.category || 'other';
  // If it's "identity" but matches official patterns, show as "רשמי"
  if (cat === 'identity' && doc.filename && OFFICIAL_DOC_PATTERNS.test(doc.filename)) {
    return 'official';
  }
  return cat;
}

// Filter tabs for the document list
const FILTER_TABS = [
  { key: 'all', label: 'הכל' },
  { key: 'official', label: 'רשמי' },
  { key: 'identity', label: 'היכרות' },
  { key: 'submission', label: 'הגשות' },
  { key: 'impact', label: 'אימפקט' },
  { key: 'budget', label: 'תקציב' },
  { key: 'grant', label: 'גיוס' },
];

// Required official documents checklist
const REQUIRED_DOCS = [
  { pattern: /ניהול תקין/i, label: 'ניהול תקין' },
  { pattern: /סעיף 46|saif.?46|אישור 46/i, label: 'סעיף 46' },
  { pattern: /ניכוי מס/i, label: 'ניכוי מס' },
  { pattern: /רישום עמותה|תעודת רישום/i, label: 'תעודת רישום' },
  { pattern: /דוח כספי|כספי.*מבוקר/i, label: 'דוח כספי מבוקר' },
  { pattern: /ניהול ספרים/i, label: 'ניהול ספרים' },
];

export default function OrgTab({ stage, orgId }: OrgTabProps) {
  const [profile, setProfile] = useState<OrgProfileData | null>(null);
  const [documents, setDocuments] = useState<FgDoc[]>([]);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<OrgProfileData>>({});
  const [uploading, setUploading] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [expandedMission, setExpandedMission] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [loadingLink, setLoadingLink] = useState(false);
  const [docFilter, setDocFilter] = useState('all');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const loadData = () => {
    if (!orgId) return;
    fetch(`/api/org?org_id=${orgId}`)
      .then(r => r.json())
      .then(({ profile: p, documents: d }) => {
        if (p) setProfile(p as OrgProfileData);
        setDocuments(d || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, [orgId]);

  // ===== Upload handler — parallel =====
  const handleFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    if (!fileArr.length || !orgId) return;

    setUploading(true);
    setFeedback(null);

    const results = await Promise.allSettled(
      fileArr.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('org_id', orgId);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'שגיאה' }));
          throw new Error(data.error || 'שגיאה בהעלאה');
        }
        return res.json();
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedNames = results
      .map((r, i) => r.status === 'rejected' ? fileArr[i].name : null)
      .filter(Boolean);

    setUploading(false);
    loadData();

    if (successCount > 0 && failedNames.length === 0) {
      setFeedback(`${successCount} קבצים נקראו ונשמרו`);
    } else if (successCount > 0 && failedNames.length > 0) {
      setFeedback(`${successCount} נקראו. נכשלו: ${failedNames.join(', ')}`);
    } else {
      setFeedback(`לא הצלחתי לקרוא: ${failedNames.join(', ')}`);
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = '';
  };

  // ===== URL / Drive handler =====
  const handleLink = async () => {
    if (!orgId || !linkUrl.trim()) return;
    setLoadingLink(true);
    setFeedback(null);

    try {
      // Detect if it's a Drive link
      const isDrive = /drive\.google\.com/i.test(linkUrl);
      const endpoint = isDrive ? '/api/drive/connect' : '/api/learn-url';
      const body = isDrive
        ? { org_id: orgId, drive_url: linkUrl.trim() }
        : { org_id: orgId, url: linkUrl.trim() };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok) {
        setFeedback(isDrive
          ? (data.message || 'Drive חובר בהצלחה')
          : `Goldfish למד מ-"${data.title || linkUrl}"`);
        setLinkUrl('');
        loadData();
      } else {
        setFeedback(data.error || 'שגיאה בקריאת הקישור');
      }
    } catch {
      setFeedback('שגיאה בקריאת הקישור');
    }
    setLoadingLink(false);
  };

  // ===== Free text handler =====
  const handleFreeText = async () => {
    if (!orgId || !freeText.trim()) return;
    setSavingText(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId,
          text: freeText.trim(),
          category: 'identity',
          filename: 'תיאור חופשי.txt',
        }),
      });
      const data = await res.json();
      setFreeText('');
      setFeedback(data.summary || 'Goldfish קרא ולמד את התוכן');
      loadData();
    } catch {
      setFeedback('שגיאה בשמירה');
    }
    setSavingText(false);
  };

  // ===== Document actions =====
  const handleDownload = (doc: FgDoc) => {
    if (doc.file_type === 'url' && doc.storage_path?.startsWith('http')) {
      window.open(doc.storage_path, '_blank');
      return;
    }
    if (doc.parsed_text) {
      const blob = new Blob([doc.parsed_text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename || 'document.txt';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    window.open(`/api/documents/${doc.id}`, '_blank');
  };

  const handleDelete = async (docId: string) => {
    if (!orgId) return;
    try {
      await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      });
      loadData();
    } catch {
      console.error('Delete failed');
    }
  };

  // ===== Profile save =====
  const saveProfile = async () => {
    if (!orgId) return;
    const merged = { ...profile, ...editData };
    await fetch('/api/org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, data: merged }),
    });
    setProfile(merged as OrgProfileData);
    setEditing(false);
    setEditData({});
  };

  // ===== Drag & drop =====
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  // ===== Computed data =====
  // Group docs by category for filtering
  const filteredDocs = documents.filter(doc => {
    if (docFilter === 'all') return true;
    const displayKey = getDocBadgeKey(doc);
    if (docFilter === 'identity') return displayKey === 'identity';
    if (docFilter === 'official') return displayKey === 'official';
    const cat = doc.category === 'project' ? 'programs' : doc.category;
    return cat === docFilter;
  });

  // Missing required docs
  const docTexts = documents.map(d => {
    const meta = (d.metadata || {}) as Record<string, unknown>;
    return `${d.filename} ${(meta.doc_type as string) || ''} ${d.parsed_text?.slice(0, 500) || ''}`;
  });
  const missingDocs = REQUIRED_DOCS.filter(req => !docTexts.some(t => req.pattern.test(t)));

  // Knowledge completeness
  const docsByCategory = documents.reduce<Record<string, FgDoc[]>>((acc, doc) => {
    let cat = doc.category || 'other';
    if (cat === 'project') cat = 'programs';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(doc);
    return acc;
  }, {});

  const filledCategories = Object.keys(docsByCategory).filter(k => k !== 'other');

  const checks = [
    { met: !!(docsByCategory['identity']?.length), w: 2 },
    { met: !!(docsByCategory['programs']?.length), w: 2 },
    { met: !!(docsByCategory['budget']?.length), w: 2 },
    { met: !!(docsByCategory['impact']?.length), w: 2 },
    { met: !!(docsByCategory['submission']?.length), w: 2 },
    { met: !!(profile?.mission && profile.mission.length > 20), w: 2 },
    { met: !!(profile?.annual_budget && profile.annual_budget > 0), w: 2 },
    { met: !!(profile?.beneficiaries_count && profile.beneficiaries_count > 0), w: 2 },
    { met: !!(profile?.focus_areas && profile.focus_areas.length > 0), w: 1 },
    { met: !!profile?.registration_number, w: 1 },
    { met: documents.length >= 3, w: 2 },
    { met: documents.length >= 5, w: 2 },
    { met: filledCategories.length >= 3, w: 2 },
    { met: !!(profile?.mission && profile.mission.length > 50), w: 2 },
  ];

  const totalWeight = checks.reduce((s, c) => s + c.w, 0);
  const earnedWeight = checks.filter(c => c.met).reduce((s, c) => s + c.w, 0);
  const completeness = Math.round((earnedWeight / totalWeight) * 100);

  // Missing knowledge items (for the bottom bar)
  const missingKnowledge: string[] = [];
  if (!docsByCategory['budget']?.length) missingKnowledge.push('דוח כספי');
  if (!docsByCategory['programs']?.length) missingKnowledge.push('תיאור תוכניות');
  if (!docsByCategory['impact']?.length) missingKnowledge.push('דוח אימפקט');
  if (!(profile?.mission && profile.mission.length > 20)) missingKnowledge.push('תיאור מטרה');
  if (!(profile?.annual_budget && profile.annual_budget > 0)) missingKnowledge.push('מחזור שנתי');

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md,.csv,.html,.pptx"
        onChange={handleUpload}
      />

      {/* ===== BLOCK 1: Org Identity Card ===== */}
      {profile?.name && (
        <div className="bg-surf rounded-xl border border-border p-4 slide-in-right">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-sm">{editing ? (
              <input
                type="text"
                defaultValue={profile.name}
                onChange={e => setEditData(d => ({ ...d, name: e.target.value }))}
                className="w-full px-2 py-1 text-sm border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none"
              />
            ) : profile.name}</h3>
            <button
              onClick={() => {
                if (editing) { saveProfile(); } else { setEditing(true); setEditData({}); }
              }}
              className="text-[10px] text-accent hover:underline flex-shrink-0"
            >
              {editing ? 'שמור' : 'עריכה'}
            </button>
          </div>

          {editing ? (
            <div className="space-y-2 text-xs">
              <div>
                <label className="text-muted text-[10px]">מטרה</label>
                <textarea
                  defaultValue={profile.mission || ''}
                  onChange={e => setEditData(d => ({ ...d, mission: e.target.value }))}
                  className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs resize-none"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-muted text-[10px]">מחזור שנתי</label>
                  <input type="number" defaultValue={profile.annual_budget || ''} onChange={e => setEditData(d => ({ ...d, annual_budget: Number(e.target.value) }))} className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs" />
                </div>
                <div>
                  <label className="text-muted text-[10px]">מוטבים</label>
                  <input type="number" defaultValue={profile.beneficiaries_count || ''} onChange={e => setEditData(d => ({ ...d, beneficiaries_count: Number(e.target.value) }))} className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs" />
                </div>
              </div>
              <div>
                <label className="text-muted text-[10px]">ע.ר.</label>
                <input type="text" defaultValue={profile.registration_number || ''} onChange={e => setEditData(d => ({ ...d, registration_number: e.target.value }))} className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs" />
              </div>
              <div className="pt-1 border-t border-border/30">
                <p className="text-[10px] text-muted font-semibold mb-1">איש קשר</p>
                <div className="space-y-1.5">
                  <input type="text" defaultValue={(profile as Record<string, unknown>).contact_name as string || ''} onChange={e => setEditData(d => ({ ...d, contact_name: e.target.value }))} className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs" placeholder="שם מלא" />
                  <input type="email" defaultValue={(profile as Record<string, unknown>).contact_email as string || ''} onChange={e => setEditData(d => ({ ...d, contact_email: e.target.value }))} className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs" dir="ltr" placeholder="email@org.co.il" />
                  <input type="tel" defaultValue={(profile as Record<string, unknown>).contact_phone as string || ''} onChange={e => setEditData(d => ({ ...d, contact_phone: e.target.value }))} className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs" dir="ltr" placeholder="050-000-0000" />
                  <input type="url" defaultValue={(profile as Record<string, unknown>).website as string || ''} onChange={e => setEditData(d => ({ ...d, website: e.target.value }))} className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs" dir="ltr" placeholder="https://www.org.co.il" />
                </div>
              </div>
              <button onClick={() => { setEditing(false); setEditData({}); }} className="text-[10px] text-muted hover:text-text">ביטול</button>
            </div>
          ) : (
            <>
              {profile.registration_number && (
                <p className="text-xs text-muted">ע.ר. {profile.registration_number}</p>
              )}
              {profile.mission && (
                <div className="mt-2">
                  <p className={`text-xs text-text2 leading-relaxed ${expandedMission ? '' : 'line-clamp-3'}`}>{profile.mission}</p>
                  {profile.mission.length > 150 && (
                    <button onClick={() => setExpandedMission(v => !v)} className="text-[10px] text-accent hover:underline mt-0.5">
                      {expandedMission ? 'פחות' : 'עוד...'}
                    </button>
                  )}
                </div>
              )}

              {/* Contact */}
              {((profile as Record<string, unknown>).contact_name || (profile as Record<string, unknown>).contact_email) && (
                <div className="mt-2 pt-2 border-t border-border/30 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
                  {!!(profile as Record<string, unknown>).contact_name && <span>{String((profile as Record<string, unknown>).contact_name)}</span>}
                  {!!(profile as Record<string, unknown>).contact_email && <span dir="ltr">{String((profile as Record<string, unknown>).contact_email)}</span>}
                  {!!(profile as Record<string, unknown>).contact_phone && <span dir="ltr">{String((profile as Record<string, unknown>).contact_phone)}</span>}
                </div>
              )}

              {/* Key numbers */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                {profile.annual_budget ? (
                  <div className="bg-surf2 rounded-lg p-2 text-center">
                    <div className="text-sm font-semibold text-accent">{(profile.annual_budget / 1000000).toFixed(1)}M</div>
                    <div className="text-[9px] text-muted">מחזור</div>
                  </div>
                ) : null}
                {profile.beneficiaries_count ? (
                  <div className="bg-surf2 rounded-lg p-2 text-center">
                    <div className="text-sm font-semibold text-accent">{profile.beneficiaries_count.toLocaleString('he-IL')}</div>
                    <div className="text-[9px] text-muted">מוטבים</div>
                  </div>
                ) : null}
                {profile.employees_count ? (
                  <div className="bg-surf2 rounded-lg p-2 text-center">
                    <div className="text-sm font-semibold text-accent">{profile.employees_count}</div>
                    <div className="text-[9px] text-muted">עובדים</div>
                  </div>
                ) : null}
              </div>

              {/* Focus areas */}
              {profile.focus_areas && profile.focus_areas.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {profile.focus_areas.map((area, i) => (
                    <span key={i} className="px-2 py-0.5 bg-accent-light text-accent text-[10px] rounded-full font-medium">{area}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== BLOCK 2: Add Content — unified input ===== */}
      <div className="rounded-xl border border-border bg-surf p-3 space-y-3">
        <h4 className="text-xs font-semibold flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          הוסיפו חומר ל-Goldfish
        </h4>
        <p className="text-[10px] text-muted2 -mt-1">
          העלו קבצים, הדביקו קישור, או כתבו — Goldfish מזהה ושומר אוטומטית.
        </p>

        {/* Drop zone */}
        <div
          ref={dropRef}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all ${
            dragging
              ? 'border-accent bg-accent/5 scale-[1.02]'
              : uploading
              ? 'border-border bg-surf2 opacity-60 cursor-wait'
              : 'border-border hover:border-accent/40 hover:bg-surf2'
          }`}
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-muted">קורא מסמכים...</span>
            </div>
          ) : (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-1 text-muted2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="text-xs text-muted">גררו קבצים לכאן או לחצו</p>
              <p className="text-[9px] text-muted2 mt-0.5">PDF, Word, Excel, PPT — כמה קבצים בבת אחת</p>
            </>
          )}
        </div>

        {/* Link input */}
        <div className="flex gap-1.5">
          <input
            type="url"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLink()}
            placeholder="https:// — אתר, דף אודות, Google Drive..."
            className="flex-1 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-bg focus:border-accent focus:outline-none"
            dir="ltr"
          />
          <button
            onClick={handleLink}
            disabled={loadingLink || !linkUrl.trim()}
            className="px-3 py-1.5 text-[11px] font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {loadingLink ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : 'קרא'}
          </button>
        </div>

        {/* Free text (collapsible) */}
        <details className="group">
          <summary className="text-[11px] text-accent cursor-pointer hover:underline list-none flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-open:rotate-90">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            כתבו בטקסט חופשי
          </summary>
          <div className="mt-2 space-y-2">
            <textarea
              value={freeText}
              onChange={e => setFreeText(e.target.value)}
              placeholder="הדביקו תיאור, העתיקו מהאתר, או כתבו בחופשיות..."
              className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-bg resize-none focus:border-accent focus:outline-none placeholder:text-muted2"
              rows={3}
              dir="rtl"
            />
            {freeText.trim().length > 0 && (
              <button
                onClick={handleFreeText}
                disabled={savingText}
                className="w-full py-1.5 text-[11px] font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {savingText ? 'שומר...' : 'שמור'}
              </button>
            )}
          </div>
        </details>

        {/* Feedback message */}
        {feedback && (
          <p className={`text-[11px] leading-relaxed ${feedback.includes('שגיאה') ? 'text-red-500' : 'text-green-600'}`}>
            {feedback}
          </p>
        )}
      </div>

      {/* ===== BLOCK 3: Document File — flat list with filters ===== */}
      {documents.length > 0 && (
        <div className="rounded-xl border border-border bg-surf p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold">תיק הארגון</h4>
            <span className="text-[10px] text-muted2">{documents.length} מסמכים</span>
          </div>

          {/* Filter pills */}
          {documents.length > 3 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {FILTER_TABS.map(tab => {
                const count = tab.key === 'all'
                  ? documents.length
                  : documents.filter(d => {
                    const dk = getDocBadgeKey(d);
                    if (tab.key === 'official') return dk === 'official';
                    if (tab.key === 'identity') return dk === 'identity';
                    const cat = d.category === 'project' ? 'programs' : d.category;
                    return cat === tab.key;
                  }).length;
                if (tab.key !== 'all' && count === 0) return null;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setDocFilter(tab.key)}
                    className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                      docFilter === tab.key
                        ? 'bg-accent text-white'
                        : 'bg-surf2 text-muted hover:text-text'
                    }`}
                  >
                    {tab.label} {count > 0 && tab.key !== 'all' ? `(${count})` : ''}
                  </button>
                );
              })}
            </div>
          )}

          {/* Document list */}
          <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
            {filteredDocs.map(doc => {
              const badge = CATEGORY_BADGES[getDocBadgeKey(doc)] || CATEGORY_BADGES.other;
              return (
                <div key={doc.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-surf2 transition-colors text-xs group">
                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(doc.id)}
                    title="הסרה"
                    className="p-0.5 text-muted2 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                  {/* Open */}
                  <button
                    onClick={() => handleDownload(doc)}
                    title="פתיחה"
                    className="p-0.5 text-muted2 hover:text-accent transition-colors flex-shrink-0"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </button>
                  {/* Name */}
                  <span className="truncate text-[11px] flex-1 min-w-0">{doc.filename}</span>
                  {/* Category badge */}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.color}`}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Missing official docs — compact one-liner */}
          {missingDocs.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-muted">
              <span className="text-amber-600 font-medium">חסר: </span>
              {missingDocs.map(d => d.label).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* ===== BLOCK 4: Knowledge bar ===== */}
      <div className="bg-surf rounded-xl border border-border p-3">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[11px] font-semibold text-muted">Goldfish מכיר</h4>
          <span className={`text-[11px] font-bold ${
            completeness >= 90 ? 'text-green-600' : completeness >= 60 ? 'text-amber-600' : 'text-red-500'
          }`}>
            {completeness}%
          </span>
        </div>
        <div className="h-1.5 bg-surf2 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${completeness}%`,
              background: completeness >= 90 ? '#22C55E' : completeness >= 60 ? '#F59E0B' : '#EF4444',
            }}
          />
        </div>
        {missingKnowledge.length > 0 && completeness < 90 && (
          <p className="text-[10px] text-muted2 mt-1.5">
            <span className="text-muted">מה יעזור: </span>
            {missingKnowledge.slice(0, 3).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
