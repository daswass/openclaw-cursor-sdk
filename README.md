# openclaw-cursor-sdk

OpenClaw plugin that runs agent turns through the **Cursor SDK** (`@cursor/sdk`) using a **Codex-style agent harness**. Streams native thinking events and tool progress to OpenClaw channels (for example Telegram live previews).

## Features

- **Agent harness** — `registerAgentHarness` integration with session resume via `Agent.resume`
- **Thinking stream** — maps `SDKThinkingMessage` to `onReasoningStream`
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

### From ClawHub (recommended when published)

```bash
openclaw plugins install clawhub:@daswass/openclaw-cursor-sdk
openclaw plugins doctor
```

### From git

From a git checkout:

```bash
git clone https://github.com/daswass/openclaw-cursor-sdk.git
cd openclaw-cursor-sdk
npm install
openclaw plugins install .
openclaw plugins doctor
```

Or install directly:

```bash
openclaw plugins install https://github.com/daswass/openclaw-cursor-sdk.git
```

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
      reasoningDefault: "stream",
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

Set `CURSOR_API_KEY` in your environment or through OpenClaw provider auth. Restart the gateway after plugin changes.

For live thinking previews in Telegram, use `/reasoning stream`. Tool progress lines appear in the answer preview when `channels.*.streaming.preview.toolProgress` is enabled (default).

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

## Scripts

| Script | Purpose |
|--------|---------|
| `npm test` | Stream bridge unit tests |
| `npm run spike` | SDK stream smoke test (thinking, assistant, tool_call) |
| `npm run models -- <filter>` | List models from `Cursor.models.list()` |
| `npm run refresh-models` | Print the provider catalog (live when `CURSOR_API_KEY` is set) |

## Known issues

See [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) — notably Telegram tool-progress preview cleanup (needs upstream OpenClaw fix).

## Publishing to ClawHub

```bash
npm install
npm test
clawhub publish   # requires ClawHub auth; package.json has publishToClawHub: true
```

After publish, install with `openclaw plugins install clawhub:@daswass/openclaw-cursor-sdk`.

## Coexistence with cursor-cli

This plugin complements the CLI-based [`openclaw-cursor-cli`](https://github.com/jeehou/openclaw-cursor-cli) plugin:

| Use case | Suggested runtime |
|----------|-------------------|
| OpenClaw agent turns with harness callbacks | `cursor-sdk/*` |
| One-shot CLI scripts, subprocess integrations | `cursor-cli/*` or raw `@cursor/sdk` |

## License

MIT — see [LICENSE](./LICENSE).
