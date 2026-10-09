import { createMemoryStore, maskKeyHint, redactSecrets } from "ai-buffer";

export const GH_PAT_KEY = "syntax.gh_pat";
export const WEBHOOK_TOKEN_KEY = "syntax.webhook_token";
export const PUSH_SECRET_KEYS = [GH_PAT_KEY, WEBHOOK_TOKEN_KEY];

/**
 * Web secrets live in memory for this page load.
 * Native secrets live in the secure store passed in (expo-secure-store).
 */
export function createPushSecretStore({ platform, secureStore }) {
  if (platform !== "web" && platform !== "native") {
    throw new Error("platform must be web or native");
  }
  const backend = platform === "web" ? createMemoryStore() : secureStore;
  if (!backend) {
    throw new Error("native push secrets need a secure store");
  }
  return {
    get: async (name) => {
      const value = await backend.get(name);
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed || null;
    },
    set: async (name, value) => {
      await backend.set(name, String(value).trim());
    },
    clear: async (name) => {
      await backend.delete(name);
    },
    hint: async (name) => maskKeyHint((await backend.get(name)) ?? ""),
  };
}

/** Read leftover push secrets, then delete them from durable web storage. */
export function takeDurablePushSecrets(storage) {
  if (!storage) return {};
  const found = {};
  for (const name of PUSH_SECRET_KEYS) {
    const value = storage.getItem(name);
    if (typeof value === "string" && value.trim()) found[name] = value;
    storage.removeItem(name);
  }
  return found;
}

/** Error text may keep a masked hint. It must not keep the raw secret. */
export function hideSecret(message, secret) {
  const safe = redactSecrets(String(message ?? ""));
  const token = typeof secret === "string" ? secret.trim() : "";
  if (!token) return safe;
  return safe.split(token).join(maskKeyHint(token));
}
