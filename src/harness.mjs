import { Agent, CursorAgentError } from "@cursor/sdk";
import { classifyAgentHarnessTerminalOutcome } from "openclaw/plugin-sdk/agent-harness-runtime";
import { drainSdkStream } from "./stream-bridge.mjs";
import {
  clearCursorSdkAgentId,
  readCursorSdkAgentId,
  writeCursorSdkAgentId,
} from "./session-binding.mjs";

const HARNESS_ID = "cursor-sdk";
const PROVIDER_ID = "cursor-sdk";

function resolveApiKey() {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "CURSOR_API_KEY is not set. Configure Cursor SDK provider auth or export CURSOR_API_KEY.",
    );
  }
  return key;
}

function resolveModelId(params, pluginConfig) {
  const fromRun = params.modelId?.trim();
  if (fromRun) {
    return fromRun;
  }
  const fallback = pluginConfig?.defaultModel?.trim();
  return fallback || "composer-2.5";
}

function resolveCwd(params, pluginConfig) {
  const configured = pluginConfig?.cwd?.trim();
  return configured || params.workspaceDir || process.cwd();
}

function buildFailureResult(params, message) {
  return {
    aborted: false,
    externalAbort: false,
    timedOut: false,
    idleTimedOut: false,
    timedOutDuringCompaction: false,
    timedOutDuringToolExecution: false,
    promptError: message,
    promptErrorSource: "prompt",
    sessionIdUsed: params.sessionId,
    agentHarnessId: HARNESS_ID,
    messagesSnapshot: [],
    assistantTexts: [],
    toolMetas: [],
    lastAssistant: undefined,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: {
      hadPotentialSideEffects: false,
      replaySafe: true,
    },
    itemLifecycle: {
      startedCount: 0,
      completedCount: 0,
      activeCount: 0,
    },
  };
}

function buildSuccessResult(params, state, agentId) {
  const assistantText = state.assistantText.trim();
  const assistantTexts = assistantText ? [assistantText] : [];
  const lastAssistant = assistantText
    ? {
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
        api: "cursor-sdk",
        provider: params.provider,
        model: params.modelId,
        stopReason: "stop",
        timestamp: Date.now(),
      }
    : undefined;

  const classification = classifyAgentHarnessTerminalOutcome({
    assistantTexts,
    reasoningText: state.reasoningText,
    turnCompleted: true,
  });

  return {
    aborted: false,
    externalAbort: false,
    timedOut: false,
    idleTimedOut: false,
    timedOutDuringCompaction: false,
    timedOutDuringToolExecution: false,
    promptError: state.lastError ?? null,
    promptErrorSource: state.lastError ? "prompt" : null,
    sessionIdUsed: params.sessionId,
    agentHarnessId: HARNESS_ID,
    agentHarnessResultClassification: classification,
    messagesSnapshot: lastAssistant ? [lastAssistant] : [],
    assistantTexts,
    toolMetas: state.toolMetas,
    lastAssistant,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: {
      hadPotentialSideEffects: state.hadPotentialSideEffects,
      replaySafe: !state.hadPotentialSideEffects,
    },
    itemLifecycle: { ...state.itemLifecycle },
    cursorSdkAgentId: agentId,
  };
}

function isActiveRunError(err) {
  const message = String(err?.message ?? err ?? "");
  return message.includes("already has active run");
}

async function sendPrompt(agent, prompt) {
  try {
    return await agent.send(prompt);
  } catch (err) {
    if (!isActiveRunError(err)) {
      throw err;
    }
    // Recovery for local agents left wedged after gateway restart or crash.
    return await agent.send(prompt, { local: { force: true } });
  }
}

async function openAgent(params, pluginConfig) {
  const apiKey = resolveApiKey();
  const modelId = resolveModelId(params, pluginConfig);
  const cwd = resolveCwd(params, pluginConfig);
  const boundAgentId = await readCursorSdkAgentId(params.sessionId);

  const baseOptions = {
    apiKey,
    model: { id: modelId },
    local: { cwd },
  };

  if (boundAgentId) {
    return {
      agent: await Agent.resume(boundAgentId, baseOptions),
      agentId: boundAgentId,
      resumed: true,
    };
  }

  const agent = await Agent.create(baseOptions);
  return {
    agent,
    agentId: agent.agentId,
    resumed: false,
  };
}

export function createCursorSdkHarness(pluginConfig = {}) {
  return {
    id: HARNESS_ID,
    label: "Cursor SDK",

    supports(ctx) {
      if (ctx.provider !== PROVIDER_ID) {
        return { supported: false, reason: "provider mismatch" };
      }
      return { supported: true, priority: 100 };
    },

    async runAttempt(params) {
      params.onExecutionStarted?.();
      params.onExecutionPhase?.({
        phase: "attempt_dispatch",
        provider: params.provider,
        model: params.modelId,
        backend: HARNESS_ID,
      });

      let agent;
      let agentId;
      try {
        ({ agent, agentId } = await openAgent(params, pluginConfig));
      } catch (err) {
        const message =
          err instanceof CursorAgentError
            ? `Cursor SDK startup failed: ${err.message}`
            : String(err?.message ?? err);
        return buildFailureResult(params, message);
      }

      await using _agent = agent;

      try {
        params.onExecutionPhase?.({
          phase: "turn_accepted",
          provider: params.provider,
          model: params.modelId,
          backend: HARNESS_ID,
        });

        const run = await sendPrompt(agent, params.prompt);
        params.onExecutionPhase?.({
          phase: "assistant_output_started",
          provider: params.provider,
          model: params.modelId,
          backend: HARNESS_ID,
        });

        const state = await drainSdkStream(run.stream(), {
          onPartialReply: params.onPartialReply,
          onReasoningStream: params.onReasoningStream,
          onReasoningEnd: params.onReasoningEnd,
          onAgentEvent: params.onAgentEvent,
          toolProgressDetail: params.toolProgressDetail,
        });

        const result = await run.wait();
        if (result.status === "error") {
          return buildFailureResult(
            params,
            `Cursor SDK run failed (${result.id ?? "unknown"})`,
          );
        }

        if (agentId) {
          await writeCursorSdkAgentId(params.sessionId, agentId);
        }

        return buildSuccessResult(params, state, agentId);
      } catch (err) {
        if (params.abortSignal?.aborted) {
          return {
            ...buildFailureResult(params, "Cursor SDK run aborted"),
            aborted: true,
            externalAbort: true,
          };
        }
        const message =
          err instanceof CursorAgentError
            ? `Cursor SDK error: ${err.message}`
            : String(err?.message ?? err);
        return buildFailureResult(params, message);
      }
    },

    async reset(params) {
      if (params.sessionId) {
        await clearCursorSdkAgentId(params.sessionId);
      }
    },
  };
}
