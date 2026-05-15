'use client';

import { useEffect, useState, useRef } from 'react';
import type { AppStage, OrgProfileData, Document as FgDoc, OrgScore } from '@/types';

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
  // If category is already official — keep it
  if (cat === 'official') return 'official';
  // If it's "identity" but matches official patterns, show as "רשמי"
  if ((cat === 'identity' || cat === 'other') && doc.filename && OFFICIAL_DOC_PATTERNS.test(doc.filename)) {
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

// Required official documents — detected by content/filename patterns
// Each entry has a label, a pattern to search in filename+text, and a category hint
const REQUIRED_DOCS: { label: string; pattern: RegExp; hint?: string }[] = [
  { label: 'ניהול תקין', pattern: /ניהול תקין/i, hint: 'official' },
  { label: 'סעיף 46', pattern: /סעיף 46|אישור 46|section.?46/i, hint: 'official' },
  { label: 'ניכוי מס', pattern: /ניכוי מס/i, hint: 'official' },
  { label: 'תעודת רישום', pattern: /תעודת רישום|רישום עמותה/i, hint: 'official' },
  { label: 'דוח כספי', pattern: /דוח כספי|דוחות כספיים|כספי.*מבוקר|financial.*report/i, hint: 'budget' },
  { label: 'ניהול ספרים', pattern: /ניהול ספרים/i, hint: 'official' },
  { label: 'אישור חברי ועד', pattern: /חברי ועד|ועד מנהל/i, hint: 'official' },
];

// Populations + Domains + Geo options — mirrors onboarding chips
const POPULATION_OPTIONS = [
  { slug: 'youth_at_risk', label: 'נוער בסיכון' },
  { slug: 'youth', label: 'נוער' },
  { slug: 'young_adults', label: 'צעירים 18–26' },
  { slug: 'children', label: 'ילדים' },
  { slug: 'elderly', label: 'קשישים' },
  { slug: 'disabilities', label: 'נכויות' },
  { slug: 'immigrants', label: 'עולים ומהגרים' },
  { slug: 'ethiopian', label: 'קהילה אתיופית' },
  { slug: 'haredi', label: 'חרדים' },
  { slug: 'arab', label: 'ערבים' },
  { slug: 'women', label: 'נשים' },
  { slug: 'soldiers', label: 'חיילים' },
  { slug: 'lgbtq', label: 'להט"ב' },
  { slug: 'homeless', label: 'חסרי בית' },
];
const DOMAIN_OPTIONS = [
  { slug: 'education', label: 'חינוך' },
  { slug: 'employment', label: 'תעסוקה' },
  { slug: 'welfare', label: 'רווחה' },
  { slug: 'health', label: 'בריאות' },
  { slug: 'mental_health', label: 'בריאות נפש' },
  { slug: 'community', label: 'קהילה' },
  { slug: 'housing', label: 'דיור' },
  { slug: 'legal', label: 'זכויות ומשפטי' },
  { slug: 'culture', label: 'תרבות' },
  { slug: 'sport', label: 'ספורט' },
  { slug: 'environment', label: 'סביבה' },
  { slug: 'technology', label: 'טכנולוגיה' },
  { slug: 'leadership', label: 'מנהיגות' },
  { slug: 'coexistence', label: 'דו-קיום' },
];
const GEO_OPTIONS = [
  { slug: 'national', label: 'ארצי' },
  { slug: 'periphery', label: 'פריפריה' },
  { slug: 'negev', label: 'נגב' },
  { slug: 'galilee', label: 'גליל' },
  { slug: 'jerusalem', label: 'ירושלים' },
  { slug: 'center', label: 'מרכז' },
  { slug: 'north', label: 'צפון' },
  { slug: 'south', label: 'דרום' },
];

export default function OrgTab({ stage, orgId }: OrgTabProps) {
  const [profile, setProfile] = useState<OrgProfileData | null>(null);
  const [documents, setDocuments] = useState<FgDoc[]>([]);
  const [orgScore, setOrgScore] = useState<OrgScore | null>(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<OrgProfileData>>({});
  const [editPopulations, setEditPopulations] = useState<string[]>([]);
  const [editDomains, setEditDomains] = useState<string[]>([]);
  const [editRegions, setEditRegions] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [expandedMission, setExpandedMission] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [loadingLink, setLoadingLink] = useState(false);
  const [docFilter, setDocFilter] = useState('all');
  const [dragging, setDragging] = useState(false);
  const [vaultData, setVaultData] = useState<{
    vault_score: number;
    total_covered: number;
    total_required: number;
    missing: { key: string; label: string; hint: string; ttl_months?: number }[];
    expiring: { id: string; filename: string; expiry_date: string | null; is_expired: boolean }[];
  } | null>(null);
  const [showVault, setShowVault] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    if (!orgId) return;
    await Promise.all([
      fetch(`/api/org?org_id=${orgId}`)
        .then(r => r.json())
        .then(({ profile: p, documents: d, score }) => {
          if (p) setProfile(p as OrgProfileData);
          const visibleDocs = (d || []).filter((doc: FgDoc) => !(doc.metadata as Record<string, unknown>)?.blocked);
          setDocuments(visibleDocs);
          if (score) setOrgScore(score);
        })
        .catch(() => {}),
      fetch(`/api/documents/vault`)
        .then(r => r.json())
        .then(v => setVaultData(v))
        .catch(() => {}),
    ]);
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
        const res = await fetch('/api/upload', { method: 'POST', body: formData, headers: { 'x-org-id': orgId } });
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

    type UploadResult = { message?: string; vault_warning?: string; status?: string };

    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<UploadResult> => r.status === 'fulfilled')
      .map(r => r.value);

    setUploading(false);
    await loadData(); // wait for refresh so checklist updates immediately

    // Use server-built message directly — it already contains ✅/⚠️ and all details
    const serverMessage = fulfilled.map(r => r.message).find(Boolean);
    if (serverMessage) {
      setFeedback(serverMessage);
    } else if (successCount > 0 && failedNames.length === 0) {
      setFeedback(`${successCount === 1 ? 'קובץ' : `${successCount} קבצים`} נקראו ונשמרו`);
    } else if (successCount > 0) {
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
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
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

  const handleDelete = async (docId: string, filename?: string) => {
    if (!orgId) return;
    if (!confirm(`למחוק את "${filename || 'מסמך'}"?`)) return;
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

  const handleCategoryChange = async (docId: string, newCategory: string) => {
    if (!orgId) return;
    try {
      await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, category: newCategory }),
      });
      setEditingDocId(null);
      loadData();
    } catch {
      console.error('Category change failed');
    }
  };

  // ===== Profile save =====
  const saveProfile = async () => {
    if (!orgId) return;
    const merged = {
      ...profile,
      ...editData,
      populations: editPopulations,
      domains: editDomains,
      regions: editRegions,
    };
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

  // Build a searchable string per document: filename + doc_type + first 1000 chars of text
  // Also check by category hint — if a category exists, count as found for that type
  const buildDocSearchStr = (d: FgDoc) => {
    const meta = (d.metadata || {}) as Record<string, unknown>;
    return `${d.filename || ''} ${(meta.doc_type as string) || ''} ${d.category || ''} ${d.parsed_text?.slice(0, 1000) || ''}`;
  };
  const docSearchStrings = documents.map(buildDocSearchStr);

  // A required doc is "found" if:
  //   (a) its pattern matches any doc's search string, OR
  //   (b) its category hint matches an existing doc category
  const missingDocs = REQUIRED_DOCS.filter(req => {
    const byPattern = docSearchStrings.some(t => req.pattern.test(t));
    const byCategory = req.hint
      ? documents.some(d => d.category === req.hint && d.file_type !== 'url')
      : false;
    return !byPattern && !byCategory;
  });

  // Knowledge completeness
  const docsByCategory = documents.reduce<Record<string, FgDoc[]>>((acc, doc) => {
    let cat = doc.category || 'other';
    if (cat === 'project') cat = 'programs';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(doc);
    return acc;
  }, {});

  const filledCategories = Object.keys(docsByCategory).filter(k => k !== 'other');


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

      {/* ===== KNOWLEDGE SCORE ===== */}
      <div className="bg-surf rounded-xl border border-border p-4 slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] text-muted font-medium">היכרות Goldfish עם הארגון</span>
          {orgScore && (
            <span className={`text-2xl font-bold ${
              orgScore.total >= 75 ? 'text-green-600' :
              orgScore.total >= 35 ? 'text-amber-500' : 'text-muted'
            }`}>{orgScore.total}%</span>
          )}
        </div>

        {/* Main progress bar */}
        {orgScore && (
          <div className="h-1.5 bg-surf2 rounded-full overflow-hidden mb-4">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                orgScore.total >= 75 ? 'bg-green-500' :
                orgScore.total >= 35 ? 'bg-amber-400' : 'bg-border'
              }`}
              style={{ width: `${orgScore.total}%` }}
            />
          </div>
        )}

        {/* Breakdown per category */}
        {orgScore && (
          <div className="space-y-2 mb-3">
            {orgScore.breakdown.map((b) => (
              <div key={b.category} className="flex items-center gap-2">
                {/* Status icon */}
                <span className="text-xs w-4 text-center">
                  {b.status === 'full' ? '✓' : b.status === 'partial' ? '·' : '○'}
                </span>
                {/* Label */}
                <span className="text-[11px] text-text2 w-20 shrink-0">{b.label}</span>
                {/* Bar */}
                <div className="flex-1 h-1 bg-surf2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      b.status === 'full' ? 'bg-green-400' :
                      b.status === 'partial' ? 'bg-amber-300' : 'bg-transparent'
                    }`}
                    style={{ width: `${b.score}%` }}
                  />
                </div>
                {/* Status label */}
                <span className={`text-[10px] w-10 text-left shrink-0 ${
                  b.status === 'full' ? 'text-green-600' :
                  b.status === 'partial' ? 'text-amber-500' : 'text-muted2'
                }`}>
                  {b.status === 'full' ? 'מלא' : b.status === 'partial' ? 'חלקי' : 'חסר'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* CTAs — top missing items */}
        {orgScore && (() => {
          const missing = orgScore.breakdown
            .filter(b => b.status !== 'full' && b.cta)
            .sort((a, b) => a.score - b.score)
            .slice(0, 2);
          if (missing.length === 0) return (
            <p className="text-[10px] text-green-600">Goldfish מכיר את הארגון היטב — מוכן לכתוב הגשות מדויקות</p>
          );
          return (
            <div className="space-y-1.5 pt-1 border-t border-border">
              {missing.map((b) => (
                <button
                  key={b.category}
                  onClick={() => {/* scroll to upload or open chat */}}
                  className="w-full text-right text-[10px] text-accent hover:underline truncate"
                >
                  + {b.cta}
                </button>
              ))}
            </div>
          );
        })()}

        {/* Fallback when score not loaded yet */}
        {!orgScore && (
          <p className="text-[10px] text-muted">מחשב היכרות...</p>
        )}
      </div>

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
                if (editing) { saveProfile(); } else {
                  setEditing(true);
                  setEditData({});
                  const p = profile as Record<string, unknown>;
                  setEditPopulations((p.populations as string[]) || []);
                  setEditDomains((p.domains as string[]) || []);
                  setEditRegions((p.regions as string[]) || []);
                }
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

              {/* Populations chips */}
              <div className="pt-1 border-t border-border/30">
                <label className="text-muted text-[10px] font-semibold block mb-1.5">אוכלוסיות יעד</label>
                <div className="flex flex-wrap gap-1">
                  {POPULATION_OPTIONS.map(opt => {
                    const active = editPopulations.includes(opt.slug);
                    return (
                      <button
                        key={opt.slug}
                        type="button"
                        onClick={() => setEditPopulations(prev =>
                          active ? prev.filter(s => s !== opt.slug) : [...prev, opt.slug]
                        )}
                        className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                          active
                            ? 'bg-accent text-white border-accent'
                            : 'bg-surf2 text-muted border-border hover:border-accent/50'
                        }`}
                      >{opt.label}</button>
                    );
                  })}
                </div>
              </div>

              {/* Domains chips */}
              <div>
                <label className="text-muted text-[10px] font-semibold block mb-1.5">תחומי פעילות</label>
                <div className="flex flex-wrap gap-1">
                  {DOMAIN_OPTIONS.map(opt => {
                    const active = editDomains.includes(opt.slug);
                    return (
                      <button
                        key={opt.slug}
                        type="button"
                        onClick={() => setEditDomains(prev =>
                          active ? prev.filter(s => s !== opt.slug) : [...prev, opt.slug]
                        )}
                        className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                          active
                            ? 'bg-accent text-white border-accent'
                            : 'bg-surf2 text-muted border-border hover:border-accent/50'
                        }`}
                      >{opt.label}</button>
                    );
                  })}
                </div>
              </div>

              {/* Geo chips */}
              <div>
                <label className="text-muted text-[10px] font-semibold block mb-1.5">אזור גיאוגרפי</label>
                <div className="flex flex-wrap gap-1">
                  {GEO_OPTIONS.map(opt => {
                    const active = editRegions.includes(opt.slug);
                    return (
                      <button
                        key={opt.slug}
                        type="button"
                        onClick={() => setEditRegions(prev =>
                          active ? prev.filter(s => s !== opt.slug) : [...prev, opt.slug]
                        )}
                        className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                          active
                            ? 'bg-accent text-white border-accent'
                            : 'bg-surf2 text-muted border-border hover:border-accent/50'
                        }`}
                      >{opt.label}</button>
                    );
                  })}
                </div>
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

              {/* Populations + Domains + Geo — read view */}
              {(() => {
                const p = profile as Record<string, unknown>;
                const pops = (p.populations as string[]) || [];
                const doms = (p.domains as string[]) || [];
                const regs = (p.regions as string[]) || [];
                const allTags = [
                  ...pops.map(s => POPULATION_OPTIONS.find(o => o.slug === s)?.label || s),
                  ...doms.map(s => DOMAIN_OPTIONS.find(o => o.slug === s)?.label || s),
                  ...regs.map(s => GEO_OPTIONS.find(o => o.slug === s)?.label || s),
                ];
                if (allTags.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {allTags.map((tag, i) => (
                      <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 text-[10px] rounded-full">{tag}</span>
                    ))}
                  </div>
                );
              })()}
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

        {/* Google Drive OAuth connect button */}
        <a
          href="/api/drive/auth"
          className="flex items-center justify-center gap-2 w-full py-1.5 text-[11px] font-medium border border-border rounded-lg hover:bg-surface transition-colors text-muted"
        >
          <svg width="14" height="14" viewBox="0 0 87.3 78" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L28.6 51H0c0 1.55.4 3.1 1.2 4.5L6.6 66.85z" fill="#0066DA"/>
            <path d="M43.65 25L28.6 51H58.7L43.65 25z" fill="#00AC47"/>
            <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H58.7L73.55 76.8z" fill="#EA4335"/>
            <path d="M43.65 25L58.7 51l14.85-25.65A9.3 9.3 0 0070.2 21H17.1c-1.4 0-2.7.35-3.85.95L28.6 51 43.65 25z" fill="#00832D"/>
            <path d="M73.55 76.8L58.7 51H28.6L13.75 76.8c1.15.6 2.45.95 3.85.95H69.7c1.4 0 2.7-.35 3.85-.95z" fill="#2684FC"/>
            <path d="M71.45 24.35l-3.6-6.25a9.5 9.5 0 00-3.3-3.3l-3.6-6.25C59.15 7.1 57.5 6.5 55.8 6.5H31.5c-1.7 0-3.35.6-4.65 1.75l-3.6 6.25a9.5 9.5 0 00-3.3 3.3l-3.6 6.25c-.8 1.4-1.2 2.95-1.2 4.5h57.5c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
          </svg>
          חבר Google Drive (גישה לתיקיות פרטיות)
        </a>

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
          feedback.startsWith('⚠️') ? (
            <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800 leading-snug">
              {feedback}
            </div>
          ) : feedback.startsWith('✅') ? (
            <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[12px] font-medium text-green-800 leading-snug">
              {feedback}
            </div>
          ) : (
            <p className={`text-[11px] leading-relaxed ${feedback.includes('שגיאה') || feedback.includes('נכשל') ? 'text-red-500' : 'text-green-600'}`}>
              {feedback}
            </p>
          )
        )}
      </div>

      {/* ===== BLOCK 2.5: Document Readiness Card ===== */}
      {documents.length > 0 && (
        <div className="rounded-xl border border-border bg-surf p-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold">מסמכים להגשה</h4>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              missingDocs.length === 0 ? 'bg-green-100 text-green-700' :
              missingDocs.length <= 2 ? 'bg-amber-100 text-amber-700' :
              'bg-red-100 text-red-600'
            }`}>
              {missingDocs.length === 0 ? 'הכל מוכן' : `חסרים ${missingDocs.length}`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {REQUIRED_DOCS.map((req) => {
              const byPattern = docSearchStrings.some(t => req.pattern.test(t));
              const byCategory = req.hint
                ? documents.some(d => d.category === req.hint || (d.category === 'identity' && req.hint === 'official'))
                : false;
              const exists = byPattern || byCategory;
              return (
                <div key={req.label} className={`flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg ${
                  exists ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                }`}>
                  <span className="flex-shrink-0">{exists ? '✓' : '✗'}</span>
                  <span className="truncate">{req.label}</span>
                </div>
              );
            })}
          </div>
          {missingDocs.length > 0 && (
            <p className="text-[10px] text-muted mt-2 leading-relaxed">
              מסמכים חסרים עלולים לעצור הגשה. העלי אותם דרך "הוספת מסמך" למטה.
            </p>
          )}
        </div>
      )}

      {/* ===== VAULT: תיק מסמכים רשמיים ===== */}
      {vaultData && (
        <div className="rounded-xl border border-border bg-surf p-3">
          <button
            onClick={() => setShowVault(v => !v)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <h4 className="text-xs font-semibold">תיק מסמכים רשמיים</h4>
            </div>
            <div className="flex items-center gap-2">
              {/* Score pill */}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                vaultData.vault_score >= 70 ? 'bg-green-100 text-green-700' :
                vaultData.vault_score >= 40 ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-600'
              }`}>
                {vaultData.total_covered}/{vaultData.total_required} מסמכים
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-muted transition-transform ${showVault ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>

          {showVault && (
            <div className="mt-3 space-y-1.5">
              {/* Expiring soon */}
              {vaultData.expiring.length > 0 && (
                <div className="mb-2">
                  <div className="text-[10px] font-semibold text-amber-700 mb-1">עומדים לפוג / פגי תוקף</div>
                  {vaultData.expiring.map(doc => (
                    <div key={doc.id} className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-lg ${doc.is_expired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                      <span>{doc.is_expired ? '✗' : '⚠'}</span>
                      <span className="flex-1 truncate">{doc.filename}</span>
                      {doc.expiry_date && (
                        <span className="text-[9px] opacity-70">{new Date(doc.expiry_date).toLocaleDateString('he-IL')}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Missing docs */}
              {vaultData.missing.length > 0 ? (
                <>
                  <div className="text-[10px] font-semibold text-text mb-1">מסמכים חסרים</div>
                  {vaultData.missing.map(doc => (
                    <div key={doc.key} className="flex items-start gap-2 px-2 py-1.5 rounded-lg bg-gray-50 border border-border/50">
                      <span className="text-[12px] text-gray-400 mt-0.5">○</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-medium text-text">{doc.label}</div>
                        <div className="text-[9px] text-muted mt-0.5">{doc.hint}</div>
                        {doc.ttl_months && (
                          <div className="text-[9px] text-muted2">מתחדש כל {doc.ttl_months} חודשים</div>
                        )}
                      </div>
                    </div>
                  ))}
                  <p className="text-[9px] text-muted mt-1.5">
                    העלי את המסמכים החסרים דרך כפתור "הוספת מסמך" למטה
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-[11px] text-green-700 bg-green-50 rounded-lg px-3 py-2">
                  <span>✓</span>
                  <span className="font-medium">כל מסמכי התשתית הרשמיים קיימים במערכת</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
              const badgeKey = getDocBadgeKey(doc);
              const badge = CATEGORY_BADGES[badgeKey] || CATEGORY_BADGES.other;
              const isEditing = editingDocId === doc.id;
              return (
                <div key={doc.id} className="flex items-center gap-1.5 py-1.5 px-2 rounded-lg hover:bg-surf2 transition-colors text-xs group relative">
                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(doc.id, doc.filename)}
                    title="מחיקה"
                    className="p-1 text-muted2 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
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
                  {/* Category badge — click to change */}
                  <button
                    onClick={() => setEditingDocId(isEditing ? null : doc.id)}
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 cursor-pointer hover:ring-1 hover:ring-accent/30 ${badge.color}`}
                    title="שנה קטגוריה"
                  >
                    {badge.label}
                  </button>
                  {/* Category dropdown */}
                  {isEditing && (
                    <div className="absolute left-0 top-full mt-0.5 z-20 bg-surf border border-border rounded-lg shadow-lg p-1 min-w-[100px]">
                      {Object.entries(CATEGORY_BADGES)
                        .filter(([k]) => k !== 'official' && k !== badgeKey && k !== (doc.category || 'other'))
                        .map(([key, val]) => (
                          <button
                            key={key}
                            onClick={() => handleCategoryChange(doc.id, key === 'official' ? 'identity' : key)}
                            className="w-full text-right px-2 py-1 text-[10px] rounded hover:bg-surf2 transition-colors"
                          >
                            <span className={`inline-block px-1.5 py-0.5 rounded-full ${val.color}`}>{val.label}</span>
                          </button>
                        ))}
                    </div>
                  )}
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

    </div>
  );
}
