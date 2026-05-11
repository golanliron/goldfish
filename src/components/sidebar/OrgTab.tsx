'use client';

import { useEffect, useState, useRef } from 'react';
import type { AppStage, OrgProfileData, Document as FgDoc } from '@/types';

interface OrgTabProps {
  stage: AppStage;
  orgId: string | null;
}

// ===== Document Knowledge Categories =====
// Each category tells Goldfish what kind of knowledge it has about the org

interface DocCategory {
  key: string;
  label: string;
  icon: React.ReactNode;
  examples: string;
  whyNeeded: string;
}

const DOC_CATEGORIES: DocCategory[] = [
  {
    key: 'identity',
    label: 'היכרות עמותה',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    examples: 'תקנון, מצגת היכרות, חזון ומשימה',
    whyNeeded: 'Goldfish צריך להכיר את העמותה כדי לכתוב על מי אתם',
  },
  {
    key: 'programs',
    label: 'תוכניות עמותה',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    examples: 'תיאורי תוכניות, מודל הפעלה, קהלי יעד',
    whyNeeded: 'בלי זה Goldfish לא יודע מה העמותה עושה בפועל',
  },
  {
    key: 'budget',
    label: 'תקציב עמותה',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
    examples: 'דוח כספי שנתי, מאזן, תקציב מאושר',
    whyNeeded: 'קרנות דורשות נתונים כספיים. בלי זה אין הגשה',
  },
  {
    key: 'project_budget',
    label: 'תקציב פרויקט',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    examples: 'פירוט תקציבי לפרויקט, הצעת מחיר, עלויות',
    whyNeeded: 'כל הגשה צריכה טבלת תקציב מפורטת',
  },
  {
    key: 'impact',
    label: 'אימפקט ארגון',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    examples: 'דוח אימפקט, סקרים, מדדי הצלחה, עדויות',
    whyNeeded: 'הנתונים שמראים שמה שאתם עושים עובד',
  },
  {
    key: 'submission',
    label: 'הגשות קודמות',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    examples: 'בקשות מענק שהגשתם, מכתבי בקשה, דוחות לקרנות',
    whyNeeded: 'Goldfish לומד מההגשות שלכם ומהטעויות שלכם. לא בטוח שכתבתם טוב עד עכשיו?',
  },
];

