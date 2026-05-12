# Goldfish — Grants & Funders Intelligence

## Grants Database: 572 Opportunities

### Status Breakdown
- Open with deadline: ~49 active
- Open without deadline: ongoing/rolling
- Closed: archived (reopen seasonally)

### Taxonomy
**12 Domain Categories:**
education, welfare, health, employment, technology, community, environment, culture, coexistence, legal, emergency, research

**25 Population Categories:**
youth, young_adults, children, women, elderly, immigrants, ethiopian, arab, haredi, druze, bedouin, disabilities, lgbtq, soldiers, prisoners, homeless, single_parents, domestic_violence, at_risk, minorities, refugees, periphery, low_income, students, families

### Grant Sources: 75 Scan URLs
Organized by layer:

**Government (משרדי ממשלה):**
- Ministry of Education — education grants
- Ministry of Welfare — social services
- National Insurance (ביטוח לאומי) — rehabilitation, disability
- Ministry of Aliyah — immigrant integration
- Ministry of Science — R&D grants

**Private Foundations (קרנות פרטיות):**
- Azrieli Foundation — education, research, architecture
- Yad Hanadiv (Rothschild) — education, environment, society
- Rashi Foundation — youth at risk, education
- Mifal HaPais — sports, culture, community
- Estate Committee (ועדת עיזבונות) — various social causes

**International (קרנות בינלאומיות):**
- Schusterman Foundation — Jewish education, Israel
- Weinberg Foundation — disability, workforce, education
- Jim Joseph Foundation — Jewish education
- Helmsley Trust — health, education
- Wolfson Foundation — education, health

**Aggregators (אגרגטורים):**
- GuideStar Israel
- Milga (מילגה)
- Midot (מידות)
- Social Finance Israel

---

## Funders Intelligence: 38+ Identified Bodies

### Deep Intel — 12 Major Funders

#### 1. Ministry of Education (משרד החינוך)
- Largest education funder in Israel
- Key programs: dropout prevention, informal education, special education
- Typical grants: 50K-500K NIS
- Process: Public tenders via government procurement site
- Tip: Requires "supplier recognized" status

#### 2. National Insurance (ביטוח לאומי)
- Funds rehabilitation, disability, elderly care
- Special programs for work injuries, single parents
- Typical grants: 30K-200K NIS
- Process: Direct applications + tenders

#### 3. Mifal HaPais (מפעל הפיס)
- Largest lottery-funded body
- Focus: sports, culture, community infrastructure
- Typical grants: 100K-5M NIS (for projects)
- Process: Online application system
- Tip: Strong preference for capital/infrastructure projects

#### 4. Estate Committee (ועדת עיזבונות)
- Distributes deceased estates to nonprofits
- Very diverse funding areas
- Typical grants: 20K-300K NIS
- Process: Annual call for proposals
- Tip: Less competitive than major foundations

#### 5. Azrieli Foundation (עזריאלי)
- Major private foundation
- Focus: education, research, architecture, community
- Typical grants: 100K-2M NIS
- Known for: Fellows programs, education innovation
- Process: Invitation-based + open calls

#### 6. Yad Hanadiv (Rothschild) (יד הנדיב)
- Rothschild family foundation
- Focus: education, environment, civil society
- Typical grants: 500K-5M NIS (large scale)
- Process: Invitation-based mostly
- Tip: Very selective, prefers systemic change

#### 7. Rashi Foundation (רשי)
- Focus: youth at risk, education, employment
- Typical grants: 200K-1M NIS
- Known for: HESEG program, educational programs
- Process: Both invited and open

#### 8. KKL-JNF (קק"ל)
- Focus: environment, community, Negev/Galilee development
- Typical grants: 50K-500K NIS
- Process: Regional applications
- Tip: Strong geographic preference (periphery)

#### 9. JDC-Israel (ג'וינט)
- Largest international Jewish social services org
- Focus: employment (Tevet), disabilities, elderly, innovation
- Typical grants: 100K-2M NIS
- Programs: Tevet (employment), Ashalim (children), Eshel (elderly)
- Process: Partnership model (co-funding required)

#### 10. Schusterman Foundation (שוסטרמן)
- US-based, major Israel funder
- Focus: Jewish identity, social entrepreneurship, education
- Typical grants: $50K-$500K
- Known for: ROI Community, leadership programs
- Process: Invitation-based

#### 11. Weinberg Foundation (ויינברג)
- Focus: disability, workforce development, education
- Typical grants: $100K-$1M
- Israel priority: disability inclusion, employment
- Process: Open applications through website

#### 12. Jewish Agency (הסוכנות היהודית)
- Focus: immigration, Jewish education, diaspora relations
- Programs: Shlichut, Partnership2Gether, youth programs
- Typical grants: Varies widely
- Process: Through departments and regional offices

---

## Daily Grant Scanner

### Architecture
```
scanner/daily_grants_scan.py
  → Fetches 79+ URLs from grant_sources table
  → Parses HTML/RSS for new opportunities
  → Deduplicates against existing grants
  → Classifies: domains, populations, status
  → Inserts new grants to Supabase
  → Logs results
```

### Schedule
- **When:** Daily at 07:00 (Windows Task Scheduler)
- **Script:** `scanner/daily_grants_scan.py`
- **Config:** `scanner/schedule_daily_scan.ps1`

### Deduplication
- Checks URL uniqueness
- Checks title similarity (fuzzy)
- Same funder + similar title within 30 days = skip

---

## Grant Writing Agent

### Proposal Structure (10 sections)
1. Executive Summary (150-200 words)
2. Organization Background
3. Need Statement (4-layer: national stats → local gap → affected population → urgency)
4. Goals & Objectives (SMART format)
5. Program Description (activities, timeline, milestones)
6. Target Population (demographics, selection criteria)
7. Evaluation Plan (indicators, tools, timeline)
8. Sustainability Plan (post-grant continuation)
9. Budget (line items, justification, co-funding)
10. Appendices (registration docs, financials, letters of support)

### Templates Available
- Full Proposal (Hebrew)
- LOI — Letter of Inquiry (English, 400-600 words)
- Executive Summary
- Budget Template
- Email to Funder (English/Hebrew)

### Funder-Type Adaptation
| Funder Type | Language | Emphasis |
|-------------|----------|----------|
| Government | Formal Hebrew | Compliance, tenders, criteria |
| Family Foundation | Personal Hebrew | Story, impact, relationships |
| International | English | Theory of Change, SROI, SDGs |
| Corporate CSR | Business Hebrew | Branding, employee engagement |

### English Grants Skill (`/english-grants`)
- Reads RFPs in English
- Writes proposals/LOIs/emails at native English level
- SDG alignment: 4 (Education), 10 (Reduced Inequalities), 1 (No Poverty)
- Theory of Change, Logic Model, SMART goals, SROI built-in

### Red Flags (10 things to avoid)
1. No data/evidence for need statement
2. Vague goals without measurable outcomes
3. Budget doesn't match activities
4. No sustainability plan
5. Missing required documents
6. Wrong funder (applying to mismatched grant)
7. Exceeding word/page limits
8. Generic copy-paste proposals
9. No evaluation methodology
10. Late submission
