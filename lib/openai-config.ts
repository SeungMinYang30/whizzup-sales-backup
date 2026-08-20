import {
  DEFAULT_OPENAI_MODEL,
  getEffectiveOpenAIConfig,
} from "./openai-credentials";

export { DEFAULT_OPENAI_MODEL };

export async function getOpenAIConfig() {
  return getEffectiveOpenAIConfig();
}
