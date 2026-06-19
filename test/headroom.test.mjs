import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveHeadroomConfig,
  shouldCompressPrompt,
  headroomStatsFromResult,
} from "../src/headroom.mjs";

test("Headroom is disabled by default", () => {
  const config = resolveHeadroomConfig({}, {});
  assert.equal(config.enabled, false);
  assert.equal(shouldCompressPrompt("x".repeat(20_000), config), false);
});

test("Headroom can be enabled with env and respects size threshold", () => {
  const config = resolveHeadroomConfig({}, { CURSOR_SDK_HEADROOM_ENABLED: "true" });
  assert.equal(config.enabled, true);
  assert.equal(shouldCompressPrompt("small", config), false);
  assert.equal(shouldCompressPrompt("x".repeat(20_000), config), true);
});

test("plugin config overrides Headroom defaults", () => {
  const config = resolveHeadroomConfig(
    {
      headroom: {
        enabled: true,
        baseUrl: "http://localhost:8787",
        model: "gpt-4o-mini",
        minInputChars: 42,
        timeoutMs: 1000,
        fallback: false,
      },
    },
    {},
  );
  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, "http://localhost:8787");
  assert.equal(config.model, "gpt-4o-mini");
  assert.equal(config.minInputChars, 42);
  assert.equal(config.timeoutMs, 1000);
  assert.equal(config.fallback, false);
  assert.equal(shouldCompressPrompt("x".repeat(41), config), false);
  assert.equal(shouldCompressPrompt("x".repeat(42), config), true);
});

test("Headroom stats normalize known result shapes", () => {
  assert.deepEqual(headroomStatsFromResult({ tokensBefore: 100, tokensAfter: 40, transforms: ["a"] }, 500, "short"), {
    beforeChars: 500,
    afterChars: 5,
    tokensBefore: 100,
    tokensAfter: 40,
    transforms: ["a"],
  });
});
