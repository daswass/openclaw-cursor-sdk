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

If applying a local Telegram fix, track it outside the plugin repo in your own issue tracker. Re-verify after every `npm update openclaw`.

## Cursor SDK: HTTP/2 transport failures (`NGHTTP2_ENHANCE_YOUR_CALM`)

**Symptom:** Telegram (or other channels) show `Agent failed before reply: Cursor SDK run failed (run-…)` after ~1–3 seconds. Gateway logs may include `ConnectError: Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM`, `write ECANCELED`, or `NGHTTP2_INTERNAL_ERROR`.

**Root cause:** The local `@cursor/sdk` runtime opens HTTP/2 streams to Cursor's API. Too many concurrent lifecycles (multiple sessions, resume bindings, rapid retries, stale local `agent` CLI processes) trigger server-side rate limiting. Retries that reconnect immediately make this worse.

**Plugin mitigations (2026-06-03):**
- Serialize SDK turns per gateway process (`connection-gate.mjs`)
- On transport failure: clear session binding and `Agent.create` fresh instead of `Agent.resume`
- Longer exponential backoff (2s base, 5 attempts) before retry
- Connect-guard suppresses benign background transport rejections so the gateway does not crash-loop

**OpenClaw failover caveat:** When a session has an explicit model override (Control UI → `cursor-sdk/…`), OpenClaw sets `fallbackConfigured: false` and will **not** auto-failover to `cursor-cli`. Clear the session override or switch model back to defaults to allow fallback.

**Hygiene:**
- `node scripts/cleanup-sessions.mjs --apply` — prune stale bindings
- Kill orphaned `agent --use-system-ca` processes if they accumulate
- Restart the OpenClaw gateway after plugin changes

**Status:** Under active hardening. If failures persist after gateway restart, use `cursor-cli/composer-2.5` as interim backend while investigating upstream SDK/API limits.
