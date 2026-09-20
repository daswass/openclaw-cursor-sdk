import assert from "node:assert/strict";
import test from "node:test";
import { flushFinalPartialReply } from "../src/final-partial.mjs";

test("flushFinalPartialReply emits replace partial and boundary", async () => {
  const calls = [];
  const ok = await flushFinalPartialReply(
    {
      onAssistantMessageStart: async () => {
        calls.push("start");
      },
      onPartialReply: async (payload) => {
        calls.push(payload);
      },
    },
    "  final answer  ",
  );
  assert.equal(ok, true);
  assert.equal(calls[0], "start");
  assert.deepEqual(calls[1], {
    text: "final answer",
    delta: "final answer",
    replace: true,
  });
});

test("flushFinalPartialReply no-ops on empty text", async () => {
  let called = false;
  const ok = await flushFinalPartialReply(
    {
      onPartialReply: async () => {
        called = true;
      },
    },
    "   ",
  );
  assert.equal(ok, false);
  assert.equal(called, false);
});
