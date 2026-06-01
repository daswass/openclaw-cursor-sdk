# Known issues

## Telegram: reasoning visible but no tool progress

**Symptom:** Live reasoning/thinking previews appear, but no tool progress lines (read, grep, shell, etc.) in Telegram.

**Checklist:**

1. **`/reasoning off` recommended** — Codex-like UX: tool progress on the answer lane, no thinking noise. `/reasoning on` disables tool previews; `/reasoning stream` shows thinking drafts (only if plugin `streamThinkingToChannels: true`).
2. **SDK-native tools only** — Tool progress shows Cursor SDK tools (`read`, `grep`, `shell`, …), **not** OpenClaw plugin tools (Trello, skills, exec approvals). Those run outside the SDK harness.
3. **Prompt must invoke SDK tools** — Try: `Read TOOLS.md and reply with the first heading only.`
4. **Restart gateway** after plugin changes (`plugins.load.paths` loads the local clone).
5. **Event shape** — `stream-bridge.mjs` maps both `tool_call` stream events and `tool_use` blocks inside assistant messages to `onAgentEvent({ stream: "tool" })`.

## Telegram tool-progress drafts may linger (partial streaming mode)

**Symptom:** After a turn that used Cursor-native tools (read, shell, grep, etc.), a Telegram preview bubble showing tool progress may remain visible after the final answer lands. Reasoning previews clear correctly.

**Cause:** OpenClaw Telegram `streaming.mode: partial` stores tool progress in the answer draft lane. Rotating from a tool-only draft to the final answer uses `stop()` + `forceNewMessage()` and can leave the old preview message orphaned.

**Do not fix locally with `stream.clear()` in `rotateAnswerLaneAfterToolProgress`:** A local patch that called `clear()` there also deleted final answers on some turns (2026-05-31).

**Status:** Plugin harness emits correct `stream: tool` events and `onAssistantMessageStart` at first assistant text. Needs an **upstream OpenClaw fix** to delete only tool-only drafts without clearing the answer lane.

**Workaround:** Ignore stale tool preview messages, or switch to `channels.telegram.streaming.mode: progress` if acceptable for your UX.

## OpenClaw core patch tracking

If applying a local Telegram fix, track it outside the plugin repo (see WassClaw Trello: OpenClaw local patch card). Re-verify after every `npm update openclaw`.
