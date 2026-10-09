import { createCallRouter, createRouterFromSelection } from "ai-buffer";

const APP_NAME = "Syntax Mobile IDE";
const SITE_URL = "https://syntax.ide";
const PUTER_MODEL = "openai/gpt-4o-mini";

const EXTRA = [
  ["vercelGateway", "vercel-gateway"],
  ["gemini", "gemini"],
  ["nvidia", "nvidia"],
  ["llmapi", "llmapi"],
];

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function routeReady(routes, provider) {
  if (provider === "puter") return Boolean(routes.puter);
  if (provider === "openrouter") return Boolean(routes.openrouter);
  if (provider === "space-bunny") return Boolean(routes.spaceBunny);
  return EXTRA.some(([optionName, id]) => id === provider && routes[optionName]);
}

/**
 * Web, with no saved provider: Puter, then Space Bunny Alpha, then OpenRouter.
 * Phone, with no saved provider: Space Bunny Alpha, then OpenRouter. No Puter route.
 * A saved selection from the dashboard is tried first.
 * A missing key leaves that provider's route off.
 */
export function createSyntaxRouter({
  platform,
  apiKey,
  model,
  fetchImpl,
  loadPuter,
  timeoutMs,
  keys,
  selection,
} = {}) {
  const openrouterKey = text(apiKey || keys?.openrouter);
  const named = text(model) || text(selection?.model) || PUTER_MODEL;
  const transport = platform === "web" ? "fetch" : "xhr";
  const base = {
    appName: APP_NAME,
    siteUrl: SITE_URL,
    transport,
    fetchImpl,
    timeoutMs,
  };
  const routes = {};

  if (platform === "web") {
    routes.puter = { model: PUTER_MODEL, loadPuter, timeoutMs };
  }
  if (openrouterKey) {
    routes.spaceBunny = { ...base, getApiKey: () => openrouterKey };
    routes.openrouter = { ...base, getApiKey: () => openrouterKey, model: named };
  }
  for (const [optionName, id] of EXTRA) {
    const providerKey = text(keys?.[optionName] ?? keys?.[id]);
    if (!providerKey) continue;
    const routeModel = selection?.provider === id ? text(selection.model) : "";
    routes[optionName] = {
      ...base,
      getApiKey: () => providerKey,
      ...(routeModel ? { model: routeModel } : {}),
    };
  }

  const hasKeyed = Boolean(
    routes.spaceBunny || routes.vercelGateway || routes.gemini || routes.nvidia || routes.llmapi,
  );
  if (platform !== "web" && !hasKeyed) return null;

  const chosen = text(selection?.provider);
  if (chosen && routeReady(routes, chosen)) {
    return createRouterFromSelection({ provider: chosen, model: text(selection.model) || named }, routes);
  }

  const order =
    platform === "web"
      ? ["puter", "space-bunny", "openrouter", "vercel-gateway", "gemini", "nvidia", "llmapi"]
      : ["space-bunny", "openrouter", "vercel-gateway", "gemini", "nvidia", "llmapi"];
  return createCallRouter({ ...routes, order });
}
