import {
  createLocalStorageStore,
  createMemoryStore,
  createProviderKeyStore,
  createProviderSelectionStore,
  PROVIDER_KEY_NAMES,
} from "ai-buffer";

/** Providers that store a user key. Puter is sign-in only. */
export const KEYED_PROVIDER_IDS = [
  "openrouter",
  "space-bunny",
  "vercel-gateway",
  "gemini",
  "nvidia",
  "llmapi",
];

export const LEGACY_OPENROUTER_KEY = "syntax.openrouter_key";
export const LEGACY_OPENROUTER_MODEL = "syntax.openrouter_model";

/**
 * Web keys live in one memory map for this page load.
 * Native keys live in the secure store passed in (expo-secure-store).
 * The selection store may use localStorage for the provider id and model id only.
 */
export function createSyntaxProviderStores({ platform, secureStore, webStorage }) {
  if (platform !== "web" && platform !== "native") {
    throw new Error("platform must be web or native");
  }
  const keyBackend = platform === "web" ? createMemoryStore() : secureStore;
  if (!keyBackend) {
    throw new Error("native provider keys need a secure store");
  }
  const keyStores = {};
  for (const id of KEYED_PROVIDER_IDS) {
    keyStores[id] = createProviderKeyStore(keyBackend, id);
  }
  const selectionBackend =
    platform === "web"
      ? webStorage
        ? createLocalStorageStore(webStorage)
        : createMemoryStore()
      : secureStore;
  return {
    keyStores,
    selection: createProviderSelectionStore(selectionBackend),
  };
}

/** Read leftover provider keys, then delete them from durable web storage. */
export function takeDurableProviderKeys(storage) {
  if (!storage) return {};
  const names = [LEGACY_OPENROUTER_KEY, ...Object.values(PROVIDER_KEY_NAMES)];
  const found = {};
  for (const name of names) {
    const value = storage.getItem(name);
    if (typeof value === "string" && value.trim()) found[name] = value;
    storage.removeItem(name);
  }
  return found;
}
