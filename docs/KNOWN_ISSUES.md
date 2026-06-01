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

**Do not fix in local OpenClaw core** unless you explicitly want that maintenance burden. A `stream.clear()` patch deleted final answers on some turns (2026-05-31). Deleting by `messageId` works but belongs upstream (Trello UiIqeg7M), not in the plugin repo.

**Status (2026-06-01):**
- **Plugin** (`stream-bridge.mjs`): Codex harness semantics for **in-turn** tool line replacement — `suppressChannelProgress` on item events; `onAssistantMessageStart` before `tool_use` and after each tool `result`.
- **End-of-turn orphan** (stale `📖 Read: ...` bubble above final answer): OpenClaw Telegram `partial` mode leaves the tool-only preview message when the answer lane rotates. Cursor SDK often streams tools first, then assistant text, so the channel marks the draft as non–tool-only before cleanup runs. Codex frequently interleaves assistant deltas earlier, so the same core path behaves better. **Not fixable from the plugin alone** (no API to delete Telegram messages).

**Workarounds:** Ignore the stale bubble; or set `channels.telegram.streaming.mode` to `progress` in `openclaw.json` and test whether UX is acceptable.

## OpenClaw core patch tracking

If applying a local Telegram fix, track it outside the plugin repo (see WassClaw Trello: OpenClaw local patch card). Re-verify after every `npm update openclaw`.
