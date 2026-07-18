export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

  return {
    apiKey,
    model,
    configured: apiKey.startsWith("sk-"),
  };
}
