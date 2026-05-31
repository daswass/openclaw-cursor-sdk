import { Cursor } from "@cursor/sdk";

export const DEFAULT_MODELS = [
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

function mapSdkModel(model) {
  const id = String(model?.id ?? "").trim();
  if (!id) {
    return null;
  }
  const name = String(model?.name ?? id).trim() || id;
  const reasoning =
    id.includes("thinking") ||
    id.includes("opus") ||
    id === "composer-2.5";
  return {
    id,
    name,
    provider: "cursor-sdk",
    reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: id === "auto" ? 1048576 : 200000,
    maxTokens: id === "auto" ? 131072 : 32768,
  };
}

export async function listCursorSdkCatalogModels() {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return DEFAULT_MODELS.map((model) => mapSdkModel(model)).filter(Boolean);
  }

  try {
    const models = await Cursor.models.list({ apiKey });
    const mapped = models.map(mapSdkModel).filter(Boolean);
    if (mapped.length > 0) {
      return mapped;
    }
  } catch {
    // fall through to static defaults
  }

  return DEFAULT_MODELS.map((model) => mapSdkModel(model)).filter(Boolean);
}
