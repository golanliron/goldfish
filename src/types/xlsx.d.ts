declare module 'xlsx' {
  export function read(data: Buffer | string, opts?: Record<string, unknown>): WorkBook;
  export const utils: {
    sheet_to_json<T = unknown>(sheet: WorkSheet, opts?: Record<string, unknown>): T[];
  };
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  export interface WorkSheet {
    [key: string]: unknown;
  }
}
