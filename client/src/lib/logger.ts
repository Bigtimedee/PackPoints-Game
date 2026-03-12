/**
 * Production-safe logger. Only outputs in development builds.
 * Use logger.debug() instead of console.log() for debug traces.
 * Use logger.error() for genuine errors (always logs, routes to monitoring).
 */
const isDev = import.meta.env.DEV;

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info(...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    // Always log errors, even in production
    console.error(...args);
  },
};
