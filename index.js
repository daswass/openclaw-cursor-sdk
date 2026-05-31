import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { createCursorSdkHarness } from "./src/harness.mjs";

const PROVIDER_ID = "cursor-sdk";

const DEFAULT_MODELS = [
  {
    id: "composer-2.5",
    name: "Composer 2.5",
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 32768,
  },
  {
    id: "auto",
    name: "Auto",
    reasoning: false,
    contextWindow: 1048576,
    maxTokens: 131072,
  },
];

export default definePluginEntry({
  id: "cursor-sdk",
  name: "Cursor SDK",
  description:
    "OpenClaw agent harness that runs turns through the local Cursor SDK (@cursor/sdk) with native thinking stream support.",
  register(api) {
    const pluginConfig = api?.pluginConfig ?? {};
    const harness = createCursorSdkHarness(pluginConfig);

    if (typeof api.registerAgentHarness === "function") {
      api.registerAgentHarness(harness);
    }

    if (typeof api.registerProvider === "function") {
      api.registerProvider({
        id: PROVIDER_ID,
        label: "Cursor (SDK)",
        envVars: ["CURSOR_API_KEY"],
        docsPath: "/providers/cursor-sdk",
        catalog: {
          order: "simple",
          run: async () =>
            DEFAULT_MODELS.map((model) => ({
              id: model.id,
              name: model.name,
              provider: PROVIDER_ID,
              reasoning: model.reasoning,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
            })),
        },
        resolveDynamicModel: (ctx) => ({
          id: ctx.modelId,
          name: ctx.modelId,
          provider: PROVIDER_ID,
          api: "openai-completions",
          reasoning: ctx.modelId === "composer-2.5" || ctx.modelId.includes("thinking"),
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 32768,
        }),
      });
    }
  },
});
