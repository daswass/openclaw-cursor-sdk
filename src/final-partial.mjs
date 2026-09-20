/**
 * Re-emit the authoritative final answer as a channel partial with `replace`.
 *
 * Tool boundaries clear the live draft (`onAssistantMessageStart`). If the host
 * never materializes `assistantTexts` / `messagesSnapshot` into transcript
 * (seen on some OpenClaw failover paths), this gives webchat/Telegram one last
 * chance to land visible text before the turn settles.
 */
export async function flushFinalPartialReply(callbacks, finalText) {
  const text = typeof finalText === "string" ? finalText.trim() : "";
  if (!text || !callbacks?.onPartialReply) {
    return false;
  }
  if (callbacks.onAssistantMessageStart) {
    await callbacks.onAssistantMessageStart();
  }
  await callbacks.onPartialReply({
    text,
    delta: text,
    replace: true,
  });
  return true;
}
