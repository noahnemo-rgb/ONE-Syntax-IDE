import { formatAiError, formatCodeContext } from "ai-buffer";
import { openRouterKey, openRouterModel } from "./ai-keys";
import { SYSTEM_PROMPT, type AiProviderInfo, type StreamAiChatParams } from "./ai-chat-shared";
import { createSyntaxRouter } from "./syntax-router.js";

type PuterModule = typeof import("@heyputer/puter.js");

async function loadPuter(): Promise<PuterModule["puter"]> {
  const mod = await import("@heyputer/puter.js");
  return mod.puter;
}

export async function getAiProviderInfo(): Promise<AiProviderInfo> {
  const key = await openRouterKey.get();
  const keyed = Boolean(key?.trim());
  try {
    const puter = await loadPuter();
    const signedIn = Boolean(puter.auth?.isSignedIn?.());
    return {
      label: "Puter",
      description: signedIn
        ? keyed
          ? "Signed in to Puter. If Puter cannot answer, this browser tries Space Bunny Alpha, then your OpenRouter model."
          : "Signed in to Puter. AI usage is billed to your Puter account, not the app developer."
        : "Sign in to Puter when prompted. An optional OpenRouter key on this device tries Space Bunny Alpha after Puter.",
      configured: signedIn || keyed,
    };
  } catch {
    return {
      label: "Puter",
      description: "Sign in to Puter when prompted. An optional OpenRouter key tries Space Bunny Alpha after Puter.",
      configured: keyed,
    };
  }
}

export async function signInAiProvider(): Promise<void> {
  const puter = await loadPuter();
  await puter.auth.signIn();
}

export async function streamAiChat(params: StreamAiChatParams): Promise<string> {
  const apiKey = await openRouterKey.get();
  const model = await openRouterModel.get();
  const router = createSyntaxRouter({
    platform: "web",
    apiKey: apiKey ?? "",
    model,
    loadPuter,
  });
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
