import assert from "node:assert/strict";
import test from "node:test";
import {
  CursorSdkWatchdogError,
  raceWithIdleAndAbort,
  raceWithRunTimeoutAndAbort,
  resolveWatchdogConfig,
} from "../src/run-watchdog.mjs";
import { drainSdkStream } from "../src/stream-bridge.mjs";

test("resolveWatchdogConfig applies defaults and clamps invalid values", () => {
  assert.deepEqual(resolveWatchdogConfig({}), {
    idleTimeoutMs: 180_000,
    runTimeoutMs: 600_000,
  });
  assert.deepEqual(resolveWatchdogConfig({ idleTimeoutMs: 5_000, runTimeoutMs: 9_000 }), {
    idleTimeoutMs: 5_000,
    runTimeoutMs: 9_000,
  });
  assert.deepEqual(resolveWatchdogConfig({ idleTimeoutMs: -1, runTimeoutMs: 0 }), {
    idleTimeoutMs: 180_000,
    runTimeoutMs: 600_000,
  });
});

test("raceWithIdleAndAbort times out when the promise never settles", async () => {
  await assert.rejects(
    () =>
      raceWithIdleAndAbort(new Promise(() => {}), {
        idleTimeoutMs: 25,
      }),
    (err) => {
      assert.ok(err instanceof CursorSdkWatchdogError);
      assert.equal(err.kind, "idle");
      assert.equal(err.idleTimedOut, true);
      return true;
    },
  );
});

test("raceWithIdleAndAbort honors abortSignal", async () => {
  const controller = new AbortController();
  const pending = raceWithIdleAndAbort(new Promise(() => {}), {
    idleTimeoutMs: 5_000,
    abortSignal: controller.signal,
  });
  queueMicrotask(() => controller.abort());
  await assert.rejects(
    () => pending,
    (err) => {
      assert.ok(err instanceof CursorSdkWatchdogError);
      assert.equal(err.kind, "abort");
      assert.equal(err.aborted, true);
      return true;
    },
  );
});

test("raceWithRunTimeoutAndAbort enforces hard timeout", async () => {
  await assert.rejects(
    () =>
      raceWithRunTimeoutAndAbort(new Promise(() => {}), {
        runTimeoutMs: 20,
      }),
    (err) => {
      assert.ok(err instanceof CursorSdkWatchdogError);
      assert.equal(err.kind, "run");
      assert.equal(err.timedOut, true);
      return true;
    },
  );
});

test("drainSdkStream raceNext can abort a hung iterator", async () => {
  const hungStream = {
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {});
      yield { type: "never" };
    },
  };

  await assert.rejects(
    () =>
      drainSdkStream(hungStream, {
        raceNext: (nextPromise) =>
          raceWithIdleAndAbort(nextPromise, {
            idleTimeoutMs: 30,
          }),
      }),
    (err) => {
      assert.ok(err instanceof CursorSdkWatchdogError);
      assert.equal(err.idleTimedOut, true);
      assert.ok(err.cursorSdkStreamState);
      return true;
    },
  );
});
