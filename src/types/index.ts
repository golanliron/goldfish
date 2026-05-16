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
  ngo_number?: string;           // official NGO registration number (immutable once set)
  registration_number?: string;  // ח"פ / company reg number
  founded_year?: number;
  mission?: string;
  focus_areas?: string[];
  target_populations?: string[];
  annual_budget?: number;
  data_as_of?: number;           // year the financial/operational data refers to (e.g. 2024)
  employees_count?: number;
  beneficiaries_count?: number;
  regions?: string[];
  cities_active?: string[];
  active_projects?: ProjectSummary[];
  existing_grants?: GrantSummary[];
  key_achievements?: string[];
  certifications?: string[];
  // People
  ceo_name?: string;
  board_members?: string[];
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
  source_url: string | null;       // Original URL as scraped — direct link to the grant page/PDF
  application_url: string | null;  // Direct link to the application form (more specific than url)
  eligibility: string | null;
  how_to_apply: string | null;
  contact_info: string | null;
  full_content: string | null;
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

// ===== RFP Parsing — Extracted structure from a specific grant application =====

export interface RfpQuestion {
  id: string;                    // e.g. "q1", "q2"
  question: string;              // The actual question text
  section: string;               // Section it belongs to (e.g. "org_identity", "project", "budget")
  char_limit?: number;           // Character limit if specified
  word_limit?: number;           // Word limit if specified
  is_required: boolean;          // Whether it's mandatory
  field_type: 'text' | 'number' | 'date' | 'file' | 'dropdown' | 'budget_table';
  mapped_block?: OrgBlockType;   // Which org block answers this question
}

export interface RfpEligibility {
  min_annual_budget?: number;    // e.g. 2000000
  min_years_active?: number;     // e.g. 3
  required_org_type?: string[];  // e.g. ["amuta", "public_benefit"]
  required_regions?: string[];
  required_populations?: string[];
  max_funding_percent?: number;  // e.g. 30 (max 30% of project budget)
  min_self_funding?: number;     // e.g. 15 (must fund 15% yourself)
  overhead_cap?: number;         // e.g. 22 (max 22% overhead)
  other_conditions?: string[];
}

export interface RfpStructure {
  id?: string;
  org_id: string;
  opportunity_id?: string;       // Link to opportunities table
  funder_name: string;
  funder_type: 'government' | 'foundation' | 'corporate' | 'federation' | 'other';
  rfp_title: string;
  deadline?: string;
  max_amount?: number;
  questions: RfpQuestion[];
  required_documents: string[];
  eligibility: RfpEligibility;
  evaluation_criteria?: { criterion: string; weight: number }[];
  raw_text?: string;             // Original text for reference
  parsed_at: string;
}

// ===== Org Blocks — Reusable content blocks per organization =====

export type OrgBlockType =
  | 'identity'        // Who we are
  | 'problem'         // The need/problem we address
  | 'solution'        // What we do / methodology
  | 'capacity'        // Track record, team, experience
  | 'budget'          // Financial data
  | 'measurement'     // KPIs, evaluation, Theory of Change
  | 'documents';      // Required docs checklist

export type BlockLength = 'mini' | 'standard' | 'extended';

export interface OrgBlock {
  id?: string;
  org_id: string;
  block_type: OrgBlockType;
  project_id?: string;           // null = org-wide, string = project-specific
  content: {
    mini: string;                // Up to 500 chars
    standard: string;            // Up to 1500 chars
    extended: string;            // Up to 2500 chars
  };
  metadata?: Record<string, unknown>;  // Extra structured data (e.g. budget table, KPI list)
  last_updated: string;
  auto_generated: boolean;       // true = AI generated from docs, false = user edited
}

// ===== Readiness Score =====

export interface ReadinessResult {
  score: number;                 // 0-100
  eligible: boolean;             // Passes all threshold conditions
  eligibility_issues: string[];  // What fails (e.g. "מחזור מתחת ל-2M")
  blocks_ready: { block: OrgBlockType; available: boolean; freshness: 'fresh' | 'stale' | 'missing' }[];
  documents_ready: { doc: string; status: 'valid' | 'expired' | 'missing' }[];
  missing_answers: string[];     // Questions we can't answer from blocks
  estimated_completion: number;  // Minutes to complete missing parts
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

// ===== Org Knowledge Score =====

export type OrgScoreCategory = 'identity' | 'dna' | 'impact' | 'operations' | 'submissions';

export interface OrgScoreBreakdown {
  category: OrgScoreCategory;
  label: string;
  score: number; // 0-100
  status: 'full' | 'partial' | 'missing';
  cta: string | null;
}

export interface OrgScore {
  total: number; // 0-100
  breakdown: OrgScoreBreakdown[];
}

// ===== App State =====

export type SidebarTab = 'org' | 'opportunities' | 'business' | 'foundations';

export type AppStage =
  | 0  // welcome, no docs
  | 1  // docs uploaded, org profile built
  | 2; // scanning done, opportunities available
