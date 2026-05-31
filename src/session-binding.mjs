import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const BINDINGS_DIR = path.join(homedir(), ".openclaw", "state", "cursor-sdk");

function bindingPath(openClawSessionId) {
  const safe = openClawSessionId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(BINDINGS_DIR, `${safe}.json`);
}

export async function readCursorSdkAgentId(openClawSessionId) {
  if (!openClawSessionId?.trim()) {
    return undefined;
  }
  try {
    const raw = await readFile(bindingPath(openClawSessionId), "utf-8");
    const parsed = JSON.parse(raw);
    const agentId = parsed?.agentId;
    return typeof agentId === "string" && agentId.trim() ? agentId.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCursorSdkAgentId(openClawSessionId, agentId) {
  if (!openClawSessionId?.trim() || !agentId?.trim()) {
    return;
  }
  await mkdir(BINDINGS_DIR, { recursive: true });
  await writeFile(
    bindingPath(openClawSessionId),
    JSON.stringify({ agentId: agentId.trim(), updatedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

export async function clearCursorSdkAgentId(openClawSessionId) {
  if (!openClawSessionId?.trim()) {
    return;
  }
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(bindingPath(openClawSessionId));
  } catch {
    // missing file is fine
  }
}
