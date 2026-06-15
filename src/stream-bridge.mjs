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

function stringifyToolMeta(meta) {
  if (typeof meta === "string") {
    return meta.trim() || undefined;
  }
  if (meta == null) {
    return undefined;
  }
  return String(meta).trim() || undefined;
}

async function emitToolItemEvent(callbacks, { callId, name, phase, status, meta }) {
  const metaText = stringifyToolMeta(meta);
  await emitToolAgentEvent(callbacks, {
    stream: "item",
    data: {
      itemId: `tool:${callId}`,
      kind: "tool",
      name,
      phase,
      status,
      title: metaText ? `${name} ${metaText}` : name,
      meta: metaText,
      toolCallId: callId,
      // Match Codex: channel progress uses stream:tool only; item events are diagnostic.
      suppressChannelProgress: true,
    },
  });
}

/** Reset Telegram tool-progress draft between tools (Codex uses assistant boundaries). */
async function notifyToolProgressBoundary(callbacks) {
  if (callbacks.onAssistantMessageStart) {
    await callbacks.onAssistantMessageStart();
  }
}

/**
 * Close the in-progress assistant text run when a tool interrupts it.
 *
 * Cursor streams a short "preamble" before each tool call. Treating those as
 * one growing message stacks every preamble onto the final answer. Instead we
 * snapshot each preamble as its own segment and reset the live draft so the
 * next segment replaces it (Codex-style transient progress), leaving only the
 * trailing segment as the actual answer.
 */
async function finalizeAssistantSegment(state, callbacks) {
  if (!state.assistantText) {
    return;
  }
  state.segments.push(state.assistantText);
  state.assistantText = "";
  state.pendingReplace = true;
  await notifyToolProgressBoundary(callbacks);
}

async function markAssistantOutputStarted(state, callbacks) {
  if (state.assistantStarted) {
    return;
  }
  state.assistantStarted = true;
  await notifyToolProgressBoundary(callbacks);
  if (callbacks.onExecutionPhase) {
    await callbacks.onExecutionPhase({ phase: "assistant_output_started" });
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
  await emitToolItemEvent(callbacks, {
    callId,
    name,
    phase: "update",
    status: "running",
    meta,
  });
}

async function emitToolStart(state, callbacks, { callId, name, args }) {
  if (state.startedToolCallIds.has(callId)) {
    await emitToolUpdate(state, callbacks, { callId, name, args });
    return;
  }

  // A brand-new tool closes any preamble text that preceded it.
  await finalizeAssistantSegment(state, callbacks);

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
  await emitToolItemEvent(callbacks, {
    callId,
    name,
    phase: "start",
    status: "running",
    meta,
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
    await emitToolItemEvent(callbacks, {
      callId,
      name,
      phase: "result",
      status: event.status === "error" ? "error" : "completed",
      meta,
    });
    await notifyToolProgressBoundary(callbacks);
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
      if (callbacks.streamThinkingToChannels && callbacks.onReasoningStream) {
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
      const toolUseBlocks = [];
      for (const block of blocks) {
        if (block?.type === "text" && typeof block.text === "string") {
          delta += block.text;
        } else if (block?.type === "tool_use") {
          toolUseBlocks.push(block);
        }
      }

      // Reset channel tool-progress draft before tools (Codex assistant boundary).
      if (toolUseBlocks.length > 0) {
        await notifyToolProgressBoundary(callbacks);
      }

      // Tools before trailing text so preamble/tool/final-answer boundaries stay ordered.
      for (const block of toolUseBlocks) {
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

      // Stream assistant prose as the current segment. `pendingReplace` resets
      // the live draft after a tool boundary so segments don't visually stack.
      if (delta) {
        await markAssistantOutputStarted(state, callbacks);
        state.assistantText += delta;
        if (callbacks.onPartialReply) {
          const replace = state.pendingReplace === true;
          state.pendingReplace = false;
          await callbacks.onPartialReply({
            text: state.assistantText,
            delta,
            ...(replace ? { replace: true } : {}),
          });
        }
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
    // Current (trailing) assistant text segment. After the last tool boundary
    // this holds the final answer; earlier preambles live in `segments`.
    assistantText: "",
    segments: [],
    pendingReplace: false,
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

/**
 * Best-effort final answer derived purely from the stream, used as a fallback
 * when the authoritative run result text is unavailable. Prefers the trailing
 * segment (text after the last tool); falls back to the last non-empty segment.
 */
export function resolveStreamedFinalText(state) {
  if (state.assistantText && state.assistantText.trim()) {
    return state.assistantText;
  }
  for (let i = state.segments.length - 1; i >= 0; i -= 1) {
    if (state.segments[i] && state.segments[i].trim()) {
      return state.segments[i];
    }
  }
  return state.assistantText;
}

export async function drainSdkStream(stream, callbacks) {
  const state = createStreamState();
  try {
    for await (const event of stream) {
      await bridgeSdkStreamEvent(event, state, callbacks);
    }
  } catch (err) {
    state.lastError = err;
    if (err && typeof err === "object") {
      err.cursorSdkStreamState = state;
    }
    throw err;
  }
  if (callbacks.streamThinkingToChannels && callbacks.onReasoningEnd && state.reasoningText) {
    await callbacks.onReasoningEnd();
  }
  return state;
}
