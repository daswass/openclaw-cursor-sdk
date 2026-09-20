import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFailureResult,
  buildSuccessResult,
  isModelFallbackAttempt,
} from "../src/harness-result.mjs";

test("failure result is replay-safe before any mutating tool starts", () => {
  const result = buildFailureResult({ sessionId: "s1" }, "boom", {
    hadPotentialSideEffects: false,
    toolMetas: [],
    itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
  });

  assert.equal(result.replayMetadata.hadPotentialSideEffects, false);
  assert.equal(result.replayMetadata.replaySafe, true);
  assert.equal(result.agentHarnessResultClassification, "empty");
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
  assert.equal(result.agentHarnessResultClassification, "empty");
  assert.deepEqual(result.toolMetas, [{ toolName: "shell", meta: { command: "git commit" } }]);
  assert.deepEqual(result.itemLifecycle, { startedCount: 1, completedCount: 0, activeCount: 1 });
});

test("success result includes assistantTexts and stopReason stop", () => {
  const result = buildSuccessResult(
    { sessionId: "s3", provider: "cursor-sdk", modelId: "default" },
    {
      reasoningText: "",
      toolMetas: [],
      hadPotentialSideEffects: false,
      itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
    },
    "agent-1",
    "ui-ok",
  );

  assert.deepEqual(result.assistantTexts, ["ui-ok"]);
  assert.equal(result.lastAssistant?.stopReason, "stop");
  assert.equal(result.promptError, null);
  assert.equal(result.promptErrorSource, null);
  assert.equal(result.agentHarnessResultClassification, undefined);
  assert.equal(result.cursorSdkAgentId, "agent-1");
});

test("success with empty text classifies as empty for failover", () => {
  const result = buildSuccessResult(
    { sessionId: "s4", provider: "cursor-sdk", modelId: "default" },
    {
      reasoningText: "",
      toolMetas: [],
      hadPotentialSideEffects: false,
      itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
    },
    "agent-2",
    "   ",
  );

  assert.deepEqual(result.assistantTexts, []);
  assert.equal(result.lastAssistant, undefined);
  assert.equal(result.agentHarnessResultClassification, "empty");
});

test("isModelFallbackAttempt detects OpenClaw routing provenance", () => {
  assert.equal(isModelFallbackAttempt({}), false);
  assert.equal(isModelFallbackAttempt({ isFallbackRetry: true }), true);
  assert.equal(
    isModelFallbackAttempt({ modelRoutingProvenance: { stage: "fallback" } }),
    true,
  );
  assert.equal(
    isModelFallbackAttempt({
      modelRoutingProvenance: { stage: "initial", fallbackReason: "rate_limit" },
    }),
    true,
  );
  assert.equal(
    isModelFallbackAttempt({ modelRoutingProvenance: { stage: "initial" } }),
    false,
  );
});
