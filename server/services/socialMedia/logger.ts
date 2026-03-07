import fs from "fs";
import path from "path";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  component: string;
  event: string;
  metadata?: Record<string, unknown>;
}

export interface Logger {
  info(event: string, metadata?: Record<string, unknown>): void;
  warn(event: string, metadata?: Record<string, unknown>): void;
  error(event: string, metadata?: Record<string, unknown>): void;
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.resolve(`logs/social-agent-${date}.log`);
}

function writeEntry(entry: LogEntry): void {
  const line = JSON.stringify(entry) + "\n";
  if (process.env.NODE_ENV === "production" && process.env.AGENT_DRY_RUN !== "true") {
    try {
      const logPath = getLogFilePath();
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, line);
    } catch {
      // fall through to console
    }
  }
  console.log(line.trimEnd());
}

export function createLogger(component: string): Logger {
  return {
    info(event: string, metadata?: Record<string, unknown>) {
      writeEntry({ timestamp: new Date().toISOString(), level: "info", component, event, metadata });
    },
    warn(event: string, metadata?: Record<string, unknown>) {
      writeEntry({ timestamp: new Date().toISOString(), level: "warn", component, event, metadata });
    },
    error(event: string, metadata?: Record<string, unknown>) {
      writeEntry({ timestamp: new Date().toISOString(), level: "error", component, event, metadata });
    },
  };
}
