import { z } from 'zod';

// ─── Company ──────────────────────────────────────────────────────────────────

export const CompanySchema = z.object({
  name: z.string().min(2, 'שם חברה חייב להכיל לפחות 2 תווים'),
  type: z.enum(['business', 'fund', 'public'], {
    errorMap: () => ({ message: 'סוג חברה חייב להיות: business, fund או public' }),
  }),
  description: z.string().min(50, 'תיאור חייב להכיל לפחות 50 תווים'),
  website: z.string().url('כתובת אתר לא תקינה').optional().nullable(),
  email: z.string().email('כתובת מייל לא תקינה').optional().nullable(),
  phone: z.string().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
});

export type CompanyInput = z.infer<typeof CompanySchema>;

// ─── Grant Opportunity ────────────────────────────────────────────────────────

export const GrantOpportunitySchema = z.object({
  title: z.string().min(5, 'כותרת קול קורא חייבת להכיל לפחות 5 תווים'),
  funder_name: z.string().min(1, 'שם גוף מממן הוא שדה חובה'),
  deadline: z.string().nullable(),
  amount_min: z.number().nullable(),
  amount_max: z.number().nullable(),
  description: z.string().optional().nullable(),
  source_url: z.string().url('כתובת URL לא תקינה').optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
});

export type GrantOpportunityInput = z.infer<typeof GrantOpportunitySchema>;

// ─── Document ─────────────────────────────────────────────────────────────────

export const DocumentSchema = z.object({
  file_name: z.string().min(1, 'שם קובץ הוא שדה חובה'),
  file_type: z.enum(['pdf', 'docx', 'xlsx', 'url'], {
    errorMap: () => ({ message: 'סוג קובץ חייב להיות: pdf, docx, xlsx או url' }),
  }),
  organization_id: z.string().uuid('מזהה ארגון לא תקין'),
});

export type DocumentInput = z.infer<typeof DocumentSchema>;