export default function OrgTab({ stage, orgId }: OrgTabProps) {
  const [profile, setProfile] = useState<OrgProfileData | null>(null);
  const [documents, setDocuments] = useState<FgDoc[]>([]);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<OrgProfileData>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [expandedMission, setExpandedMission] = useState(false);
  const [textSaved, setTextSaved] = useState<string | null>(null);
  const [driveUrl, setDriveUrl] = useState('');
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [loadingLink, setLoadingLink] = useState(false);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = () => {
    if (!orgId) return;
    fetch(`/api/org?org_id=${orgId}`)
      .then(r => r.json())
      .then(({ profile: p, documents: d }) => {
        if (p) setProfile(p as OrgProfileData);
        if (d) setDocuments(d as FgDoc[]);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, [orgId]);

  // Upload handler with category
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    if (!orgId) {
      alert('טוען נתוני ארגון... נסו שוב בעוד שנייה');
      return;
    }
    setUploading(true);

    const fileArr = Array.from(files);
    const results = await Promise.allSettled(
      fileArr.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('org_id', orgId);
        if (uploadCategory) formData.append('category', uploadCategory);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'שגיאה' }));
          throw new Error(data.error || 'שגיאה בהעלאה');
        }
        return res.json();
      })
    );
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const lastError = results.find(r => r.status === 'rejected')
      ? (results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason?.message || 'שגיאה'
      : '';

    e.target.value = '';
    setUploading(false);
    setUploadCategory(null);
    loadData();
    if (lastError && successCount === 0) {
      alert(lastError);
    } else if (successCount > 0) {
      setTextSaved(`${successCount} קבצים נקראו ונשמרו`);
    }
  };

  const triggerUpload = (categoryKey: string) => {
    setUploadCategory(categoryKey);
    fileInputRef.current?.click();
  };

  // Download document
  const handleDownload = (doc: FgDoc) => {
    // If it's a URL type, open the URL
    if (doc.file_type === 'url' && doc.storage_path?.startsWith('http')) {
      window.open(doc.storage_path, '_blank');
      return;
    }
    // If it's a text file (free text input), download parsed text
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
    // Otherwise try storage download
    if (doc.storage_path) {
      window.open(`/api/documents/${doc.id}/download`, '_blank');
    }
  };

  // Delete document
  const handleDelete = async (docId: string) => {
    if (!orgId) return;
    if (!confirm('למחוק את המסמך? Goldfish ישכח את מה שלמד ממנו.')) return;

    try {
      await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      });
      loadData();
    } catch {
      // ignore
    }
  };

  // Save profile edits
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
  };

  // Group documents by category
  const docsByCategory = documents.reduce<Record<string, FgDoc[]>>((acc, doc) => {
    let cat = doc.category || 'other';
    // Map DB categories to display categories
    if (cat === 'project') cat = 'programs';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(doc);
    return acc;
  }, {});

  // Calculate completeness — honest assessment of what Goldfish actually knows
  const filledCategories = DOC_CATEGORIES.filter(c => (docsByCategory[c.key]?.length || 0) > 0);

  // 18-point knowledge assessment — each checkpoint is something Goldfish needs to write quality submissions
  interface KnowledgeCheck {
    id: string;
    label: string;
    met: boolean;
    weight: number; // 1 = nice to have, 2 = important, 3 = critical
  }

  const checks: KnowledgeCheck[] = [
    // Document categories (6 checks, weight 2 each = 12 pts)
    { id: 'doc_identity', label: 'מסמכי היכרות (תקנון, מצגת, חזון)', met: !!(docsByCategory['identity']?.length), weight: 2 },
    { id: 'doc_programs', label: 'תיאורי תוכניות ומודל הפעלה', met: !!(docsByCategory['programs']?.length), weight: 2 },
    { id: 'doc_budget', label: 'דוח כספי שנתי / מאזן', met: !!(docsByCategory['budget']?.length), weight: 2 },
    { id: 'doc_project_budget', label: 'תקציב פרויקט מפורט', met: !!(docsByCategory['project_budget']?.length), weight: 2 },
    { id: 'doc_impact', label: 'דוח אימפקט / מדדי הצלחה', met: !!(docsByCategory['impact']?.length), weight: 2 },
    { id: 'doc_submission', label: 'הגשות קודמות לקרנות', met: !!(docsByCategory['submission']?.length), weight: 2 },
    // Profile fields (8 checks, mixed weights = 14 pts)
    { id: 'prof_mission', label: 'מטרת הארגון (משפט ברור)', met: !!(profile?.mission && profile.mission.length > 20), weight: 2 },
    { id: 'prof_budget', label: 'מחזור שנתי', met: !!(profile?.annual_budget && profile.annual_budget > 0), weight: 2 },
    { id: 'prof_beneficiaries', label: 'מספר מוטבים', met: !!(profile?.beneficiaries_count && profile.beneficiaries_count > 0), weight: 2 },
    { id: 'prof_focus', label: 'תחומי פעילות', met: !!(profile?.focus_areas && profile.focus_areas.length > 0), weight: 1 },
    { id: 'prof_reg', label: 'מספר עמותה (ע.ר.)', met: !!profile?.registration_number, weight: 1 },
    { id: 'prof_regions', label: 'אזורי פעילות', met: !!(profile?.regions && profile.regions.length > 0), weight: 1 },
    { id: 'prof_employees', label: 'מספר עובדים', met: !!(profile?.employees_count && profile.employees_count > 0), weight: 1 },
    { id: 'prof_website', label: 'אתר הארגון', met: !!(profile && (profile as Record<string, unknown>).website), weight: 2 },
    // Depth checks — quality, not just presence (4 checks = 8 pts)
    { id: 'depth_docs_3plus', label: 'לפחות 3 מסמכים שונים', met: documents.length >= 3, weight: 2 },
    { id: 'depth_docs_5plus', label: 'לפחות 5 מסמכים (כיסוי רחב)', met: documents.length >= 5, weight: 2 },
    { id: 'depth_categories_3', label: 'מסמכים מ-3 קטגוריות לפחות', met: filledCategories.length >= 3, weight: 2 },
    { id: 'depth_mission_rich', label: 'תיאור מטרה מעמיק (50+ תווים)', met: !!(profile?.mission && profile.mission.length > 50), weight: 2 },
  ];

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0); // 30
  const earnedWeight = checks.filter(c => c.met).reduce((sum, c) => sum + c.weight, 0);
  const completeness = Math.round((earnedWeight / totalWeight) * 100);

  // Build missing items list (sorted by weight desc)
  const missingChecks = checks
    .filter(c => !c.met)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4); // Show top 4 missing items

  // ===== Document Alerts: expiry + required docs =====
  interface DocAlert {
    type: 'expired' | 'expiring' | 'missing';
    label: string;
    detail: string;
  }

  const docAlerts: DocAlert[] = [];
  const now = new Date();

  // Check for expired / expiring documents
  documents.forEach(doc => {
    const meta = (doc.metadata || {}) as Record<string, unknown>;
    const validUntil = meta.valid_until as string | undefined;
    if (validUntil) {
      const expDate = new Date(validUntil);
      const daysLeft = Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const docType = (meta.doc_type as string) || doc.filename;
      if (daysLeft < 0) {
        docAlerts.push({ type: 'expired', label: docType, detail: `פג תוקף ב-${validUntil}` });
      } else if (daysLeft < 90) {
        docAlerts.push({ type: 'expiring', label: docType, detail: `פג בעוד ${daysLeft} ימים` });
      }
    }
  });

  // Check for required documents that are missing
  const REQUIRED_DOCS = [
    { pattern: /ניהול תקין/i, label: 'אישור ניהול תקין' },
    { pattern: /סעיף 46|saif.?46/i, label: 'אישור סעיף 46' },
    { pattern: /ניכוי מס/i, label: 'אישור ניכוי מס' },
    { pattern: /רישום עמותה|תעודת רישום/i, label: 'תעודת רישום עמותה' },
    { pattern: /דוח כספי|כספי.*מבוקר/i, label: 'דוח כספי מבוקר' },
    { pattern: /תקציב.*מאושר|מאושר.*תקציב/i, label: 'תקציב מאושר' },
    { pattern: /מילולי|דוח פעילות/i, label: 'דוח מילולי / דוח פעילות' },
    { pattern: /ניהול ספרים/i, label: 'אישור ניהול ספרים' },
  ];

  const docTexts = documents.map(d => {
    const meta = (d.metadata || {}) as Record<string, unknown>;
    return `${d.filename} ${(meta.doc_type as string) || ''} ${(meta.summary as string) || ''}`;
  });

  REQUIRED_DOCS.forEach(req => {
    const found = docTexts.some(t => req.pattern.test(t));
    if (!found) {
      docAlerts.push({ type: 'missing', label: req.label, detail: 'נדרש להגשות' });
    }
  });

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md,.csv,.html,.pptx" onChange={handleUpload} />

      {/* Org identity card */}
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
                  <input
                    type="number"
                    defaultValue={profile.annual_budget || ''}
                    onChange={e => setEditData(d => ({ ...d, annual_budget: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs"
                  />
                </div>
                <div>
                  <label className="text-muted text-[10px]">מוטבים</label>
                  <input
                    type="number"
                    defaultValue={profile.beneficiaries_count || ''}
                    onChange={e => setEditData(d => ({ ...d, beneficiaries_count: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="text-muted text-[10px]">ע.ר.</label>
                <input
                  type="text"
                  defaultValue={profile.registration_number || ''}
                  onChange={e => setEditData(d => ({ ...d, registration_number: e.target.value }))}
                  className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs"
                />
              </div>
              <div className="pt-1 border-t border-border/30">
                <p className="text-[10px] text-muted font-semibold mb-1">איש קשר</p>
                <div className="space-y-1.5">
                  <div>
                    <label className="text-muted text-[10px]">שם איש קשר</label>
                    <input
                      type="text"
                      defaultValue={(profile as Record<string, unknown>).contact_name as string || ''}
                      onChange={e => setEditData(d => ({ ...d, contact_name: e.target.value }))}
                      className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs"
                      placeholder="שם מלא"
                    />
                  </div>
                  <div>
                    <label className="text-muted text-[10px]">מייל</label>
                    <input
                      type="email"
                      defaultValue={(profile as Record<string, unknown>).contact_email as string || ''}
                      onChange={e => setEditData(d => ({ ...d, contact_email: e.target.value }))}
                      className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs"
                      dir="ltr"
                      placeholder="email@org.co.il"
                    />
                  </div>
                  <div>
                    <label className="text-muted text-[10px]">טלפון</label>
                    <input
                      type="tel"
                      defaultValue={(profile as Record<string, unknown>).contact_phone as string || ''}
                      onChange={e => setEditData(d => ({ ...d, contact_phone: e.target.value }))}
                      className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs"
                      dir="ltr"
                      placeholder="050-000-0000"
                    />
                  </div>
                  <div>
                    <label className="text-muted text-[10px]">אתר</label>
                    <input
                      type="url"
                      defaultValue={(profile as Record<string, unknown>).website as string || ''}
                      onChange={e => setEditData(d => ({ ...d, website: e.target.value }))}
                      className="w-full px-2 py-1 border border-border rounded-md bg-surf2 focus:border-accent focus:outline-none text-xs"
                      dir="ltr"
                      placeholder="https://www.org.co.il"
                    />
                  </div>
                </div>
              </div>
              <button
                onClick={() => { setEditing(false); setEditData({}); }}
                className="text-[10px] text-muted hover:text-text"
              >
                ביטול
              </button>
            </div>
          ) : (
            <>
              {profile.registration_number && (
                <p className="text-xs text-muted">ע.ר. {profile.registration_number}</p>
              )}
              {profile.mission && (
                <div className="mt-2">
                  <p className={`text-xs text-text2 leading-relaxed ${expandedMission ? '' : 'line-clamp-4'}`}>{profile.mission}</p>
                  {profile.mission.length > 200 && (
                    <button onClick={() => setExpandedMission(v => !v)} className="text-[10px] text-accent hover:underline mt-0.5">
                      {expandedMission ? 'הצג פחות' : 'הצג עוד...'}
                    </button>
                  )}
                </div>
              )}

              {/* Contact info */}
              {((profile as Record<string, unknown>).contact_name || (profile as Record<string, unknown>).contact_email || (profile as Record<string, unknown>).contact_phone) && (
                <div className="mt-3 pt-2 border-t border-border/30 space-y-1">
                  {!!(profile as Record<string, unknown>).contact_name && (
                    <div className="flex items-center gap-1.5 text-[11px] text-text2">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2 flex-shrink-0"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {String((profile as Record<string, unknown>).contact_name)}
                    </div>
                  )}
                  {!!(profile as Record<string, unknown>).contact_email && (
                    <div className="flex items-center gap-1.5 text-[11px] text-text2">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2 flex-shrink-0"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                      <a href={`mailto:${(profile as Record<string, unknown>).contact_email}`} className="hover:text-accent transition-colors" dir="ltr">{String((profile as Record<string, unknown>).contact_email)}</a>
                    </div>
                  )}
                  {!!(profile as Record<string, unknown>).contact_phone && (
                    <div className="flex items-center gap-1.5 text-[11px] text-text2">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2 flex-shrink-0"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                      <a href={`tel:${(profile as Record<string, unknown>).contact_phone}`} className="hover:text-accent transition-colors" dir="ltr">{String((profile as Record<string, unknown>).contact_phone)}</a>
                    </div>
                  )}
                </div>
              )}

              {/* Key numbers */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                {profile.annual_budget && (
                  <div className="bg-surf2 rounded-lg p-2 text-center">
                    <div className="text-sm font-semibold text-accent">
                      {(profile.annual_budget / 1000).toFixed(0)}K
                    </div>
                    <div className="text-[10px] text-muted">מחזור שנתי</div>
                  </div>
                )}
                {profile.beneficiaries_count && (
                  <div className="bg-surf2 rounded-lg p-2 text-center">
                    <div className="text-sm font-semibold text-accent">
                      {profile.beneficiaries_count.toLocaleString('he-IL')}
                    </div>
                    <div className="text-[10px] text-muted">מוטבים</div>
                  </div>
                )}
                {profile.employees_count && (
                  <div className="bg-surf2 rounded-lg p-2 text-center">
                    <div className="text-sm font-semibold text-accent">{profile.employees_count}</div>
                    <div className="text-[10px] text-muted">עובדים</div>
                  </div>
                )}
              </div>

              {/* Focus areas */}
              {profile.focus_areas && profile.focus_areas.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {profile.focus_areas.map((area, i) => (
                    <span key={i} className="px-2 py-0.5 bg-accent-light text-accent text-[10px] rounded-full font-medium">
                      {area}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Knowledge completeness bar */}
      <div className="bg-surf rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold">מה Goldfish יודע עליכם</h4>
          <span className={`text-[11px] font-bold ${
            completeness >= 90 ? 'text-green-600' : completeness >= 60 ? 'text-amber-600' : 'text-red-500'
          }`}>
            {completeness}%
          </span>
        </div>
        <div className="h-1.5 bg-surf2 rounded-full overflow-hidden mb-2">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${completeness}%`,
              background: completeness >= 90 ? '#22C55E' : completeness >= 60 ? '#F59E0B' : '#EF4444',
            }}
          />
        </div>
        <p className="text-[10px] text-muted2">
          {completeness >= 90
            ? 'מצוין! Goldfish מכיר את הארגון לעומק ויכתוב הגשות מדויקות.'
            : completeness >= 60
            ? 'Goldfish מכיר אתכם חלקית. עוד חומרים וההגשות יהיו מדויקות יותר.'
            : completeness >= 30
            ? 'Goldfish צריך עוד חומר. בלי מסמכים מספיקים ההגשות לא יהיו טובות.'
            : 'העלו מסמכים ומלאו פרטי פרופיל כדי ש-Goldfish יכיר את הארגון.'}
        </p>
        {/* Show what's missing — always, unless 90%+ */}
        {missingChecks.length > 0 && completeness < 90 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <p className="text-[10px] font-semibold text-red-500 mb-1">חסר לי:</p>
            <ul className="space-y-0.5">
              {missingChecks.map(check => (
                <li key={check.id} className="text-[10px] text-muted flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${check.weight >= 2 ? 'bg-red-400' : 'bg-amber-400'}`} />
                  {check.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Document alerts — expired, expiring, missing */}
      {docAlerts.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-900 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500 flex-shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h4 className="text-[11px] font-bold text-red-600 dark:text-red-400">התראות מסמכים</h4>
            <span className="text-[10px] text-red-400 mr-auto">{docAlerts.length}</span>
          </div>
          <ul className="space-y-1">
            {docAlerts.map((alert, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[10px]">
                <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                  alert.type === 'expired' ? 'bg-red-500' :
                  alert.type === 'expiring' ? 'bg-amber-500' : 'bg-gray-400'
                }`} />
                <div>
                  <span className={`font-medium ${
                    alert.type === 'expired' ? 'text-red-600 dark:text-red-400' :
                    alert.type === 'expiring' ? 'text-amber-600 dark:text-amber-400' : 'text-muted'
                  }`}>
                    {alert.type === 'expired' ? '⏰ ' : alert.type === 'expiring' ? '⚠️ ' : '📋 '}
                    {alert.label}
                  </span>
                  <span className="text-muted2 mr-1">— {alert.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick text description */}
      <div className="rounded-xl border border-border bg-surf p-3">
        <div className="flex items-center gap-2 mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent flex-shrink-0">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <h4 className="text-xs font-semibold">ספרו על הארגון בטקסט חופשי</h4>
        </div>
        <p className="text-[10px] text-muted2 mb-2">
          הדביקו תיאור, העתיקו מהאתר, או פשוט כתבו. Goldfish ילמד מזה.
        </p>
        <textarea
          value={freeText}
          onChange={e => setFreeText(e.target.value)}
          placeholder="לדוגמה: אנחנו עמותה שעוסקת בחינוך לנוער בסיכון בפריפריה, פועלים ב-5 ערים, 200 מוטבים..."
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-bg resize-none focus:border-accent focus:outline-none placeholder:text-muted2"
          rows={3}
          dir="rtl"
        />
        {freeText.trim().length > 0 && (
          <button
            onClick={async () => {
              if (!orgId || !freeText.trim()) return;
              setSavingText(true);
              setTextSaved(null);
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
                setTextSaved(data.summary || 'Goldfish קרא ולמד את התוכן');
                loadData();
              } catch {
                setTextSaved('שגיאה בשמירה, נסו שוב');
              }
              setSavingText(false);
            }}
            disabled={savingText}
            className="mt-2 w-full py-1.5 text-[11px] font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {savingText ? 'שומר...' : 'שמור. Goldfish ילמד את זה'}
          </button>
        )}
        {textSaved && (
          <p className={`text-[11px] mt-2 leading-relaxed ${textSaved.includes('שגיאה') ? 'text-red-500' : 'text-green-600'}`}>
            {textSaved}
          </p>
        )}
      </div>

      {/* Add link to learn from */}
      <div className="rounded-xl border border-border bg-surf p-3">
        <div className="flex items-center gap-2 mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent flex-shrink-0">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
          <h4 className="text-xs font-semibold">הוסיפו קישור לאתר הארגון</h4>
        </div>
        <p className="text-[10px] text-muted2 mb-2">
          הדביקו קישור לאתר העמותה, דף אודות, או כל דף רלוונטי. Goldfish יקרא וישמור.
        </p>
        <div className="flex gap-1.5">
          <input
            type="url"
            value={linkUrl}
            onChange={e => { setLinkUrl(e.target.value); setLinkStatus(null); }}
            placeholder="https://www.example.org.il/about"
            className="flex-1 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-bg focus:border-accent focus:outline-none"
            dir="ltr"
          />
          <button
            onClick={async () => {
              if (!orgId || !linkUrl.trim()) return;
              setLoadingLink(true);
              setLinkStatus(null);
              try {
                const res = await fetch('/api/learn-url', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ org_id: orgId, url: linkUrl.trim() }),
                });
                const data = await res.json();
                if (res.ok) {
                  setLinkStatus(`Goldfish למד מ-"${data.title || linkUrl}"`);
                  setLinkUrl('');
                  loadData();
                } else {
                  setLinkStatus(data.error || 'שגיאה בקריאת הקישור');
                }
              } catch {
                setLinkStatus('שגיאה בקריאת הקישור');
              }
              setLoadingLink(false);
            }}
            disabled={loadingLink || !linkUrl.trim()}
            className="px-3 py-1.5 text-[11px] font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {loadingLink ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : 'קרא'}
          </button>
        </div>
        {linkStatus && (
          <p className={`text-[10px] mt-1.5 ${linkStatus.startsWith('שגיאה') ? 'text-red-500' : 'text-accent'}`}>{linkStatus}</p>
        )}
      </div>

      {/* Google Drive link */}
      <div className="rounded-xl border border-dashed border-border bg-bg p-3">
        <div className="flex items-center gap-2 mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
            <path d="M7.71 3.5L1.15 15l3.43 6h6.56" stroke="#4285F4" strokeWidth="1.5" />
            <path d="M16.29 3.5H7.71l5.15 9h8.57" stroke="#0F9D58" strokeWidth="1.5" />
            <path d="M21.43 12.5l-3.43 6H5.14l3.43-6" stroke="#F4B400" strokeWidth="1.5" />
          </svg>
          <h4 className="text-xs font-semibold">חיבור Google Drive</h4>
        </div>
        <p className="text-[10px] text-muted2 mb-2">
          הדביקו קישור לתיקיית Drive משותפת. Goldfish יקרא את המסמכים משם.
        </p>
        <div className="flex gap-1.5">
          <input
            type="url"
            value={driveUrl}
            onChange={e => setDriveUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            className="flex-1 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surf focus:border-accent focus:outline-none"
            dir="ltr"
          />
          <button
            onClick={async () => {
              if (!orgId || !driveUrl.trim()) return;
              setConnectingDrive(true);
              try {
                const res = await fetch('/api/drive/connect', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ org_id: orgId, drive_url: driveUrl.trim() }),
                });
                const data = await res.json();
                if (res.ok) {
                  setDriveStatus(data.message || 'Drive חובר בהצלחה');
                  setDriveUrl('');
                  loadData();
                } else {
                  setDriveStatus(data.error || 'שגיאה בחיבור');
                }
              } catch {
                setDriveStatus('שגיאה בחיבור ל-Drive');
              }
              setConnectingDrive(false);
            }}
            disabled={connectingDrive || !driveUrl.trim()}
            className="px-3 py-1.5 text-[11px] font-medium bg-surf2 border border-border rounded-lg hover:border-accent/30 transition-colors disabled:opacity-50"
          >
            {connectingDrive ? '...' : 'חבר'}
          </button>
        </div>
        {driveStatus && (
          <p className="text-[10px] text-accent mt-1.5">{driveStatus}</p>
        )}
      </div>

      {/* Recommended official documents */}
      <div className="rounded-xl border border-amber-300/50 bg-amber-50/30 dark:bg-amber-900/10 p-3">
        <div className="flex items-center gap-2 mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600 flex-shrink-0">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <h4 className="text-xs font-semibold text-amber-800 dark:text-amber-400">מסמכים רשמיים מומלצים</h4>
        </div>
        <p className="text-[10px] text-muted2 mb-2">
          העלו את המסמכים האלה כדי ש-Goldfish יוכל לצרף אותם להגשות ולמסור לקרנות כשיבקשו.
        </p>
        <div className="space-y-1">
          {[
            { name: 'אישור סעיף 46 (פטור ממס)', key: 'section46', icon: '📋' },
            { name: 'אישור ניהול תקין', key: 'proper_mgmt', icon: '✅' },
            { name: 'אישור ניכוי מס במקור', key: 'tax_deduction', icon: '🧾' },
            { name: 'תעודת רישום עמותה', key: 'registration', icon: '📄' },
            { name: 'דוח כספי מבוקר אחרון', key: 'audited_report', icon: '📊' },
            { name: 'פרוטוקול ועד מנהל', key: 'board_protocol', icon: '📝' },
          ].map(item => {
            const hasDoc = documents.some(d =>
              d.filename?.toLowerCase().includes(item.key.replace(/_/g, ' ')) ||
              d.filename?.includes(item.name.split('(')[0].trim()) ||
              (d.category === 'budget' && item.key === 'audited_report') ||
              (d.parsed_text && item.key === 'section46' && /סעיף 46/.test(d.parsed_text)) ||
              (d.parsed_text && item.key === 'proper_mgmt' && /ניהול תקין/.test(d.parsed_text))
            );
            return (
              <div key={item.key} className="flex items-center gap-2 text-[11px]">
                <span className={`w-4 text-center ${hasDoc ? '' : 'grayscale opacity-50'}`}>{item.icon}</span>
                <span className={`flex-1 ${hasDoc ? 'text-text' : 'text-muted'}`}>{item.name}</span>
                {hasDoc ? (
                  <span className="text-[9px] text-green-600 font-medium">✓ יש</span>
                ) : (
                  <button
                    onClick={() => triggerUpload('identity')}
                    className="text-[9px] text-accent hover:underline"
                  >
                    העלו
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Bulk upload */}
        <div className="mt-3 pt-3 border-t border-amber-200/50">
          <button
            onClick={() => triggerUpload('identity')}
            disabled={uploading}
            className="w-full py-2 text-[11px] font-medium border-2 border-dashed border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-50"
          >
            {uploading ? 'מעלה...' : 'העלו כמה קבצים יחד'}
          </button>
          <p className="text-[9px] text-muted2 mt-1 text-center">PDF, Word, Excel, PPT — ניתן לבחור כמה קבצים בבת אחת</p>
        </div>
      </div>

      {/* Document categories */}
      {DOC_CATEGORIES.map(cat => {
        const docs = docsByCategory[cat.key] || [];
        const isEmpty = docs.length === 0;

        return (
          <div
            key={cat.key}
            className={`rounded-xl border p-3 transition-colors ${
              isEmpty ? 'border-dashed border-border bg-bg' : 'border-border bg-surf'
            }`}
          >
            {/* Category header */}
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`flex-shrink-0 ${isEmpty ? 'text-muted2' : 'text-accent'}`}>
                {cat.icon}
              </div>
              <h4 className={`text-xs font-semibold flex-1 ${isEmpty ? 'text-muted' : 'text-text'}`}>
                {cat.label}
              </h4>
              {!isEmpty && (
                <span className="text-[10px] text-muted2 bg-surf2 px-1.5 py-0.5 rounded-md">
                  {docs.length}
                </span>
              )}
              <button
                onClick={() => triggerUpload(cat.key)}
                disabled={uploading}
                className="text-[10px] text-accent hover:underline flex-shrink-0 disabled:opacity-50"
              >
                {uploading && uploadCategory === cat.key ? (
                  <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                )}
              </button>
            </div>

            {isEmpty ? (
              /* Empty state - show what's needed */
              <div className="mr-6">
                <p className="text-[10px] text-muted2 mb-1">{cat.whyNeeded}</p>
                <p className="text-[10px] text-muted2 italic">לדוגמה: {cat.examples}</p>
              </div>
            ) : (
              /* Document list */
              <div className="mr-6 space-y-0.5">
                {docs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-surf2 transition-colors text-xs group">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2 flex-shrink-0">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="truncate text-[11px] flex-1">{doc.filename}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Download/Open */}
                      <button
                        onClick={() => handleDownload(doc)}
                        title="פתיחה"
                        className="p-0.5 text-muted2 hover:text-accent transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(doc.id)}
                        title="הסרה"
                        className="p-0.5 text-muted2 hover:text-red-500 transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Other/uncategorized documents */}
      {docsByCategory['other'] && docsByCategory['other'].length > 0 && (
        <div className="rounded-xl border border-border bg-surf p-3">
          <h4 className="text-xs font-semibold text-muted mb-1.5 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            מסמכים כלליים
            <span className="text-[10px] text-muted2 bg-surf2 px-1.5 py-0.5 rounded-md font-normal">
              {docsByCategory['other'].length}
            </span>
          </h4>
          <div className="mr-6 space-y-0.5">
            {docsByCategory['other'].map(doc => (
              <div key={doc.id} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-surf2 transition-colors text-xs group">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2 flex-shrink-0">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="truncate text-[11px] flex-1">{doc.filename}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleDownload(doc)} title="פתיחה" className="p-0.5 text-muted2 hover:text-accent transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                  <button onClick={() => handleDelete(doc.id)} title="הסרה" className="p-0.5 text-muted2 hover:text-red-500 transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
