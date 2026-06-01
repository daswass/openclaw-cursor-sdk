import assert from "node:assert/strict";
import test from "node:test";
import {
  bridgeSdkStreamEvent,
  createStreamState,
} from "../src/stream-bridge.mjs";

test("tool_call running emits start agent event", async () => {
  // Arrange
  const state = createStreamState();
  const events = [];
  const callbacks = {
    onAgentEvent: async (evt) => {
      events.push(evt);
    },
  };

  // Act
  await bridgeSdkStreamEvent(
    {
      type: "tool_call",
      call_id: "call-1",
      name: "read",
      status: "running",
      args: { path: "README.md" },
    },
    state,
    callbacks,
  );

  // Assert
  assert.equal(events.length, 1);
  assert.equal(events[0].stream, "tool");
  assert.equal(events[0].data.phase, "start");
  assert.equal(events[0].data.name, "read");
  assert.equal(events[0].data.toolCallId, "call-1");
  assert.equal(state.itemLifecycle.startedCount, 1);
  assert.equal(state.itemLifecycle.activeCount, 1);
  assert.equal(state.hadPotentialSideEffects, false);
});

test("tool_call completed emits result and records tool meta", async () => {
  // Arrange
  const state = createStreamState();
  const events = [];
  const callbacks = {
    onAgentEvent: async (evt) => {
      events.push(evt);
    },
  };

  // Act
  await bridgeSdkStreamEvent(
    {
      type: "tool_call",
      call_id: "call-2",
      name: "shell",
      status: "running",
      args: { command: "echo hi" },
    },
    state,
    callbacks,
  );
  await bridgeSdkStreamEvent(
    {
      type: "tool_call",
      call_id: "call-2",
      name: "shell",
      status: "completed",
      result: "hi\n",
    },
    state,
    callbacks,
  );

  // Assert
  assert.equal(events.length, 2);
  assert.equal(events[1].data.phase, "result");
  assert.equal(events[1].data.isError, false);
  assert.equal(state.toolMetas.length, 1);
  assert.equal(state.toolMetas[0].toolName, "shell");
  assert.equal(state.itemLifecycle.completedCount, 1);
  assert.equal(state.itemLifecycle.activeCount, 0);
  assert.equal(state.hadPotentialSideEffects, true);
});

test("duplicate running events emit update", async () => {
  // Arrange
  const state = createStreamState();
  const events = [];
  const callbacks = {
    onAgentEvent: async (evt) => {
      events.push(evt);
    },
  };
  const running = {
    type: "tool_call",
    call_id: "call-3",
    name: "grep",
    status: "running",
    args: { pattern: "foo" },
  };

  // Act
  await bridgeSdkStreamEvent(running, state, callbacks);
  await bridgeSdkStreamEvent(
    {
      ...running,
      args: { pattern: "bar" },
    },
    state,
    callbacks,
  );

  // Assert
  assert.equal(events.length, 2);
  assert.equal(events[0].data.phase, "start");
  assert.equal(events[1].data.phase, "update");
  assert.equal(state.itemLifecycle.startedCount, 1);
});

test("assistant tool_use blocks emit tool start", async () => {
  // Arrange
  const state = createStreamState();
  const events = [];
  const callbacks = {
    onAgentEvent: async (evt) => {
      events.push(evt);
    },
  };

  // Act
  await bridgeSdkStreamEvent(
    {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "call-4", name: "read", input: { path: "README.md" } }],
      },
    },
    state,
    callbacks,
  );

  // Assert
  assert.equal(events.length, 1);
  assert.equal(events[0].stream, "tool");
  assert.equal(events[0].data.phase, "start");
  assert.equal(events[0].data.name, "read");
  assert.equal(events[0].data.toolCallId, "call-4");
});

test("assistant text emits onAssistantMessageStart once", async () => {
  // Arrange
  const state = createStreamState();
  let starts = 0;
  const callbacks = {
    onAssistantMessageStart: async () => {
      starts += 1;
    },
    onPartialReply: async () => {},
  };

  // Act
  await bridgeSdkStreamEvent(
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    },
    state,
    callbacks,
  );
  await bridgeSdkStreamEvent(
    {
      type: "assistant",
      message: { content: [{ type: "text", text: " world" }] },
    },
    state,
    callbacks,
  );

  // Assert
  assert.equal(starts, 1);
  assert.equal(state.assistantText, "Hello world");
});
