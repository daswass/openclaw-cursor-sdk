import { CursorAgentError } from "@cursor/sdk";
import { isBenignCursorConnectTransportError } from "./connect-guard.mjs";

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_BASE_MS = 2000;
export const DEFAULT_RETRY_MAX_MS = 15000;
export const FAST_FAILURE_RETRY_MS = 5000;

export function retryDelayMs(attempt) {
  const exponential = DEFAULT_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, DEFAULT_RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * 500);
  return capped + jitter;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableCursorSdkError(err) {
  if (err instanceof CursorAgentError && err.isRetryable) {
    return true;
  }
  return isBenignCursorConnectTransportError(err);
}

export function isRetryableCursorSdkRunFailure({ elapsedMs, lastError }) {
  if (typeof lastError === "string" && lastError.trim()) {
    if (isBenignCursorConnectTransportError({ message: lastError })) {
      return true;
    }
  }
  return typeof elapsedMs === "number" && elapsedMs >= 0 && elapsedMs < FAST_FAILURE_RETRY_MS;
}
