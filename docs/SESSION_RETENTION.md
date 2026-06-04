# Cursor SDK session retention

## What accumulates

| Location | Size (typical) | Owner | Safe to prune? |
|----------|------------------|-------|----------------|
| `~/.openclaw/state/cursor-sdk/*.json` | Small (~4 KB each) | **Plugin** — OpenClaw `sessionId` → Cursor `agentId` | Yes, when orphan or stale |
| `~/.openclaw/agents/main/sessions/sessions.json` | ~1 MB | **OpenClaw** — session index | No |
| `~/.openclaw/agents/main/sessions/*.jsonl` | Large (hundreds of MB) | **OpenClaw** — transcripts | Only with artifact flags |
| Cursor cloud agents | N/A (remote) | **Cursor API** | Clearing a binding does not delete remote agents |

The plugin only controls **binding files**. Most disk growth is shared OpenClaw session transcripts, not Cursor SDK–specific.

## Default policy

### Binding files (plugin)

Delete `~/.openclaw/state/cursor-sdk/<sessionId>.json` when:

1. **Orphan** — `sessionId` is not present in `agents/main/sessions/sessions.json`, or
2. **Stale** — binding `updatedAt` and session `lastInteractionAt` are both older than **30 days**.

**Never** delete bindings for sessions still listed in `sessions.json` with recent activity.

Effect: next turn calls `Agent.create()` instead of `Agent.resume()`. OpenClaw transcript/history is unchanged.

### OpenClaw session artifacts (optional)

Use `--prune-openclaw-artifacts` only when you accept broader cleanup:

- `*.jsonl.deleted.*` older than **14 days**
- Orphan `UUID.*` sidecar files (trajectory, deleted markers) older than **30 days** where `UUID` is not an active `sessionId` and not referenced by `sessionFile`

Does **not** delete active `sessionFile` paths from the store.

## Commands

From the plugin repo (dry-run default):

```bash
cd repos/openclaw-cursor-sdk
node scripts/cleanup-sessions.mjs
node scripts/cleanup-sessions.mjs --apply
node scripts/cleanup-sessions.mjs --apply --prune-openclaw-artifacts
```

Scheduled maintenance (recommended weekly):

```bash
openclaw sessions cleanup --all-agents --enforce
node scripts/cleanup-sessions.mjs --apply --prune-openclaw-artifacts
```

Run via cron, LaunchAgent, or an OpenClaw scheduled job. For bindings only (no artifact prune): `node scripts/cleanup-sessions.mjs --apply`.

## Operator checklist

1. Dry-run: `node scripts/cleanup-sessions.mjs`
2. Review counts (orphan bindings vs artifact prune)
3. Apply bindings only: `node scripts/cleanup-sessions.mjs --apply`
4. After OpenClaw upgrades, re-run dry-run (paths unchanged)
5. Use `/reset` or harness `reset` to clear a single session binding without deleting transcripts

## Inventory snapshot

Dry-run output reports orphan vs stale binding counts and optional artifact prune candidates. Orphan bindings are common when sessions are removed from the store but binding files remain.
