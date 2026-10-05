import { createCallRouter } from "ai-buffer";

const APP_NAME = "Syntax Mobile IDE";
const SITE_URL = "https://syntax.ide";
const PUTER_MODEL = "openai/gpt-4o-mini";

/**
 * Web: Puter, then Space Bunny Alpha, then the saved OpenRouter model.
 * Phone: Space Bunny Alpha, then the saved model. No Puter route.
 * A missing key leaves the keyed routes off.
 */
export function createSyntaxRouter({ platform, apiKey, model, fetchImpl, loadPuter, timeoutMs }) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const named = typeof model === "string" && model.trim() ? model.trim() : PUTER_MODEL;
  const shared = key
    ? {
        getApiKey: () => key,
        appName: APP_NAME,
        siteUrl: SITE_URL,
        transport: platform === "web" ? "fetch" : "xhr",
        fetchImpl,
        timeoutMs,
      }
    : null;

  if (platform !== "web") {
    if (!shared) return null;
    return createCallRouter({
      spaceBunny: shared,
      openrouter: { ...shared, model: named },
      order: ["space-bunny", "openrouter"],
    });
  }

  return createCallRouter({
    puter: { model: PUTER_MODEL, loadPuter, timeoutMs },
    ...(shared
      ? {
          spaceBunny: shared,
          openrouter: { ...shared, model: named },
        }
      : {}),
    order: ["puter", "space-bunny", "openrouter"],
  });
}
