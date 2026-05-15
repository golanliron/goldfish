/**
 * Goldfish — Structured Logger
 *
 * Single pino instance for the entire backend.
 * All logs are JSON in production (Vercel captures them in Log Drains).
 * In development, logs are pretty-printed to console.
 *
 * Usage:
 *   import { log } from '@/lib/logger';
 *   log.info({ org_id, job_id }, 'Scan started');
 *   log.error({ err, org_id }, 'Scan failed');
 *
 * Child loggers for modules:
 *   const logger = log.child({ module: 'scan' });
 *   logger.info('Processing');
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const log = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),

  // In production: plain JSON (Vercel log drain compatible)
  // In development: readable output
  transport: isDev
    ? {
        target: 'pino/file',
        options: { destination: 1 }, // stdout, formatted by pino's default
      }
    : undefined,

  // Redact sensitive fields from every log line
  redact: {
    paths: [
      'payload.api_key',
      'payload.token',
      'body.password',
      '*.supabase_key',
      '*.service_role_key',
    ],
    censor: '[REDACTED]',
  },

  // Standard fields on every log line
  base: {
    env: process.env.NODE_ENV,
    app: 'goldfish',
  },

  // ISO timestamps
  timestamp: pino.stdTimeFunctions.isoTime,

  // Serialize Error objects properly
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

// ─── Convenience child loggers ────────────────────────────────────────────────

export const queueLog      = log.child({ module: 'queue' });
export const scanLog       = log.child({ module: 'scan' });
export const chatLog       = log.child({ module: 'chat' });
export const ragLog        = log.child({ module: 'rag' });
export const geminiLog     = log.child({ module: 'gemini' });
export const companiesLog  = log.child({ module: 'companies' });
export const opportunitiesLog = log.child({ module: 'opportunities' });

// ─── Request logger helper ────────────────────────────────────────────────────

/**
 * Log an API request start and return a "done" function to log completion.
 *
 * Usage:
 *   const done = logRequest(req, 'scan');
 *   // ... do work ...
 *   done({ matches: 5 });
 */
export function logRequest(
  req: Request,
  routeName: string,
  extra?: Record<string, unknown>,
): (result?: Record<string, unknown>) => void {
  const start = Date.now();
  const reqLog = log.child({ route: routeName, method: req.method, ...extra });
  reqLog.info('request started');

  return (result?: Record<string, unknown>) => {
    reqLog.info({ duration_ms: Date.now() - start, ...result }, 'request completed');
  };
}
