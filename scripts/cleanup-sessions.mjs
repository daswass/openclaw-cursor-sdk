#!/usr/bin/env node
/**
 * Cursor SDK + OpenClaw session hygiene.
 *
 * Default: dry-run. Pass --apply to delete files.
 *
 *   node scripts/cleanup-sessions.mjs
 *   node scripts/cleanup-sessions.mjs --apply
 *   node scripts/cleanup-sessions.mjs --apply --prune-openclaw-artifacts
 */

import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_BINDING_RETENTION_DAYS = 30;
const DEFAULT_DELETED_ARTIFACT_DAYS = 14;
const DEFAULT_ARTIFACT_RETENTION_DAYS = 30;

const OPENCLAW_HOME = path.join(homedir(), ".openclaw");
const BINDINGS_DIR = path.join(OPENCLAW_HOME, "state", "cursor-sdk");
const SESSIONS_DIR = path.join(OPENCLAW_HOME, "agents", "main", "sessions");
const SESSIONS_STORE = path.join(SESSIONS_DIR, "sessions.json");

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const pruneArtifacts = argv.includes("--prune-openclaw-artifacts");
  const json = argv.includes("--json");
  const bindingDays = readDaysFlag(argv, "--binding-retention-days", DEFAULT_BINDING_RETENTION_DAYS);
  const deletedDays = readDaysFlag(argv, "--deleted-artifact-days", DEFAULT_DELETED_ARTIFACT_DAYS);
  const artifactDays = readDaysFlag(argv, "--artifact-retention-days", DEFAULT_ARTIFACT_RETENTION_DAYS);
  return { apply, pruneArtifacts, json, bindingDays, deletedDays, artifactDays };
}

function readDaysFlag(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return fallback;
  }
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function daysAgoMs(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

async function loadSessionsStore() {
  try {
    const raw = await readFile(SESSIONS_STORE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { bySessionId: new Map(), sessionFiles: new Set() };
    }
    const bySessionId = new Map();
    const sessionFiles = new Set();
    for (const entry of Object.values(parsed)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const sessionId = entry.sessionId;
      if (typeof sessionId === "string" && sessionId.trim()) {
        bySessionId.set(sessionId.trim(), entry);
      }
      if (typeof entry.sessionFile === "string" && entry.sessionFile.trim()) {
        sessionFiles.add(path.resolve(entry.sessionFile.trim()));
      }
    }
    return { bySessionId, sessionFiles };
  } catch (err) {
    if (err && typeof err === "object" && err.code === "ENOENT") {
      return { bySessionId: new Map(), sessionFiles: new Set() };
    }
    throw err;
  }
}

async function planBindingCleanup({ bySessionId, bindingDays }) {
  const cutoffMs = daysAgoMs(bindingDays);
  const planned = [];
  let bytes = 0;

  let names;
  try {
    names = await readdir(BINDINGS_DIR);
  } catch (err) {
    if (err && typeof err === "object" && err.code === "ENOENT") {
      return { planned, bytes };
    }
    throw err;
  }

  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(BINDINGS_DIR, name);
    const sessionId = name.slice(0, -".json".length);
    const entry = bySessionId.get(sessionId);
    let reason;
    if (!entry) {
      reason = "orphan (session not in sessions.json)";
    } else {
      const lastMs = resolveLastInteractionMs(entry);
      const bindingUpdatedMs = await readBindingUpdatedMs(filePath);
      const staleSession = lastMs > 0 && lastMs < cutoffMs;
      const staleBinding = bindingUpdatedMs > 0 && bindingUpdatedMs < cutoffMs;
      if (staleSession && staleBinding) {
        reason = `stale (no interaction in ${bindingDays}d)`;
      }
    }
    if (!reason) {
      continue;
    }
    const fileStat = await stat(filePath);
    bytes += fileStat.size;
    planned.push({ filePath, sessionId, reason, bytes: fileStat.size });
  }

  return { planned, bytes };
}

function resolveLastInteractionMs(entry) {
  const candidates = [entry.lastInteractionAt, entry.updatedAt, entry.sessionStartedAt, entry.startedAt];
  for (const value of candidates) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    return value > 1e12 ? value : value * 1000;
  }
  return 0;
}

