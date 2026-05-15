/**
 * Omni-Parser — unified file text extraction
 *
 * Supported formats:
 *   PDF  → pdf-parse (text layer) → geminiOcrPdf (fallback for scans)
 *   DOCX → mammoth (clean text extraction)
 *   XLSX → SheetJS pipe-delimited table → geminiParseXlsx (fallback)
 *   XLS  → SheetJS (same path)
 *   CSV  → raw UTF-8
 *   HTML → strip tags
 *   TXT / MD → raw UTF-8
 */

import { geminiOcrPdf, geminiParseXlsx } from '@/lib/ai/gemini';

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

async function parsePDF(buffer: Buffer): Promise<string> {
  // Primary: text layer via pdf-parse
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    if (result.text && result.text.trim().length > 20) return result.text;
  } catch { /* fall through */ }

  // Fallback: Gemini multimodal OCR (handles scanned PDFs)
  try {
    const text = await geminiOcrPdf(buffer);
    if (text.length > 20) return text;
  } catch { /* give up */ }

  return '';
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const extract = mammoth.default?.extractRawText ?? mammoth.extractRawText;
  const result = await extract({ buffer });
  return result.value || '';
}

// ---------------------------------------------------------------------------
// Excel (XLSX / XLS)
// SheetJS → pipe-delimited text table, one section per sheet.
// Limits: 3 sheets max, 500 rows per sheet, 50 columns per row.
// Fallback: geminiParseXlsx for unreadable / encrypted workbooks.
// ---------------------------------------------------------------------------

const XLSX_MAX_SHEETS = 3;
const XLSX_MAX_ROWS = 500;
const XLSX_MAX_COLS = 50;

async function parseExcel(buffer: Buffer, filename: string): Promise<string> {
  // Primary: SheetJS local parsing
  try {
    const XLSX = await import('xlsx');

    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,   // parse dates as JS Date objects
      cellNF: false,     // skip number-format strings
      cellHTML: false,   // skip HTML cells
    });

    const sheetNames = workbook.SheetNames.slice(0, XLSX_MAX_SHEETS);
    const sections: string[] = [];

    for (const name of sheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;

      // Get rows as arrays of raw values
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        blankrows: false,
      });

      if (rows.length === 0) continue;

      const trimmedRows = rows.slice(0, XLSX_MAX_ROWS);

      // Determine max columns across all rows (capped)
      const maxCols = Math.min(
        trimmedRows.reduce((m, r) => Math.max(m, r.length), 0),
        XLSX_MAX_COLS
      );

      // Build pipe-delimited table
      const tableLines = trimmedRows.map(row => {
        const cells = Array.from({ length: maxCols }, (_, i) => {
          const cell = row[i];
          if (cell === null || cell === undefined || cell === '') return '';
          if (cell instanceof Date) {
            return cell.toLocaleDateString('he-IL');
          }
          return String(cell).replace(/\|/g, '/').replace(/\n/g, ' ').trim();
        });
        return `| ${cells.join(' | ')} |`;
      });

      // Separator after header row
      if (tableLines.length > 1) {
        const separator = `| ${Array(maxCols).fill('---').join(' | ')} |`;
        tableLines.splice(1, 0, separator);
      }

      const truncationNote = rows.length > XLSX_MAX_ROWS
        ? `\n_(מוצגות ${XLSX_MAX_ROWS} שורות מתוך ${rows.length})_`
        : '';

      sections.push(`### גיליון: ${name}\n\n${tableLines.join('\n')}${truncationNote}`);
    }

    const result = sections.join('\n\n');
    if (result.trim().length > 20) return result;
  } catch (err) {
    console.warn('[file-parser] SheetJS failed, falling back to Gemini:', err instanceof Error ? err.message : err);
  }

  // Fallback: Gemini multimodal (handles complex / encrypted workbooks)
  try {
    const text = await geminiParseXlsx(buffer);
    if (text && text.length > 20) return text;
  } catch { /* give up */ }

  return `[קובץ אקסל: ${filename}]`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract plain text from any supported file buffer.
 *
 * @param buffer   Raw file bytes
 * @param mimeType MIME type string (e.g. "application/pdf")
 * @param filename Original filename — used for extension fallback and placeholders
 * @returns        Extracted text, or an empty string if extraction fails
 */
export async function parseFileContent(
  buffer: Buffer,
  mimeType: string,
  filename: string = ''
): Promise<string> {
  // Derive extension from MIME type first, fall back to filename
  const ext = mimeTypeToExt(mimeType) ?? filename.split('.').pop()?.toLowerCase() ?? '';

  switch (ext) {
    case 'pdf':
      return parsePDF(buffer);

    case 'docx':
    case 'doc':
      return parseDocx(buffer);

    case 'xlsx':
    case 'xls':
      return parseExcel(buffer, filename);

    case 'csv':
    case 'txt':
    case 'md':
      return buffer.toString('utf-8');

    case 'html':
    case 'htm':
      return stripHtml(buffer.toString('utf-8'));

    default: {
      // Best-effort: try to read as UTF-8 plain text
      const text = buffer.toString('utf-8');
      const looksLikeText = text.length > 100 && !text.includes('\u0000');
      return looksLikeText ? text : '';
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf':                                                              'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':     'docx',
  'application/msword':                                                          'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':           'xlsx',
  'application/vnd.ms-excel':                                                    'xls',
  'text/csv':                                                                    'csv',
  'text/plain':                                                                  'txt',
  'text/markdown':                                                               'md',
  'text/html':                                                                   'html',
};

function mimeTypeToExt(mimeType: string): string | undefined {
  return MIME_TO_EXT[mimeType.toLowerCase().split(';')[0].trim()];
}
