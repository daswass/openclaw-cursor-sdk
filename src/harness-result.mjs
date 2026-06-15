const HARNESS_ID = "cursor-sdk";

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
