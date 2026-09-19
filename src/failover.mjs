import { isBenignCursorConnectTransportError } from "./connect-guard.mjs";

const CURSOR_SDK_ERROR_PREFIX_RE =
  /^Cursor SDK (?:startup failed|run failed|error)(?::|\s*\()/i;

const UNAVAILABLE_MARKERS = [
  /network request failed/i,
  /\beconnrefused\b/i,
  /\benotfound\b/i,
  /\betimedout\b/i,
  /service unavailable/i,
  /temporarily unavailable/i,
];

const RATE_LIMIT_MARKERS = [
  /NGHTTP2_ENHANCE_YOUR_CALM/i,
  /too many requests/i,
  /\b429\b/,
  /rate limit/i,
];

const AUTH_MARKERS = [
  /\b401\b/,
  /\b403\b/,
  /unauthorized/i,
  /invalid api key/i,
  /authentication/i,
];

function stripHarnessPrefix(message) {
  return message.replace(CURSOR_SDK_ERROR_PREFIX_RE, "").trim();
}

function matchesAny(haystack, patterns) {
  return patterns.some((pattern) => pattern.test(haystack));
}

/**
 * Provider-owned failover classification for cursor-sdk harness errors.
 * OpenClaw's generic matcher often misses our prefixed strings (e.g. bare
 * "Cursor SDK run failed (run-…)"), which blocks model fallback to cursor-cli.
 */
export function classifyCursorSdkFailoverReason(ctx) {
  const message = String(ctx?.errorMessage ?? "").trim();
  if (!message) {
    return undefined;
  }

  const detail = stripHarnessPrefix(message);
  const haystack = detail ? `${message}\n${detail}` : message;

  if (isBenignCursorConnectTransportError({ message: haystack })) {
    return "rate_limit";
  }
  if (matchesAny(haystack, AUTH_MARKERS)) {
    return "auth";
  }
  if (matchesAny(haystack, RATE_LIMIT_MARKERS)) {
    return "rate_limit";
  }
  if (matchesAny(haystack, UNAVAILABLE_MARKERS)) {
    return "unavailable";
  }

  if (CURSOR_SDK_ERROR_PREFIX_RE.test(message)) {
    return "unavailable";
  }

  return undefined;
}
