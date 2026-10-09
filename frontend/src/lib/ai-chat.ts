import { DASHBOARD_LABELS, formatAiError, formatCodeContext } from "ai-buffer";
import { loadChatRouterOptions, loadProviderSummary } from "./ai-keys";
import { SYSTEM_PROMPT, type AiProviderInfo, type StreamAiChatParams } from "./ai-chat-shared";
import { createSyntaxRouter } from "./syntax-router.js";

export async function isPuterSignedIn(): Promise<boolean> {
  return false;
}

export async function getAiProviderInfo(): Promise<AiProviderInfo> {
  return loadProviderSummary(false);
}

export async function signInAiProvider(): Promise<void> {
  // Phone setup is the saved key. Puter sign-in is the web build.
}

export async function streamAiChat(params: StreamAiChatParams): Promise<string> {
  const options = await loadChatRouterOptions("native");
  const router = createSyntaxRouter(options);
  if (!router) {
    throw new Error(DASHBOARD_LABELS.notConfigured);
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
