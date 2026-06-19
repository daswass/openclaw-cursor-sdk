# Headroom compression spike

## Decision

Add `headroom-ai` to `openclaw-cursor-sdk` as a disabled-by-default experiment.

This is intentionally **not** an OpenClaw-wide integration yet.

## Why

Headroom may reduce token load from large context, logs, and tool outputs. The likely high-value target is tool-output/log compression, but Cursor SDK currently abstracts the internal tool-result-to-model channel. This repo can only safely intercept the prompt passed to `agent.send(...)` without patching Cursor internals.

## Current implementation

- `src/headroom.mjs` resolves config and wraps `headroom-ai`'s `compress()` API.
- `src/harness.mjs` calls the adapter before `agent.send(...)`.
- Default: disabled.
- Fallback: enabled by default; Headroom failures preserve the original prompt.
- Telemetry: emits an `onExecutionPhase` event named `headroom_compression` only when compression applies or errors.

## Config

```json
{
  "headroom": {
    "enabled": false,
    "baseUrl": "http://localhost:8787",
    "apiKey": "optional",
    "model": "optional-tokenizer-model",
    "tokenBudget": 100000,
    "timeoutMs": 15000,
    "minInputChars": 12000,
    "fallback": true
  }
}
```

Environment shortcut:

```bash
CURSOR_SDK_HEADROOM_ENABLED=true
```

## Explicit non-goals for the first spike

Do not enable these yet:

- Cross-agent memory
- Output shaping
- `headroom learn`
- Compression of reasoning-critical conversation history
- Blind proxying of all Cursor SDK traffic

## Blocker for the real prize

True compression of large tool outputs/logs requires an interception point before Cursor feeds tool results back to its model. In current `@cursor/sdk`, the public wrapper sees stream events after the fact, not a mutable middleware channel for internal tool results.

Possible next routes:

1. Ask/inspect Cursor SDK for a local runtime resource wrapper/hook that can rewrite tool result payloads.
2. Integrate at OpenClaw's ContextEngine/tool-result layer before handing context to any harness.
3. Use Headroom's OpenClaw plugin path only after replay/eval proves behavior safety.

## Evaluation plan

Replay saved sessions and compare:

- Answer quality
- Tool-call correctness
- Token reduction
- Latency overhead
- Cases where compression hides details needed for a fix
