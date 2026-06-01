/**
 * Map @cursor/sdk stream events to OpenClaw harness callbacks.
 */

import { inferToolMetaFromArgs } from "openclaw/plugin-sdk/agent-harness-runtime";

const MUTATING_TOOLS = new Set([
  "shell",
  "write",
  "edit",
  "delete",
  "apply_patch",
  "str_replace",
  "search_replace",
  "patch",
  "mcp",
  "task",
]);

function normalizeToolName(name) {
  return String(name ?? "").trim();
}

function isMutatingTool(name) {
  const key = normalizeToolName(name).toLowerCase();
  return MUTATING_TOOLS.has(key);
}

async function emitToolAgentEvent(callbacks, payload) {
  if (callbacks.onAgentEvent) {
    await callbacks.onAgentEvent(payload);
  }
}

async function emitToolUpdate(state, callbacks, { callId, name, args }) {
  const detailMode = callbacks.toolProgressDetail ?? "explain";
  const meta = inferToolMetaFromArgs(name, args, { detailMode });
  state.toolMetaById.set(callId, { toolName: name, meta });

  await emitToolAgentEvent(callbacks, {
    stream: "tool",
    data: {
      phase: "update",
      name,
      toolCallId: callId,
      ...(args !== undefined ? { args } : {}),
      ...(meta ? { meta } : {}),
    },
  });
}

async function emitToolStart(state, callbacks, { callId, name, args }) {
  if (state.startedToolCallIds.has(callId)) {
    await emitToolUpdate(state, callbacks, { callId, name, args });
    return;
  }

  state.startedToolCallIds.add(callId);
  state.itemLifecycle.startedCount += 1;
  state.itemLifecycle.activeCount += 1;

  if (callbacks.onExecutionPhase) {
    await callbacks.onExecutionPhase({
      phase: "tool_execution_started",
      tool: name,
      toolCallId: callId,
    });
  }

  const detailMode = callbacks.toolProgressDetail ?? "explain";
  const meta = inferToolMetaFromArgs(name, args, { detailMode });
  state.toolMetaById.set(callId, { toolName: name, meta });
  if (isMutatingTool(name)) {
    state.hadPotentialSideEffects = true;
  }

  await emitToolAgentEvent(callbacks, {
    stream: "tool",
    data: {
      phase: "start",
      name,
      toolCallId: callId,
      ...(args !== undefined ? { args } : {}),
      ...(meta ? { meta } : {}),
    },
  });
}

async function handleToolCallEvent(event, state, callbacks) {
  const callId = event.call_id;
  const name = normalizeToolName(event.name);
  if (!callId || !name) {
    return state;
  }

  if (event.status === "running") {
    await emitToolStart(state, callbacks, {
      callId,
      name,
      args: event.args,
    });
    return state;
  }

  if (event.status === "completed" || event.status === "error") {
    if (!state.startedToolCallIds.has(callId)) {
      await emitToolStart(state, callbacks, {
        callId,
        name,
        args: event.args,
      });
    }

    if (state.completedToolCallIds.has(callId)) {
      return state;
    }

    state.completedToolCallIds.add(callId);
    state.itemLifecycle.completedCount += 1;
    state.itemLifecycle.activeCount = Math.max(0, state.itemLifecycle.activeCount - 1);

    const existing = state.toolMetaById.get(callId);
    const detailMode = callbacks.toolProgressDetail ?? "explain";
    const meta =
      existing?.meta ??
      inferToolMetaFromArgs(name, event.args, { detailMode });

    state.toolMetas.push({
      toolName: name,
      ...(meta ? { meta } : {}),
    });

    await emitToolAgentEvent(callbacks, {
      stream: "tool",
      data: {
        phase: "result",
        name,
        toolCallId: callId,
        isError: event.status === "error",
        ...(event.result !== undefined ? { result: event.result } : {}),
        ...(meta ? { meta } : {}),
      },
    });
    return state;
  }

  return state;
}

export async function bridgeSdkStreamEvent(event, state, callbacks) {
  if (!event || typeof event !== "object") {
    return state;
  }

  switch (event.type) {
    case "thinking": {
      const delta = typeof event.text === "string" ? event.text : "";
      if (!delta) {
        return state;
      }
      state.reasoningText += delta;
      if (callbacks.onReasoningStream) {
        await callbacks.onReasoningStream({ text: state.reasoningText });
      }
      return state;
    }
    case "assistant": {
      const blocks = event.message?.content;
      if (!Array.isArray(blocks)) {
        return state;
      }
      let delta = "";
      for (const block of blocks) {
        if (block?.type === "text" && typeof block.text === "string") {
          delta += block.text;
        } else if (block?.type === "tool_use") {
          const callId = block.id;
          const name = normalizeToolName(block.name);
          if (callId && name) {
            await emitToolStart(state, callbacks, {
              callId,
              name,
              args: block.input,
            });
          }
        }
      }
      if (!delta) {
        return state;
      }
      if (!state.assistantStarted) {
        state.assistantStarted = true;
        if (callbacks.onAssistantMessageStart) {
          await callbacks.onAssistantMessageStart();
        }
        if (callbacks.onExecutionPhase) {
          await callbacks.onExecutionPhase({ phase: "assistant_output_started" });
        }
      }
      state.assistantText += delta;
      if (callbacks.onPartialReply) {
        await callbacks.onPartialReply({ text: state.assistantText, delta });
      }
      return state;
    }
    case "tool_call": {
      return handleToolCallEvent(event, state, callbacks);
    }
    case "status": {
      if (event.status === "ERROR" && typeof event.message === "string") {
        state.lastError = event.message;
      }
      return state;
    }
    default:
      return state;
  }
}

export function createStreamState() {
  return {
    assistantText: "",
    reasoningText: "",
    lastError: undefined,
    toolMetas: [],
    toolMetaById: new Map(),
    startedToolCallIds: new Set(),
    completedToolCallIds: new Set(),
    hadPotentialSideEffects: false,
    itemLifecycle: {
      startedCount: 0,
      completedCount: 0,
      activeCount: 0,
    },
    assistantStarted: false,
  };
}

export async function drainSdkStream(stream, callbacks) {
  const state = createStreamState();
  for await (const event of stream) {
    await bridgeSdkStreamEvent(event, state, callbacks);
  }
  if (callbacks.onReasoningEnd && state.reasoningText) {
    await callbacks.onReasoningEnd();
  }
  return state;
}
