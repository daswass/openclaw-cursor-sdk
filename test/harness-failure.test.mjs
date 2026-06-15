import assert from "node:assert/strict";
import test from "node:test";
import { buildFailureResult } from "../src/harness-result.mjs";

test("failure result is replay-safe before any mutating tool starts", () => {
  const result = buildFailureResult({ sessionId: "s1" }, "boom", {
    hadPotentialSideEffects: false,
    toolMetas: [],
    itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
  });

  assert.equal(result.replayMetadata.hadPotentialSideEffects, false);
  assert.equal(result.replayMetadata.replaySafe, true);
  assert.deepEqual(result.itemLifecycle, { startedCount: 1, completedCount: 1, activeCount: 0 });
});

test("failure result after mutating tool start is not replay-safe", () => {
  const result = buildFailureResult({ sessionId: "s2" }, "boom", {
    hadPotentialSideEffects: true,
    toolMetas: [{ toolName: "shell", meta: { command: "git commit" } }],
    itemLifecycle: { startedCount: 1, completedCount: 0, activeCount: 1 },
  });

  assert.equal(result.replayMetadata.hadPotentialSideEffects, true);
  assert.equal(result.replayMetadata.replaySafe, false);
  assert.deepEqual(result.toolMetas, [{ toolName: "shell", meta: { command: "git commit" } }]);
  assert.deepEqual(result.itemLifecycle, { startedCount: 1, completedCount: 0, activeCount: 1 });
});
