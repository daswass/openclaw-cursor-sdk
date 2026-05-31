# ADR-001: Cursor SDK OpenClaw plugin

**Status:** Accepted

## Decision

Build **`openclaw-cursor-sdk`** as a **standalone OpenClaw plugin repository**, not a fork of OpenClaw core and not an extension of `openclaw-cursor-cli`.

| Item | Choice |
|------|--------|
| Plugin id | `cursor-sdk` |
| Provider prefix | `cursor-sdk/<model>` |
| Harness id | `cursor-sdk` |
| Integration | `registerAgentHarness` + `registerProvider` (Codex pattern) |
| Runtime | `@cursor/sdk` local (`Agent.create` / `Agent.resume`) |
| Auth | `CURSOR_API_KEY` env var |

## Rationale

- **Harness callbacks:** Channel thinking previews and tool progress require `onReasoningStream` and `onAgentEvent` from a native harness, not a thin CLI subprocess wrapper.
- **SDK typing:** `@cursor/sdk` exposes typed stream events (`SDKThinkingMessage`, `SDKToolUseMessage`) on `run.stream()`.
- **Separation:** `cursor-cli` remains useful for subprocess-based integrations; this plugin targets full OpenClaw agent turns.
- **Upstream surface:** Prefer plugin-only delivery; touch OpenClaw core only if harness API gaps appear.

## Coexistence with cursor-cli

| Use case | Runtime |
|----------|---------|
| OpenClaw agent harness turns | `cursor-sdk/*` |
| CLI subprocess / one-shot scripts | `cursor-cli/*` or raw SDK |
| Rollback / parallel operation | Either plugin enabled independently |

## Session binding

Store Cursor `agent_id` in OpenClaw session state. On each turn:

1. If a bound id exists → `Agent.resume(id)`
2. Else → `Agent.create(...)` and persist id after the first successful turn

Clear binding on `/new`, `/reset`, and harness `reset()`.

## Stream mapping

| SDK event | Harness callback |
|-----------|------------------|
| `thinking` | `onReasoningStream` |
| `assistant` (text blocks) | `onPartialReply` |
| `tool_call` (`running`) | `onAgentEvent` → `stream: "tool"`, `phase: "start"` |
| `tool_call` (`completed` / `error`) | `onAgentEvent` → `stream: "tool"`, `phase: "result"` |
| `status` (`ERROR`) | terminal error metadata |

## Model catalog

Phase 1: static allowlist in plugin + `npm run models` helper using `Cursor.models.list()`.

Phase 2: dynamic refresh hook mirroring the cursor-cli catalog sync pattern.

## Related

- [`openclaw-cursor-cli`](https://github.com/jeehou/openclaw-cursor-cli) — CLI subprocess plugin
- OpenClaw bundled Codex harness — reference implementation for harness lifecycle
