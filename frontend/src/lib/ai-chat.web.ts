import { DASHBOARD_LABELS, formatAiError, formatCodeContext } from "ai-buffer";
import { loadChatRouterOptions, loadProviderSummary } from "./ai-keys";
import { SYSTEM_PROMPT, type AiProviderInfo, type StreamAiChatParams } from "./ai-chat-shared";
import { createSyntaxRouter } from "./syntax-router.js";

type PuterModule = typeof import("@heyputer/puter.js");

async function loadPuter(): Promise<PuterModule["puter"]> {
  const mod = await import("@heyputer/puter.js");
  return mod.puter;
}

export async function isPuterSignedIn(): Promise<boolean> {
  try {
    const puter = await loadPuter();
    return Boolean(puter.auth?.isSignedIn?.());
  } catch {
    return false;
  }
}

export async function getAiProviderInfo(): Promise<AiProviderInfo> {
  return loadProviderSummary(await isPuterSignedIn());
}

export async function signInAiProvider(): Promise<void> {
  const puter = await loadPuter();
  await puter.auth.signIn();
}

export async function streamAiChat(params: StreamAiChatParams): Promise<string> {
  const options = await loadChatRouterOptions("web");
  const router = createSyntaxRouter({ ...options, loadPuter });
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
