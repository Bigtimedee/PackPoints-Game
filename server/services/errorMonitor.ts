/**
 * Native error monitoring wrapper.
 *
 * Provides structured error capture with context, user info, and request details.
 * Designed as a drop-in Sentry-compatible interface so Sentry can be swapped in
 * by setting SENTRY_DSN when the npm registry is available.
 *
 * Current behavior: logs to stderr in structured JSON format for log aggregation.
 * Future: set SENTRY_DSN env var and install @sentry/node for full Sentry support.
 */

interface ErrorContext {
  userId?: string | number;
  requestId?: string;
  path?: string;
  method?: string;
  extra?: Record<string, unknown>;
}

interface CapturedError {
  timestamp: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  stack?: string;
  context: ErrorContext;
  environment: string;
}

class ErrorMonitor {
  private isEnabled: boolean;
  private environment: string;
  private dsn: string | undefined;

  constructor() {
    this.dsn = process.env.SENTRY_DSN;
    this.environment = process.env.NODE_ENV || 'development';
    // In production with no DSN, still capture to stderr
    this.isEnabled = true;

    if (this.dsn) {
      console.log('[ErrorMonitor] SENTRY_DSN detected — configure @sentry/node for full Sentry integration');
    } else {
      console.log('[ErrorMonitor] Running in native mode (structured stderr logging). Set SENTRY_DSN for Sentry.');
    }
  }

  captureException(err: unknown, context: ErrorContext = {}): void {
    const error = err instanceof Error ? err : new Error(String(err));
    const captured: CapturedError = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: error.message,
      stack: error.stack,
      context,
      environment: this.environment,
    };
    console.error('[ErrorMonitor]', JSON.stringify(captured));
  }

  captureMessage(message: string, level: 'error' | 'warning' | 'info' = 'info', context: ErrorContext = {}): void {
    const captured: CapturedError = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      environment: this.environment,
    };
    if (level === 'error') {
      console.error('[ErrorMonitor]', JSON.stringify(captured));
    } else {
      console.warn('[ErrorMonitor]', JSON.stringify(captured));
    }
  }

  /**
   * Express error middleware — add as the last middleware in index.ts
   */
  expressErrorHandler() {
    return (err: any, req: any, res: any, next: any) => {
      this.captureException(err, {
        requestId: req.headers['x-request-id'],
        path: req.path,
        method: req.method,
        userId: req.user?.id,
      });
      next(err);
    };
  }
}

export const errorMonitor = new ErrorMonitor();
