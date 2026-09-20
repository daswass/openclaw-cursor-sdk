const HARNESS_ID = "cursor-sdk";

/**
 * Mirror of openclaw `classifyAgentHarnessTerminalOutcome` (plugin-sdk).
 * Kept local so unit tests do not load the full OpenClaw package graph, and so
 * empty-success turns still advertise `empty` for model-fallback.
 */
function classifyTerminalOutcome(params) {
  const hasVisible = (params.assistantTexts ?? []).some(
    (text) => typeof text === "string" && text.trim().length > 0,
  );
  if (
    !params.turnCompleted ||
    (params.promptError !== undefined && params.promptError !== null) ||
    hasVisible
  ) {
    return undefined;
  }
  if (params.planText?.trim()) {
    return "planning-only";
  }
  if (params.reasoningText?.trim()) {
    return "reasoning-only";
  }
  return "empty";
}

export function buildFailureResult(params, message, partialState = undefined) {
  const hadPotentialSideEffects = partialState?.hadPotentialSideEffects === true;
  const itemLifecycle = partialState?.itemLifecycle
    ? { ...partialState.itemLifecycle }
    : {
        startedCount: 0,
        completedCount: 0,
        activeCount: 0,
      };
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
    // Failures have no visible assistant reply; keep classification explicit so
    // OpenClaw model-fallback does not treat an empty snapshot as success.
    agentHarnessResultClassification: "empty",
    messagesSnapshot: [],
    assistantTexts: [],
    toolMetas: partialState?.toolMetas ?? [],
    lastAssistant: undefined,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: {
      hadPotentialSideEffects,
      replaySafe: !hadPotentialSideEffects,
    },
    itemLifecycle,
  };
}

export function buildSuccessResult(params, state, agentId, finalText) {
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

  const classification = classifyTerminalOutcome({
    assistantTexts,
    reasoningText: state?.reasoningText,
    turnCompleted: true,
  });

  return {
    aborted: false,
    externalAbort: false,
    timedOut: false,
    idleTimedOut: false,
    timedOutDuringCompaction: false,
    timedOutDuringToolExecution: false,
    ...(state?.lastError
      ? {
          promptError: state.lastError,
          promptErrorSource: "prompt",
        }
      : {
          promptError: null,
          promptErrorSource: null,
        }),
    sessionIdUsed: params.sessionId,
    agentHarnessId: HARNESS_ID,
    agentHarnessResultClassification: classification,
    messagesSnapshot: lastAssistant ? [lastAssistant] : [],
    assistantTexts,
    toolMetas: state?.toolMetas ?? [],
    lastAssistant,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: {
      hadPotentialSideEffects: state?.hadPotentialSideEffects === true,
      replaySafe: state?.hadPotentialSideEffects !== true,
    },
    itemLifecycle: {
      startedCount: state?.itemLifecycle?.startedCount ?? 0,
      completedCount: state?.itemLifecycle?.completedCount ?? 0,
      activeCount: state?.itemLifecycle?.activeCount ?? 0,
    },
    cursorSdkAgentId: agentId,
  };
}

/** True when OpenClaw is retrying this harness after another model failed. */
export function isModelFallbackAttempt(params) {
  const provenance = params?.modelRoutingProvenance;
  if (provenance && typeof provenance === "object") {
    if (provenance.stage === "fallback") {
      return true;
    }
    if (provenance.fallbackReason) {
      return true;
    }
  }
  return params?.isFallbackRetry === true;
}
