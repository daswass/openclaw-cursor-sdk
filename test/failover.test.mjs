import assert from "node:assert/strict";
import test from "node:test";
import { classifyCursorSdkFailoverReason } from "../src/failover.mjs";

test("opaque Cursor SDK run failure classifies as unavailable for model fallback", () => {
  assert.equal(
    classifyCursorSdkFailoverReason({
      provider: "cursor-sdk",
      errorMessage: "Cursor SDK run failed (run-dc8f0eda-97c8-4fa5-bc9a-55304c79cc66)",
    }),
    "unavailable",
  );
});

test("network and HTTP/2 transport faults classify for failover", () => {
  assert.equal(
    classifyCursorSdkFailoverReason({
      errorMessage: "Cursor SDK startup failed: Network request failed",
    }),
    "unavailable",
  );
  assert.equal(
    classifyCursorSdkFailoverReason({
      errorMessage:
        "Cursor SDK error: Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM",
    }),
    "rate_limit",
  );
});

test("unrelated errors are not classified by the provider hook", () => {
  assert.equal(
    classifyCursorSdkFailoverReason({ errorMessage: "user cancelled turn" }),
    undefined,
  );
});
