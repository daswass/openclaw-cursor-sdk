# Known issues

## Telegram tool-progress drafts may linger (partial streaming mode)

**Symptom:** After a turn that used Cursor-native tools (read, shell, grep, etc.), a Telegram preview bubble showing tool progress may remain visible after the final answer lands. Reasoning previews clear correctly.

**Cause:** OpenClaw Telegram `streaming.mode: partial` stores tool progress in the answer draft lane. Rotating from a tool-only draft to the final answer uses `stop()` + `forceNewMessage()` and can leave the old preview message orphaned.

**Do not fix locally with `stream.clear()` in `rotateAnswerLaneAfterToolProgress`:** A local patch that called `clear()` there also deleted final answers on some turns (2026-05-31).

**Status:** Plugin harness emits correct `stream: tool` events and `onAssistantMessageStart` at first assistant text. Needs an **upstream OpenClaw fix** to delete only tool-only drafts without clearing the answer lane.

**Workaround:** Ignore stale tool preview messages, or switch to `channels.telegram.streaming.mode: progress` if acceptable for your UX.

## OpenClaw core patch tracking

If applying a local Telegram fix, track it outside the plugin repo (see WassClaw Trello: OpenClaw local patch card). Re-verify after every `npm update openclaw`.
