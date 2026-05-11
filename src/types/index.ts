// ===== Multi-tenant Core =====

export interface Organization {
  id: string;
  name: string;
  registration_number: string | null;
  domain: string | null;
  plan: 'free' | 'basic' | 'pro' | 'enterprise';
  created_at: string;
}

export interface User {
  id: string;
  org_id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'member';
  created_at: string;
}

// ===== Documents & RAG =====

export type DocumentCategory =
  | 'identity'
  | 'budget'
  | 'project'
  | 'programs'
  | 'grant'
  | 'submission'
  | 'other';

export type FileType = 'pdf' | 'docx' | 'xlsx' | 'url' | 'txt';

export interface Document {
  id: string;
  org_id: string;
  filename: string;
  file_type: FileType;
  storage_path: string;
  category: DocumentCategory;
  parsed_text: string | null;
  metadata: Record<string, unknown>;
  uploaded_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  org_id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  created_at: string;
}

// ===== Organization Profile =====

export interface OrgProfile {
  id: string;
  org_id: string;
  data: OrgProfileData;
  last_updated: string;
}

export interface OrgProfileData {
  name?: string;
  registration_number?: string;
  founded_year?: number;
  mission?: string;
  focus_areas?: string[];
  annual_budget?: number;
  employees_count?: number;
  beneficiaries_count?: number;
  regions?: string[];
  active_projects?: ProjectSummary[];
  existing_grants?: GrantSummary[];
  key_achievements?: string[];
  // Contact info
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  website?: string;
}

export interface ProjectSummary {
  name: string;
  description: string;
  budget?: number;
  beneficiaries?: number;
}

export interface GrantSummary {
  source: string;
  amount: number;
  period: string;
  status: string;
}

// ===== Opportunities (matches real DB schema) =====

export type OpportunityType = 'kok' | 'fund' | 'business' | 'endowment';

export interface Opportunity {
  id: string;
  source: string;
  title: string;
  description: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  open_date: string | null;
  requirements: Record<string, unknown>;
  categories: string[];
  regions: string[];
  target_populations: string[] | null;
  tags: string[] | null;
  type: OpportunityType | null;
  funder: string | null;
  url: string | null;
  eligibility: string | null;
  how_to_apply: string | null;
  contact_info: string | null;
  active: boolean;
  scraped_at: string;
}

// ===== Taxonomy =====

export interface TaxonomyItem {
  id: number;
  type: 'category' | 'population';
  key: string;
  label_he: string;
  label_en: string;
}

// ===== Grant Sources =====

export interface GrantSource {
  id: number;
  name: string;
  url: string;
  layer: 'government' | 'private' | 'international' | 'business' | 'community';
  scan_frequency: string;
  is_active: boolean;
}

// ===== Filters =====

export interface OpportunityFilters {
  categories: string[];
  target_populations: string[];
  type: OpportunityType | null;
  funder: string | null;
  deadlineBefore: string | null;
  search: string;
}

export interface Match {
  id: string;
  org_id: string;
  opportunity_id: string;
  opportunity?: Opportunity;
  score: number;
  reasoning: string;
  status: 'new' | 'viewed' | 'writing' | 'submitted' | 'won' | 'lost';
  notified: boolean;
  created_at: string;
}

// ===== Submissions =====

export interface Submission {
  id: string;
  org_id: string;
  opportunity_id: string;
  opportunity?: Opportunity;
  content: SubmissionSection[];
  version: number;
  status: 'draft' | 'review' | 'submitted' | 'approved' | 'rejected';
  pdf_path: string | null;
  created_at: string;
  submitted_at: string | null;
  outcome: 'approved' | 'rejected' | 'partial' | 'pending' | 'no_response' | null;
  approved_amount: number | null;
  requested_amount: number | null;
  funder_feedback: string | null;
  lessons_learned: string | null;
  outcome_at: string | null;
}

export interface OrgMemory {
  id: string;
  org_id: string;
  key: string;
  value: string;
  source: 'chat' | 'upload' | 'manual';
  confidence: 'low' | 'medium' | 'high';
  created_at: string;
  updated_at: string;
}

export interface SubmissionSection {
  title: string;
  content: string;
  order: number;
}

// ===== Chat =====

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata?: {
    tool_calls?: ToolCall[];
    documents_referenced?: string[];
  };
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface Conversation {
  id: string;
  org_id: string;
  user_id: string;
  title: string | null;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

// ===== API Types =====

export interface ChatRequest {
  message: string;
  conversation_id?: string;
}

export interface ChatResponse {
  message: string;
  conversation_id: string;
}

export interface UploadResponse {
  document_id: string;
  category: DocumentCategory;
  extracted_fields: Record<string, unknown>;
}

// ===== App State =====

export type SidebarTab = 'org' | 'opportunities' | 'business' | 'foundations';

export type AppStage =
  | 0  // welcome, no docs
  | 1  // docs uploaded, org profile built
  | 2; // scanning done, opportunities available
