# Goldfish — Database Schema & Data

## Two Supabase Projects (CRITICAL!)

### Main App DB (companies, orgs, docs, conversations)
- **ID:** touqczopfjxcpmbxzdjr
- **URL:** https://touqczopfjxcpmbxzdjr.supabase.co
- **Tables:** companies, organizations, org_profiles, documents, conversations, matches, sector_intelligence, sector_knowledge, grant_sources

### Grants DB (grant opportunities — separate project!)
- **ID:** vhmwijzcrqjjquxomccq
- **URL:** https://vhmwijzcrqjjquxomccq.supabase.co
- **Tables:** opportunities (572 grants), grant_taxonomy
- **Note:** `loadGrantsIndex()` and `loadFundersIndex()` read from THIS DB, not the main one

## Core Tables

### 1. `companies` — 1,044 records
Corporate & foundation database for CSR matching.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Company name (Hebrew or English) |
| type | text | `business` / `public` / `private` / `fund` |
| description | text | Detailed description (50+ chars each) |
| interests | text[] | Array of interest areas (avg 3 per company) |
| donation_amount | numeric | Annual donation in NIS (for public companies) |
| csr_rank | text | CSR rating (for businesses) |
| contact_name | text | CSR contact person name |
| contact_email | text | Contact email |
| contact_phone | text | Contact phone |
| contact_role | text | Contact role/title |
| website | text | Company website URL |
| created_at | timestamptz | Record creation date |

**Data quality:**
- 100% have descriptions, 100% have interests
- 500 with CSR rankings (business + public + some private)
- 219/224 public companies have donation amounts
- 182 funds/foundations — 100% have website, email, phone
- 17 named CSR contacts, 166 with identified CSR roles
- ~96% still have generic emails (info@, office@) — ongoing enrichment

**Company types breakdown:**
- business: 524 (private businesses)
- public: 224 (publicly traded, best CSR data)
- private: 114
- fund: 182 (foundations, funds, Jewish federations)

### 2. `grants` — 572 records
Grant opportunities / calls for proposals.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| title | text | Grant/opportunity title |
| funder | text | Funding organization name |
| deadline | date | Submission deadline (null = ongoing) |
| amount | text | Grant amount or range |
| domains | text[] | Funding domains (education, welfare, etc.) |
| populations | text[] | Target populations (youth, women, etc.) |
| url | text | Link to full call for proposals |
| description | text | Full description |
| eligibility | text | Eligibility criteria |
| submission_method | text | How to submit |
| contact | text | Contact info for questions |
| status | text | `open` / `closed` |
| source | text | Where this was found |
| created_at | timestamptz | When added to DB |

**Taxonomy:**
- 12 domain categories (education, welfare, health, employment, technology, etc.)
- 25 population categories (youth, women, elderly, immigrants, Arab, Haredi, etc.)

### 3. `grant_sources` — 75 records
Sources scanned daily for new grants.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Source name |
| url | text | URL to scan |
| layer | text | `government` / `private` / `international` / `aggregator` |
| active | boolean | Whether to scan |
| last_scanned | timestamptz | Last scan time |

### 4. `organizations` — Org profiles
Each Goldfish user's organization profile.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users |
| name | text | Organization name |
| description | text | Org description |
| amuta_number | text | Registration number |
| founded_year | int | Year founded |
| annual_budget | numeric | Annual budget |
| staff_count | int | Number of employees |
| volunteer_count | int | Number of volunteers |
| beneficiary_count | int | Beneficiaries served |
| domains | text[] | Activity domains |
| populations | text[] | Target populations |
| regions | text[] | Geographic regions |
| age_groups | text[] | Age groups served |
| website | text | Org website |
| created_at | timestamptz | |

### 5. `documents` — Uploaded documents
Files uploaded by organizations (PDF, DOCX, URLs).

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| org_id | uuid | FK to organizations |
| name | text | File name |
| type | text | `pdf` / `docx` / `url` / `linkedin` |
| content | text | Extracted text content |
| summary | text | AI-generated summary |
| chunks | jsonb | Chunked content for RAG |
| category | text | AI-classified category |
| file_path | text | Storage path or URL |
| created_at | timestamptz | |

**Smart Reader pipeline:** Upload → Extract text → AI classify → Chunk → Store → Available for RAG

### 6. `conversations` — Chat history

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| org_id | uuid | FK to organizations |
| title | text | Conversation title |
| messages | jsonb | Array of {role, content} |
| created_at | timestamptz | |

### 7. `sector_intelligence` — News & trends

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| title | text | Item title |
| content | text | Full content |
| source | text | News source |
| reliability | text | `high` / `medium` / `low` |
| relevance | int | 0-100 score |
| sector | text | Related sector |
| created_at | timestamptz | |

### 8. `sector_knowledge` — Curated sector knowledge

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| topic | text | Knowledge topic |
| content | text | Knowledge content |
| source | text | Original source |
| updated_at | timestamptz | |

## Data Pipelines

### Daily Grant Scanner
- **Script:** `scanner/daily_grants_scan.py`
- **Schedule:** Task Scheduler, 07:00 daily
- **Sources:** 79+ URLs from `grant_sources`
- **Process:** Fetch → Parse → Deduplicate → Insert to `grants`

### Sector Scanner
- **Script:** `scanner/sector_scanner.py`
- **Sources:** 10 news websites
- **Output:** `sector_intelligence` table

### Facebook Scanner
- **Skill:** `/facebook-scanner`
- **Schedule:** Weekly (Sunday 07:00)
- **Monitors:** 9 Facebook pages
- **Output:** `sector_knowledge` table

## Known Duplicates (cleaned 2026-05-06)
11 duplicate company records were deleted. Remaining companies are unique.
Previously: בנק דיסקונט (3 records), בנק הפועלים (2), אלביט (2), אל על (2), etc.

## Top 14 Corporate Donors (Maala 2024)
1. Bank Hapoalim — 119.0M NIS
2. Bank Leumi — 80.0M
3. Bank Discount — 51.2M
4. Mizrahi Tefahot — 50.2M
5. ICL — 29.2M
6. Alrov — 20.8M
7. Strauss — 20.0M
8. Azrieli — 19.1M
9. Bazan — 18.2M
10. Harel — 14.3M
11. Clal Insurance — 14.0M
12. Bezeq — 13.2M
13. First International — 13.0M
14. Phoenix — 11.0M
