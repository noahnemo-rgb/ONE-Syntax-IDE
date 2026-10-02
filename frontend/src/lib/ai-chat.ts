import { formatAiError, formatCodeContext } from "ai-buffer";
import { DEFAULT_OPENROUTER_MODEL, openRouterKey, openRouterModel } from "./ai-keys";
import { SYSTEM_PROMPT, type AiProviderInfo, type StreamAiChatParams } from "./ai-chat-shared";
import { createSyntaxRouter } from "./syntax-router.js";

export async function getAiProviderInfo(): Promise<AiProviderInfo> {
  const key = await openRouterKey.get();
  const model = await openRouterModel.get();
  return {
    label: key?.trim() ? "Space Bunny Alpha" : "OpenRouter (your key)",
    description: key?.trim()
      ? `Space Bunny Alpha runs first, then ${model}. The key stays on this device and is never sent to our servers.`
      : "Add your OpenRouter API key in AI settings. Your key stays on this device and is never sent to our servers.",
    configured: Boolean(key?.trim()),
  };
}

export async function signInAiProvider(): Promise<void> {
  // Phone setup is the saved key. Puter sign-in is the web build.
}

export async function streamAiChat(params: StreamAiChatParams): Promise<string> {
  const apiKey = (await openRouterKey.get())?.trim();
  if (!apiKey) {
    throw new Error("OpenRouter API key not set. Open AI settings (gear icon) and add your key.");
  }
  const model = (await openRouterModel.get()) || DEFAULT_OPENROUTER_MODEL;
  const router = createSyntaxRouter({ platform: "native", apiKey, model });
  if (!router) {
    throw new Error("OpenRouter API key not set. Open AI settings (gear icon) and add your key.");
  }
  try {
    return await router.streamChat({
      message: params.message,
      history: params.history,
      systemPrompt: SYSTEM_PROMPT,
      context: params.context?.code
        ? formatCodeContext({ code: params.context.code, language: params.context.language })
        : undefined,
      onChunk: params.onChunk,
    });
  } catch (e) {
    throw new Error(formatAiError(e));
  }
}
