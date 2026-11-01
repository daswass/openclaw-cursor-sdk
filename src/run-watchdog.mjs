/**
 * Abort / idle / hard-timeout races for Cursor SDK turns.
 *
 * OpenClaw's abortSignal alone does not stop a hung `for await` stream or
 * `run.wait()` — without an explicit race, one stalled SDK turn holds the
 * connection gate and blocks every other cursor-sdk session.
 */

export const DEFAULT_IDLE_TIMEOUT_MS = 180_000;
export const DEFAULT_RUN_TIMEOUT_MS = 600_000;

export class CursorSdkWatchdogError extends Error {
  /**
   * @param {string} message
   * @param {{ kind: "idle" | "run" | "abort"; idleTimedOut?: boolean; timedOut?: boolean; aborted?: boolean }} flags
   */
  constructor(message, flags) {
    super(message);
    this.name = "CursorSdkWatchdogError";
    this.kind = flags.kind;
    this.idleTimedOut = flags.idleTimedOut === true;
    this.timedOut = flags.timedOut === true;
    this.aborted = flags.aborted === true;
  }
}

function toPositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

/**
 * @param {Record<string, unknown> | null | undefined} pluginConfig
 */
export function resolveWatchdogConfig(pluginConfig = {}) {
  return {
    idleTimeoutMs: toPositiveInteger(pluginConfig.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS),
    runTimeoutMs: toPositiveInteger(pluginConfig.runTimeoutMs, DEFAULT_RUN_TIMEOUT_MS),
  };
}

/**
 * @param {number} ms
 * @param {() => Error} createError
 * @returns {{ promise: Promise<never>; clear: () => void }}
 */
export function rejectAfter(ms, createError) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(createError());
    }, ms);
    // Do not keep the gateway event loop alive solely for a watchdog timer.
    if (typeof timer?.unref === "function") {
      timer.unref();
    }
  });
  return {
    promise,
    clear() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * @param {AbortSignal | null | undefined} signal
 * @returns {{ promise: Promise<never>; clear: () => void }}
 */
export function rejectOnAbort(signal) {
  if (!signal) {
    return {
      promise: new Promise(() => {}),
      clear() {},
    };
  }
  if (signal.aborted) {
    return {
      promise: Promise.reject(
        new CursorSdkWatchdogError("Cursor SDK run aborted", {
          kind: "abort",
          aborted: true,
        }),
      ),
      clear() {},
    };
  }
  let onAbort;
  const promise = new Promise((_, reject) => {
    onAbort = () => {
      reject(
        new CursorSdkWatchdogError("Cursor SDK run aborted", {
          kind: "abort",
          aborted: true,
        }),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    clear() {
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

/**
 * Race a promise against optional idle timeout + abort signal.
 * Idle timer is for a single await (e.g. next stream event).
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {{ idleTimeoutMs?: number; abortSignal?: AbortSignal | null }} options
 * @returns {Promise<T>}
 */
export async function raceWithIdleAndAbort(promise, options = {}) {
  const idleTimeoutMs = options.idleTimeoutMs;
  const guards = [];
  try {
    if (typeof idleTimeoutMs === "number" && idleTimeoutMs > 0) {
      guards.push(
        rejectAfter(
          idleTimeoutMs,
          () =>
            new CursorSdkWatchdogError(
              `Cursor SDK stream idle for ${idleTimeoutMs}ms with no progress`,
              { kind: "idle", idleTimedOut: true, timedOut: true },
            ),
        ),
      );
    }
    guards.push(rejectOnAbort(options.abortSignal));
    return await Promise.race([promise, ...guards.map((g) => g.promise)]);
  } finally {
    for (const guard of guards) {
      guard.clear();
    }
  }
}

/**
 * Race stream drain + run.wait against hard run timeout and abort.
 *
 * @template T
 * @param {Promise<T>} completionPromise
 * @param {{ runTimeoutMs?: number; abortSignal?: AbortSignal | null }} options
 * @returns {Promise<T>}
 */
export async function raceWithRunTimeoutAndAbort(completionPromise, options = {}) {
  const runTimeoutMs = options.runTimeoutMs;
  const guards = [];
  try {
    if (typeof runTimeoutMs === "number" && runTimeoutMs > 0) {
      guards.push(
        rejectAfter(
          runTimeoutMs,
          () =>
            new CursorSdkWatchdogError(
              `Cursor SDK run exceeded hard timeout of ${runTimeoutMs}ms`,
              { kind: "run", timedOut: true },
            ),
        ),
      );
    }
    guards.push(rejectOnAbort(options.abortSignal));
    return await Promise.race([completionPromise, ...guards.map((g) => g.promise)]);
  } finally {
    for (const guard of guards) {
      guard.clear();
    }
  }
}
