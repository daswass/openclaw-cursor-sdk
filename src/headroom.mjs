const DEFAULT_MIN_INPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 15_000;

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

export function resolveHeadroomConfig(pluginConfig = {}, env = process.env) {
  const raw = isPlainObject(pluginConfig.headroom) ? pluginConfig.headroom : {};
  const enabled = raw.enabled === true || toBoolean(env.CURSOR_SDK_HEADROOM_ENABLED);
  return {
    enabled,
    mode: typeof raw.mode === "string" && raw.mode.trim() ? raw.mode.trim() : "simulate",
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined,
    baseUrl:
      typeof raw.baseUrl === "string" && raw.baseUrl.trim()
        ? raw.baseUrl.trim()
        : env.HEADROOM_BASE_URL || undefined,
    apiKey:
      typeof raw.apiKey === "string" && raw.apiKey.trim()
        ? raw.apiKey.trim()
        : env.HEADROOM_API_KEY || undefined,
    tokenBudget: toPositiveInteger(raw.tokenBudget, undefined),
    timeoutMs: toPositiveInteger(raw.timeoutMs, DEFAULT_TIMEOUT_MS),
    minInputChars: toPositiveInteger(raw.minInputChars, DEFAULT_MIN_INPUT_CHARS),
    fallback: raw.fallback !== false,
  };
}

export function shouldCompressPrompt(prompt, config) {
  return Boolean(
    config?.enabled &&
      typeof prompt === "string" &&
      prompt.length >= (config.minInputChars ?? DEFAULT_MIN_INPUT_CHARS),
  );
}

function buildPromptMessages(prompt) {
  return [{ role: "user", content: prompt }];
}

function extractCompressedPrompt(result, originalPrompt) {
  const messages = Array.isArray(result?.messages)
    ? result.messages
    : Array.isArray(result?.messagesOptimized)
      ? result.messagesOptimized
      : null;
  const first = messages?.find((message) => message?.role === "user") ?? messages?.[0];
  const content = first?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return originalPrompt;
}

export function headroomStatsFromResult(result, beforeChars, afterPrompt) {
  const tokensBefore = result?.tokensBefore ?? result?.metrics?.tokensInputBefore;
  const tokensAfter = result?.tokensAfter ?? result?.metrics?.tokensInputAfter;
  return {
    beforeChars,
    afterChars: typeof afterPrompt === "string" ? afterPrompt.length : beforeChars,
    ...(Number.isFinite(tokensBefore) ? { tokensBefore } : {}),
    ...(Number.isFinite(tokensAfter) ? { tokensAfter } : {}),
    ...(Array.isArray(result?.transforms) ? { transforms: result.transforms } : {}),
    ...(Array.isArray(result?.transformsApplied)
      ? { transforms: result.transformsApplied }
      : {}),
  };
}

export async function maybeCompressPromptWithHeadroom(prompt, pluginConfig, options = {}) {
  const config = resolveHeadroomConfig(pluginConfig, options.env ?? process.env);
  if (!shouldCompressPrompt(prompt, config)) {
    return { prompt, applied: false, reason: config.enabled ? "below_threshold" : "disabled" };
  }

  const model = config.model ?? options.modelId ?? "gpt-4o";
  const beforeChars = prompt.length;

  try {
    const { compress } = await import("headroom-ai");
    const result = await compress(buildPromptMessages(prompt), {
      model,
      timeout: config.timeoutMs,
      fallback: config.fallback,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.tokenBudget ? { tokenBudget: config.tokenBudget } : {}),
    });
    const compressedPrompt = extractCompressedPrompt(result, prompt);
    return {
      prompt: compressedPrompt,
      applied: compressedPrompt !== prompt,
      reason: compressedPrompt === prompt ? "unchanged" : undefined,
      stats: headroomStatsFromResult(result, beforeChars, compressedPrompt),
    };
  } catch (err) {
    if (config.fallback) {
      return {
        prompt,
        applied: false,
        reason: "error_fallback",
        error: String(err?.message ?? err),
      };
    }
    throw err;
  }
}
