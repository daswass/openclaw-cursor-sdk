/**
 * Serialize Cursor SDK HTTP/2 lifecycles within one gateway process.
 *
 * Concurrent Agent.create / Agent.resume / stream drains compete for HTTP/2
 * streams against Cursor's API. NGHTTP2_ENHANCE_YOUR_CALM is the server telling
 * the client to slow down — retries without serialization make that worse.
 */

let activeTurn = null;
const waitQueue = [];

function releaseTurn() {
  activeTurn = null;
  const next = waitQueue.shift();
  if (next) {
    activeTurn = next;
    next();
  }
}

export async function withCursorSdkConnectionGate(fn) {
  await new Promise((resolve) => {
    if (!activeTurn) {
      activeTurn = resolve;
      resolve();
      return;
    }
    waitQueue.push(resolve);
  });

  try {
    return await fn();
  } finally {
    releaseTurn();
  }
}
