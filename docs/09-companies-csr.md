# Goldfish — Companies & CSR Database

## Overview
1,044 companies and foundations in the database, used for matching nonprofits with potential corporate sponsors and foundation funders.

## Company Types

| Type | Count | Description |
|------|-------|-------------|
| business | 524 | Private businesses (tech, retail, industry) |
| public | 224 | Publicly traded (best CSR data available) |
| private | 114 | Private companies |
| fund | 182 | Foundations, funds, Jewish federations |

## Data Quality Audit (2026-05-06)

### What's Good
- 0 duplicates (11 cleaned on 2026-05-06)
- 0 broken emails
- 100% have descriptions (50+ chars, many very detailed)
- 100% have interest areas (avg 3 per company)
- 500 with CSR rankings
- 219/224 public companies have donation amounts
- 182 funds — 100% have website, email, phone

### What Needs Work
- **96% generic emails** (info@, office@, contact@) — only 43 specific CSR emails
- **17 named contacts** (out of 1,044) — most still anonymous
- **166 with identified CSR role** but no personal email
- Mobile phones: only 1 verified (Bank Hapoalim)

## CSR Contacts (Verified Personal Emails)

| Company | Contact | Email | Role |
|---------|---------|-------|------|
| בנק הפועלים | שרונה תרשיש | sharona.tarshish@poalim.co.il | אחריות תאגידית |
| בנק דיסקונט | ענת סיגמן | anat.sigman@discountbank.co.il | מנהלת אחריות תאגידית |
| בנק לאומי | קרן טייר-יבבה | keren.tayerivava@bankleumi.co.il | אחריות תאגידית |
| הראל | נופר הללפרץ | nofar.halelperetz@harel-group.co.il | מנהלת קיימות |
| אלביט מערכות | לירון שפירא | liron.shapira@elbitsystems.com | Director CSR |
| צים | שי לוי | shai.levi@zim.com | מנהל קיימות |
| דלתא גליל | Patrick Newsom | patrick.newsom@deltagalil.com | VP Sustainability |
| בזק | גיא הדס | guy.hadas@bezeq.co.il | מנהל אחריות תאגידית |
| אל על | צביקה סגל | zvika.segal@elal.co.il | מנהל אחריות תאגידית |
| קבוצת אשטרום | מאיה פאייר | maya.payer@ashtrom.co.il | מנהלת ESG |
| שיכון ובינוי | אורי בן-פורת | uri.benporat@shikunbinui.co.il | סמנכ"ל קיימות |
| ביג | יסמין אילד | yasmin.ild@big.co.il | מנהלת אחריות תאגידית |
| מגדל | — | community@migdal.co.il | מנהל מעורבות חברתית |
| הפניקס | — | community@fnx.co.il | צוות קיימות וקהילה |
| שופרסל | — | sherutk@shufersal.co.il | מחלקת אחריות תאגידית |
| אמדוקס | עידית דובדבני ארונסון | idit.duvdevany@amdocs.com | מנהלת CSR גלובלית |

## Email Format Patterns (for future enrichment)
From RocketReach research:

| Company | Pattern | Confidence |
|---------|---------|------------|
| Bank Hapoalim | first.last@poalim.co.il | 73% |
| Bank Discount | first.last@discountbank.co.il | 98% |
| Bank Leumi | first.last@bankleumi.co.il | 95% |
| Harel | first.last@harel-group.co.il | 98% |
| Elbit | first.last@elbitsystems.com | 85% |
| ZIM | first.last@zim.com | 50% |
| El Al | FirstL@elal.co.il | 54% |
| Bezeq | first+last_2chars@bezeq.co.il | 44% |
| Shikun Binui | first_lastinit@shikunbinui.com | 59% |

## Top 14 Corporate Donors (Maala 2024 Report)

| Rank | Company | Donation (NIS) | % of Profit |
|------|---------|---------------|-------------|
| 1 | בנק הפועלים | 119.0M | 1.0% |
| 2 | בנק לאומי | 80.0M | 0.5% |
| 3 | בנק דיסקונט | 51.2M | 0.7% |
| 4 | מזרחי טפחות | 50.2M | 0.6% |
| 5 | ICL | 29.2M | 1.3% |
| 6 | אלרוב | 20.8M | 4.1% |
| 7 | שטראוס | 20.0M | 2.2% |
| 8 | עזריאלי | 19.1M | 1.0% |
| 9 | בזן | 18.2M | 3.6% |
| 10 | הראל | 14.3M | 1.1% |
| 11 | כלל ביטוח | 14.0M | 1.3% |
| 12 | בזק | 13.2M | 0.9% |
| 13 | הבינלאומי | 13.0M | 0.3% |
| 14 | הפניקס | 11.0M | 0.4% |

**Total public company donations 2024:** 680M NIS (14% increase from 2023)

## Foundations (182 records)

### Israeli Foundations
עזריאלי, מנדל, רוטשילד/יד הנדיב, מפעל הפיס, אברהם, מיתן, רשי, קק"ל, ועדת עיזבונות

### International Foundations
Jim Joseph, Helmsley Trust, Weinberg Foundation, Wexner Foundation, Wolfson Foundation, Schusterman Foundation

### Jewish Federations
LA, Chicago, Toronto, Cleveland, Miami, Boston (CJP), New York (UJA-Fed), Atlanta, Philadelphia, Phoenix, and 10 more

### Foundation Data Quality
- 100% have website
- 100% have email
- 100% have phone
- ~60 have donation amounts (from description extraction)
- 14 have named contacts

## Companies Tab — UI Features
- **Filter by type:** business / public / private / fund
- **Filter by fund subtype:** foundations only / federations only
- **Filter by match score:** 70+ (strong) / 40+ (partial) / 20+ (weak)
- **Search:** Free text (Hebrew + English)
- **Sort:** By name / donation amount / match score
- **Each card shows:** Name, type, interests, donation amount, match score, contact info

## Enrichment Priorities
1. CSR personal emails (currently 96% generic)
2. CSR contact names (currently 17/1,044)
3. Company websites (currently 206/954 businesses)
4. Foundation donation amounts (currently ~60/182)
5. Mobile phones (currently 1 verified)

## Sources for Enrichment
- **Maala reports:** Annual CSR report with donation amounts
- **InfoSpot:** 82 ESG reports available (2025)
- **RocketReach:** Email format patterns
- **LinkedIn:** CSR manager names and titles
- **GuideStar Israel:** Nonprofit directory
- **Company ESG/CSR pages:** Self-reported data
