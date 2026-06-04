/**
 * Keep transient Cursor SDK transport faults from crashing the gateway.
 *
 * @connectrpc/connect-node rejects internal sentinel promises when an HTTP/2
 * stream is reset or cancelled (e.g. NGHTTP2_ENHANCE_YOUR_CALM rate limits, or
 * `write ECANCELED` during agent teardown). Some of these promises are not
 * awaited by our harness (they fire during background transport cleanup), so
 * they surface as unhandled rejections.
 *
 * OpenClaw's process-level unhandledRejection handler consults a shared Set of
 * opt-in handlers BEFORE deciding to exit: if any handler returns true, the
 * rejection is treated as handled and the process keeps running. We register
 * into that Set (via its well-known global Symbol) so these benign Cursor
 * transport faults degrade to a no-op instead of a fatal crash + restart loop.
 * The actual agent turn still fails over to the cursor-cli fallback through the
 * harness result path.
 */

const HANDLERS_GLOBAL_KEY = Symbol.for("openclaw.unhandledRejection.handlers");
const GUARD_INSTALLED_KEY = Symbol.for("openclaw.cursor-sdk.connectGuardInstalled");

const BENIGN_CONNECT_MARKERS = [
  "NGHTTP2_ENHANCE_YOUR_CALM",
  "NGHTTP2_INTERNAL_ERROR",
  "write ECANCELED",
  "ECANCELED",
  "ERR_STREAM_WRITE_AFTER_END",
  "Stream closed with error code",
];

function* errorGraph(reason, depth = 0) {
  if (!reason || typeof reason !== "object" || depth > 6) {
    return;
  }
  yield reason;
  const nested = [reason.cause, reason.reason, reason.error, reason.original];
  if (Array.isArray(reason.errors)) {
    nested.push(...reason.errors);
  }
  for (const child of nested) {
    yield* errorGraph(child, depth + 1);
  }
}

export function isBenignCursorConnectTransportError(reason) {
  for (const candidate of errorGraph(reason)) {
    const name = String(candidate.name ?? "");
    const message = String(candidate.message ?? "");
    if (name !== "ConnectError" && !message) {
      continue;
    }
    const haystack = `${name} ${message}`;
    if (BENIGN_CONNECT_MARKERS.some((marker) => haystack.includes(marker))) {
      return true;
    }
  }
  return false;
}

function resolveHandlerSet() {
  const existing = globalThis[HANDLERS_GLOBAL_KEY];
  if (existing instanceof Set) {
    return existing;
  }
  // Mirror OpenClaw's lazy init so its handler installer reuses this same Set
  // regardless of which module touches the global first.
  const created = new Set();
  globalThis[HANDLERS_GLOBAL_KEY] = created;
  return created;
}

export function installCursorConnectTransportGuard() {
  if (globalThis[GUARD_INSTALLED_KEY]) {
    return;
  }
  const handlers = resolveHandlerSet();
  const handler = (reason) => {
    if (!isBenignCursorConnectTransportError(reason)) {
      return false;
    }
    console.warn(
      "[cursor-sdk] suppressed benign Cursor transport rejection:",
      String(reason?.message ?? reason),
    );
    return true;
  };
  handlers.add(handler);
  globalThis[GUARD_INSTALLED_KEY] = handler;
}
