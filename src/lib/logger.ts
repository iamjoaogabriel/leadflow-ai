// src/lib/logger.ts
//
// Tiny structured logger. Zero dependencies — writes JSON lines to stdout
// in production (so log aggregators can parse them) and pretty-prints in
// development.
//
// Usage:
//   import { logger } from "@/lib/logger";
//   const log = logger.child({ module: "ai-engine" });
//   log.info("lead received", { accountId, leadId, channel });
//   log.error("llm failed", { accountId, err });
//
// Rationale: we avoid pino/winston because they pull in a lot (streams,
// transports, worker threads) and this SaaS runs in Next.js edge/server
// where keeping the bundle lean matters.

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const ENV_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase() as Level;
const MIN_LEVEL = LEVEL_ORDER[ENV_LEVEL] ?? LEVEL_ORDER.info;
const IS_PROD = process.env.NODE_ENV === "production";

export interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
  child: (ctx: Record<string, unknown>) => Logger;
}

function emit(
  level: Level,
  baseCtx: Record<string, unknown>,
  msg: string,
  ctx?: Record<string, unknown>
) {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...baseCtx,
    ...sanitize(ctx),
  };

  if (IS_PROD) {
    // One JSON per line — log aggregators love this
    const out = JSON.stringify(payload);
    if (level === "error") console.error(out);
    else if (level === "warn") console.warn(out);
    else console.log(out);
  } else {
    // Pretty-print for humans
    const ctxOut =
      Object.keys(payload).length > 3
        ? " " + JSON.stringify(omit(payload, ["ts", "level", "msg"]))
        : "";
    const prefix = `[${level.toUpperCase()}]`;
    const line = `${prefix} ${msg}${ctxOut}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

function sanitize(ctx?: Record<string, unknown>): Record<string, unknown> {
  if (!ctx) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, stack: v.stack };
    } else {
      out[k] = v;
    }
  }
  return out;
}

function omit<T extends Record<string, unknown>>(
  obj: T,
  keys: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

function build(base: Record<string, unknown>): Logger {
  return {
    debug: (msg, ctx) => emit("debug", base, msg, ctx),
    info: (msg, ctx) => emit("info", base, msg, ctx),
    warn: (msg, ctx) => emit("warn", base, msg, ctx),
    error: (msg, ctx) => emit("error", base, msg, ctx),
    child: (ctx) => build({ ...base, ...ctx }),
  };
}

export const logger = build({});
