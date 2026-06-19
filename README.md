# openclaw-cursor-sdk

OpenClaw plugin that runs agent turns through the **Cursor SDK** (`@cursor/sdk`) using a **Codex-style agent harness**. Streams tool progress to OpenClaw channels (for example Telegram live previews). SDK thinking is kept internal by default (Codex-like UX).

## Features

- **Agent harness** — `registerAgentHarness` integration with session resume via `Agent.resume`
- **Thinking stream** — optional; maps `SDKThinkingMessage` to `onReasoningStream` when `streamThinkingToChannels: true`
- **Tool progress** — maps `tool_call` events to OpenClaw `stream: "tool"` for channel progress lines
- **Provider** — registers `cursor-sdk/*` model refs

## Architecture

- **Plugin id:** `cursor-sdk`
- **Model refs:** `cursor-sdk/composer-2.5`, `cursor-sdk/auto`, …
- **Harness id:** `cursor-sdk`
- **Auth:** `CURSOR_API_KEY` environment variable (or OpenClaw provider auth)
- **Session resume:** Cursor `agent_id` persisted under the OpenClaw state directory

See [docs/ADR-001-repo-and-architecture.md](./docs/ADR-001-repo-and-architecture.md).

## Requirements

- Node.js 18+
- OpenClaw 2026.5.7+ (2026.5.12 recommended)
- A Cursor API key with SDK access

## Install

From a git checkout:

```bash
git clone https://github.com/daswass/openclaw-cursor-sdk.git
cd openclaw-cursor-sdk
npm install
openclaw plugins install .
openclaw plugins doctor
```

Or install directly from GitHub:

```bash
openclaw plugins install https://github.com/daswass/openclaw-cursor-sdk.git
```

For local development, add the checkout to `plugins.load.paths` in `openclaw.json` and restart the gateway after plugin changes.

## Configuration

Enable the plugin and wire model refs with the SDK harness runtime:

```json5
{
  plugins: {
    allow: ["cursor-sdk", "cursor-cli"],
    entries: {
      "cursor-sdk": { enabled: true }
    }
  },
  agents: {
    defaults: {
      reasoningDefault: "off",
      model: {
        primary: "cursor-sdk/composer-2.5"
      },
      models: {
        "cursor-sdk/composer-2.5": {
          agentRuntime: { id: "cursor-sdk" }
        }
      }
    }
  },
  channels: {
    telegram: {
      streaming: { mode: "partial" }
    }
  }
}
```

Set `CURSOR_API_KEY` in your environment or through OpenClaw provider auth.

### Telegram live previews (Codex-like)

Codex shows **tool progress** on the answer draft lane, not thinking text. Match that UX:

| Setting | Thinking in Telegram | Tool progress lines |
|---------|----------------------|---------------------|
| **`/reasoning off`** (recommended) | Hidden | Live (read, grep, shell, …) |
| `/reasoning stream` + plugin `streamThinkingToChannels: true` | Live reasoning draft | Live |
| `/reasoning on` | In final answer only | **Disabled** (answer draft lane off) |

Default plugin config keeps SDK thinking **off channels** (`streamThinkingToChannels: false`). Set `agents.defaults.reasoningDefault: "off"` and use `/reasoning off` in Telegram.

Tool progress shows **Cursor SDK native tools only**, not OpenClaw plugin tools (Trello, skills, etc.).

## Development

```bash
export CURSOR_API_KEY=your_key_here
npm install
npm test
npm run spike
npm run models -- composer
```

Spike examples:

```bash
# Thinking stream
npm run spike -- --prompt "Before answering, reason step by step. What is 17*23? Reply with the number only."

# Tool call stream
npm run spike -- --prompt "Read package.json and reply with the name field only."
```

Optional plugin config:

| Key | Description |
|-----|-------------|
| `cwd` | Default working directory for local SDK agents (defaults to agent workspace) |
| `defaultModel` | Fallback model id when none is resolved (default: `composer-2.5`) |
| `streamThinkingToChannels` | Forward SDK `thinking` events to Telegram reasoning drafts (default: `false`) |

## Scripts

| Script | Purpose |
|--------|---------|
| `npm test` | Stream bridge unit tests |
| `npm run spike` | SDK stream smoke test (thinking, assistant, tool_call) |
| `npm run models -- <filter>` | List models from `Cursor.models.list()` |
| `npm run refresh-models` | Print the provider catalog (live when `CURSOR_API_KEY` is set) |
| `npm run cleanup-sessions` | Dry-run orphan/stale session bindings (add `-- --apply` to delete) |

Session retention policy: [docs/SESSION_RETENTION.md](./docs/SESSION_RETENTION.md).

## Known issues

See [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) — notably Telegram tool-progress preview cleanup (needs upstream OpenClaw fix).

## Coexistence with cursor-cli

This plugin complements the CLI-based [`openclaw-cursor-cli`](https://github.com/jeehou/openclaw-cursor-cli) plugin:

| Use case | Suggested runtime |
|----------|-------------------|
| OpenClaw agent turns with harness callbacks | `cursor-sdk/*` |
| One-shot CLI scripts, subprocess integrations | `cursor-cli/*` or raw `@cursor/sdk` |

## License

MIT — see [LICENSE](./LICENSE).

### Headroom compression spike

Headroom (`headroom-ai`) is wired as an **off-by-default** experiment for compressing oversized prompts before sending them to the Cursor SDK agent:

```json
{
  "headroom": {
    "enabled": false,
    "baseUrl": "http://localhost:8787",
    "minInputChars": 12000,
    "timeoutMs": 15000,
    "fallback": true
  }
}
```

Environment shortcut: `CURSOR_SDK_HEADROOM_ENABLED=true`.

Current scope is deliberately narrow: only the initial prompt passed through this harness can be compressed. Cursor SDK does not currently expose a clean middleware hook for rewriting internal tool results before they are fed back to Cursor's model, so true large tool-output/log compression remains blocked on a lower-level SDK/OpenClaw interception point. Keep cross-agent memory, output shaping, and `headroom learn` disabled until replay/eval proves they preserve behavior.
