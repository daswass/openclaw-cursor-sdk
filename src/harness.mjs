import { Agent, CursorAgentError } from "@cursor/sdk";
import { classifyAgentHarnessTerminalOutcome } from "openclaw/plugin-sdk/agent-harness-runtime";
import { withCursorSdkConnectionGate } from "./connection-gate.mjs";
import {
  DEFAULT_MAX_ATTEMPTS,
  isRetryableCursorSdkError,
  isRetryableCursorSdkRunFailure,
  retryDelayMs,
  sleep,
} from "./retry.mjs";
import { drainSdkStream, resolveStreamedFinalText } from "./stream-bridge.mjs";
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
  if (fromRun && fromRun !== "auto") {
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

function buildSuccessResult(params, state, agentId, finalText) {
  const assistantText = (finalText ?? "").trim();
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

async function prepareCursorSdkRetry(params) {
  if (params.sessionId) {
    await clearCursorSdkAgentId(params.sessionId);
  }
}

async function openAgent(params, pluginConfig, { forceFresh = false } = {}) {
  const apiKey = resolveApiKey();
  const modelId = resolveModelId(params, pluginConfig);
  const cwd = resolveCwd(params, pluginConfig);
  const boundAgentId = forceFresh
    ? undefined
    : await readCursorSdkAgentId(params.sessionId);

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
      return withCursorSdkConnectionGate(async () => {
      params.onExecutionStarted?.();
      params.onExecutionPhase?.({
        phase: "attempt_dispatch",
        provider: params.provider,
        model: params.modelId,
        backend: HARNESS_ID,
      });

      let forceFresh = false;
      for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 1) {
          const delayMs = retryDelayMs(attempt - 1);
          console.warn(
            `[cursor-sdk] retrying turn (${attempt}/${DEFAULT_MAX_ATTEMPTS}) after ${delayMs}ms`,
          );
          await sleep(delayMs);
        }

        const startedAt = Date.now();
        let agent;
        let agentId;
        try {
          ({ agent, agentId } = await openAgent(params, pluginConfig, { forceFresh }));
          forceFresh = false;
        } catch (err) {
          if (attempt < DEFAULT_MAX_ATTEMPTS && isRetryableCursorSdkError(err)) {
            await prepareCursorSdkRetry(params);
            forceFresh = true;
            continue;
          }
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
          const stream = run.stream();

          // Drain the stream and await the terminal result together. Attach inert
          // catches first so that if one path rejects, the other's rejection never
          // escapes as an unhandled rejection (which would crash the gateway).
          const streamPromise = drainSdkStream(stream, {
            onPartialReply: params.onPartialReply,
            onReasoningStream: params.onReasoningStream,
            onReasoningEnd: params.onReasoningEnd,
            onAssistantMessageStart: params.onAssistantMessageStart,
            onAgentEvent: params.onAgentEvent,
            toolProgressDetail: params.toolProgressDetail,
            streamThinkingToChannels: pluginConfig.streamThinkingToChannels === true,
            onExecutionPhase: (info) =>
              params.onExecutionPhase?.({
                provider: params.provider,
                model: params.modelId,
                backend: HARNESS_ID,
                ...info,
              }),
          });
          const waitPromise = run.wait();
          streamPromise.catch(() => {});
          waitPromise.catch(() => {});

          let state;
          let result;
          try {
            [state, result] = await Promise.all([streamPromise, waitPromise]);
          } catch (err) {
            if (params.abortSignal?.aborted) {
              throw err;
            }
            if (attempt < DEFAULT_MAX_ATTEMPTS && isRetryableCursorSdkError(err)) {
              await prepareCursorSdkRetry(params);
              forceFresh = true;
              continue;
            }
            const message =
              err instanceof CursorAgentError
                ? `Cursor SDK error: ${err.message}`
                : String(err?.message ?? err);
            return buildFailureResult(params, message);
          }
          if (result.status === "error") {
            const elapsedMs = Date.now() - startedAt;
            if (
              attempt < DEFAULT_MAX_ATTEMPTS &&
              isRetryableCursorSdkRunFailure({
                elapsedMs,
                lastError: state.lastError,
              })
            ) {
              await prepareCursorSdkRetry(params);
              forceFresh = true;
              continue;
            }
            return buildFailureResult(
              params,
              `Cursor SDK run failed (${result.id ?? "unknown"})`,
            );
          }

          if (agentId) {
            await writeCursorSdkAgentId(params.sessionId, agentId);
          }

          // Authoritative final answer from the run result (SDK's finalAssistantText);
          // fall back to the trailing streamed segment if the result text is empty.
          const resultText =
            typeof result.result === "string" && result.result.trim()
              ? result.result
              : resolveStreamedFinalText(state);

          return buildSuccessResult(params, state, agentId, resultText);
        } catch (err) {
          if (params.abortSignal?.aborted) {
            return {
              ...buildFailureResult(params, "Cursor SDK run aborted"),
              aborted: true,
              externalAbort: true,
            };
          }
          if (attempt < DEFAULT_MAX_ATTEMPTS && isRetryableCursorSdkError(err)) {
            await prepareCursorSdkRetry(params);
            forceFresh = true;
            continue;
          }
          const message =
            err instanceof CursorAgentError
              ? `Cursor SDK error: ${err.message}`
              : String(err?.message ?? err);
          return buildFailureResult(params, message);
        }
      }

      return buildFailureResult(params, "Cursor SDK run failed after retries");
      });
    },

    async reset(params) {
      if (params.sessionId) {
        await clearCursorSdkAgentId(params.sessionId);
      }
    },
  };
}
