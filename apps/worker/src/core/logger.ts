export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  child(fields: Record<string, unknown>): Logger;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel, base: Record<string, unknown> = {}): Logger {
  return {
    child(fields) { return createLogger(level, { ...base, ...fields }); },
    debug(message, fields) { if (LEVELS[level] > LEVELS.debug) return; console.log(JSON.stringify({ level: "debug", message, ...base, ...fields })); },
    info(message, fields) { if (LEVELS[level] > LEVELS.info) return; console.log(JSON.stringify({ level: "info", message, ...base, ...fields })); },
    warn(message, fields) { if (LEVELS[level] > LEVELS.warn) return; console.log(JSON.stringify({ level: "warn", message, ...base, ...fields })); },
    error(message, fields) { if (LEVELS[level] > LEVELS.error) return; console.error(JSON.stringify({ level: "error", message, ...base, ...fields })); },
  };
}