async function readBindingUpdatedMs(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const updatedAt = parsed?.updatedAt;
    if (typeof updatedAt !== "string") {
      return 0;
    }
    const ms = Date.parse(updatedAt);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

async function planOpenClawArtifactCleanup({ bySessionId, sessionFiles, deletedDays, artifactDays }) {
  const deletedCutoff = daysAgoMs(deletedDays);
  const artifactCutoff = daysAgoMs(artifactDays);
  const activeIds = new Set(bySessionId.keys());
  const planned = [];
  let bytes = 0;

  const names = await readdir(SESSIONS_DIR);
  for (const name of names) {
    const filePath = path.join(SESSIONS_DIR, name);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      continue;
    }

    if (name === "sessions.json" || name.startsWith(".usage")) {
      continue;
    }

    if (name.includes(".jsonl.deleted.")) {
      if (fileStat.mtimeMs < deletedCutoff) {
        planned.push({
          filePath,
          reason: `deleted transcript older than ${deletedDays}d`,
          bytes: fileStat.size,
        });
        bytes += fileStat.size;
      }
      continue;
    }

    const uuidMatch = name.match(/^([0-9a-f-]{36})\./);
    if (!uuidMatch) {
      continue;
    }
    const sessionId = uuidMatch[1];
    if (activeIds.has(sessionId)) {
      continue;
    }

    const resolved = path.resolve(filePath);
    if (sessionFiles.has(resolved)) {
      continue;
    }

    if (fileStat.mtimeMs >= artifactCutoff) {
      continue;
    }

    if (
      name.endsWith(".jsonl") ||
      name.endsWith(".trajectory.jsonl") ||
      name.endsWith(".trajectory-path.json") ||
      name.endsWith(".jsonl.codex-app-server.json")
    ) {
      planned.push({
        filePath,
        reason: `orphan session artifact older than ${artifactDays}d`,
        bytes: fileStat.size,
      });
      bytes += fileStat.size;
    }
  }

  return { planned, bytes };
}

async function applyDeletes(planned, apply) {
  if (!apply) {
    return 0;
  }
  let removed = 0;
  for (const item of planned) {
    await unlink(item.filePath);
    removed += 1;
  }
  return removed;
}

function formatBytes(n) {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KiB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(BINDINGS_DIR, { recursive: true });

  const store = await loadSessionsStore();
  const bindingPlan = await planBindingCleanup({
    bySessionId: store.bySessionId,
    bindingDays: args.bindingDays,
  });

  let artifactPlan = { planned: [], bytes: 0 };
  if (args.pruneArtifacts) {
    artifactPlan = await planOpenClawArtifactCleanup({
      bySessionId: store.bySessionId,
      sessionFiles: store.sessionFiles,
      deletedDays: args.deletedDays,
      artifactDays: args.artifactDays,
    });
  }

  const allPlanned = [...bindingPlan.planned, ...artifactPlan.planned];
  const totalBytes = bindingPlan.bytes + artifactPlan.bytes;
  const removed = await applyDeletes(allPlanned, args.apply);

  const report = {
    mode: args.apply ? "apply" : "dry-run",
    openclawSessions: store.bySessionId.size,
    bindings: {
      dir: BINDINGS_DIR,
      candidates: bindingPlan.planned.length,
      bytes: bindingPlan.bytes,
    },
    artifacts: args.pruneArtifacts
      ? {
          dir: SESSIONS_DIR,
          candidates: artifactPlan.planned.length,
          bytes: artifactPlan.bytes,
        }
      : { skipped: true, hint: "pass --prune-openclaw-artifacts to include" },
    totalCandidates: allPlanned.length,
    totalBytes,
    removed: args.apply ? removed : 0,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`cursor-sdk session cleanup (${report.mode})`);
  console.log(`  OpenClaw sessions in store: ${report.openclawSessions}`);
  console.log(
    `  Binding orphans/stale: ${report.bindings.candidates} (${formatBytes(report.bindings.bytes)})`,
  );
  if (args.pruneArtifacts) {
    console.log(
      `  OpenClaw artifact prune: ${report.artifacts.candidates} (${formatBytes(report.artifacts.bytes)})`,
    );
  } else {
    console.log("  OpenClaw artifact prune: skipped (use --prune-openclaw-artifacts)");
  }
  console.log(`  Total reclaimable: ${formatBytes(report.totalBytes)}`);
  if (!args.apply && allPlanned.length > 0) {
    console.log("  Re-run with --apply to delete.");
  }
  if (args.apply) {
    console.log(`  Removed ${removed} file(s).`);
  }
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
