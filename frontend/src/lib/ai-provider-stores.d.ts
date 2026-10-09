import type { KeyedProviderId, ProviderKeyStore, ProviderSelectionStore, SecretStore } from "ai-buffer";

export const KEYED_PROVIDER_IDS: readonly KeyedProviderId[];
export const LEGACY_OPENROUTER_KEY: "syntax.openrouter_key";
export const LEGACY_OPENROUTER_MODEL: "syntax.openrouter_model";

export interface WebKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SyntaxProviderStores {
  keyStores: Record<KeyedProviderId, ProviderKeyStore>;
  selection: ProviderSelectionStore;
}

export function createSyntaxProviderStores(options: {
  platform: "web" | "native";
  secureStore: SecretStore;
  webStorage?: WebKeyValueStorage;
}): SyntaxProviderStores;

export function takeDurableProviderKeys(storage?: WebKeyValueStorage | null): Record<string, string>;
