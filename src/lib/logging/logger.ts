/**
 * Structured server logging.
 *
 * One JSON object per line to stdout, correlated by `analysisId`. Line-oriented
 * JSON is what makes logs greppable locally and ingestible by any hosted log
 * service without an agent.
 *
 * **Nothing sensitive is ever logged.** There is no code path that writes a
 * token, an authorization header, or a full API payload, and a test asserts it.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEvent =
  | 'analysis_started'
  | 'analysis_completed'
  | 'analysis_failed'
  | 'github_request_failed'
  | 'rate_limit_reached'
  | 'cache_hit'
  | 'cache_miss'
  | 'store_unavailable';

/**
 * Named fields explicitly admit `undefined` rather than only being optional.
 *
 * Callers routinely spread objects whose fields may be absent, and the logger
 * already drops undefined values before serializing. Forbidding `undefined` at
 * the type level while handling it at runtime would just force callers into
 * conditional spreads for no benefit.
 */
export interface LogFields {
  analysisId?: string | undefined;
  repository?: string | undefined;
  durationMs?: number | undefined;
  score?: number | null | undefined;
  reason?: string | undefined;
  requestsMade?: number | undefined;
  rateLimitRemaining?: number | null | undefined;
  scoringVersion?: string | undefined;
  ageSeconds?: number | undefined;
  [key: string]: string | number | boolean | null | undefined;
}

export interface LogRecord extends LogFields {
  level: LogLevel;
  event: LogEvent;
  timestamp: string;
}

/**
 * Keys that must never appear in a log line.
 *
 * The logger drops them defensively. The real protection is that no caller
 * passes them, but a defensive drop means a future careless caller degrades to
 * a missing field rather than a leaked credential.
 */
const FORBIDDEN_KEYS = new Set([
  'token',
  'githubToken',
  'authorization',
  'auth',
  'password',
  'secret',
  'apiKey',
  'accessToken',
  'cookie',
]);

export interface Logger {
  log(level: LogLevel, event: LogEvent, fields?: LogFields): void;
  info(event: LogEvent, fields?: LogFields): void;
  warn(event: LogEvent, fields?: LogFields): void;
  error(event: LogEvent, fields?: LogFields): void;
}

export function createLogger(
  options: { write?: (line: string) => void; now?: () => Date } = {},
): Logger {
  const write = options.write ?? ((line: string) => console.warn(line));
  const now = options.now ?? (() => new Date());

  function log(level: LogLevel, event: LogEvent, fields: LogFields = {}): void {
    const safe: LogFields = {};

    for (const [key, value] of Object.entries(fields)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (value === undefined) continue;
      safe[key] = value;
    }

    const record: LogRecord = {
      level,
      event,
      timestamp: now().toISOString(),
      ...safe,
    };

    write(JSON.stringify(record));
  }

  return {
    log,
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  };
}

/** The application logger. Tests build their own with an injected writer. */
export const logger = createLogger();
