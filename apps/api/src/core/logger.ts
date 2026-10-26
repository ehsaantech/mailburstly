/**
 * Structured JSON logger.
 *
 * Deliberately dependency-free (~60 lines instead of pino). Output is a single
 * JSON object per line so `docker compose logs` and `bun --watch` both stay
 * greppable, and so a log drain can parse it without a codec.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack };
    }
    return v;
  });
}

export interface Logger {
  child(fields: Record<string, unknown>): Logger;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(
  level: LogLevel,
  base: Record<string, unknown> = {},
): Logger {
  return {
    child(fields) {
      return createLogger(level, { ...base, ...fields });
    },
    debug(message, fields) {
      if (LEVELS[level] > LEVELS.debug) return;
      console.log(serialize({ level: "debug", message, ...base, ...fields }));
    },
    info(message, fields) {
      if (LEVELS[level] > LEVELS.info) return;
      console.log(serialize({ level: "info", message, ...base, ...fields }));
    },
    warn(message, fields) {
      if (LEVELS[level] > LEVELS.warn) return;
      console.log(serialize({ level: "warn", message, ...base, ...fields }));
    },
    error(message, fields) {
      if (LEVELS[level] > LEVELS.error) return;
      console.error(serialize({ level: "error", message, ...base, ...fields }));
    },
  };
}