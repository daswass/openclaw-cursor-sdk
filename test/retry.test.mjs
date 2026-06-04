import assert from "node:assert/strict";
import test from "node:test";
import { ConnectError } from "@connectrpc/connect";
import {
  isRetryableCursorSdkError,
  isRetryableCursorSdkRunFailure,
  retryDelayMs,
} from "../src/retry.mjs";

test("retryDelayMs uses exponential backoff with cap", () => {
  // Arrange // Act // Assert
  assert.ok(retryDelayMs(1) >= 2000 && retryDelayMs(1) <= 2500);
  assert.ok(retryDelayMs(2) >= 4000 && retryDelayMs(2) <= 4500);
  assert.ok(retryDelayMs(3) >= 8000 && retryDelayMs(3) <= 8500);
  assert.ok(retryDelayMs(10) <= 15500);
});

test("isRetryableCursorSdkError recognizes benign transport faults", () => {
  // Arrange
  const err = new ConnectError("[internal] write ECANCELED");

  // Act // Assert
  assert.equal(isRetryableCursorSdkError(err), true);
});

test("isRetryableCursorSdkRunFailure retries fast generic SDK failures", () => {
  // Arrange // Act // Assert
  assert.equal(
    isRetryableCursorSdkRunFailure({ elapsedMs: 1700, lastError: null }),
    true,
  );
  assert.equal(
    isRetryableCursorSdkRunFailure({ elapsedMs: 12000, lastError: null }),
    false,
  );
});

test("isRetryableCursorSdkRunFailure retries when stream state captured transport text", () => {
  // Arrange // Act // Assert
  assert.equal(
    isRetryableCursorSdkRunFailure({
      elapsedMs: 9000,
      lastError: "Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM",
    }),
    true,
  );
});
