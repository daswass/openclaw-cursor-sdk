import assert from "node:assert/strict";
import test from "node:test";
import { withCursorSdkConnectionGate } from "../src/connection-gate.mjs";

test("withCursorSdkConnectionGate serializes concurrent callers", async () => {
  // Arrange
  const order = [];
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const first = withCursorSdkConnectionGate(async () => {
    order.push("first-start");
    await delay(30);
    order.push("first-end");
  });
  const second = withCursorSdkConnectionGate(async () => {
    order.push("second-start");
    await delay(10);
    order.push("second-end");
  });

  // Act
  await Promise.all([first, second]);

  // Assert
  assert.deepEqual(order, [
    "first-start",
    "first-end",
    "second-start",
    "second-end",
  ]);
});
