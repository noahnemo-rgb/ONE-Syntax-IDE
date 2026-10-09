import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DASHBOARD_LABELS,
  loadDashboard,
  PROVIDER_KEY_NAMES,
  type AiProviderId,
  type DashboardRow,
  type KeyedProviderId,
  type ProviderKeyStore,
  type ProviderSelectionStore,
} from "ai-buffer";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { AiProviderInfo } from "./ai-chat-shared";
import {
  createSyntaxProviderStores,
  LEGACY_OPENROUTER_KEY,
  LEGACY_OPENROUTER_MODEL,
  takeDurableProviderKeys,
} from "./ai-provider-stores.js";

const secureStore = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: (key: string) => SecureStore.deleteItemAsync(key),
};

type Stores = ReturnType<typeof createSyntaxProviderStores>;

let cached: Stores | null = null;
let migration: Promise<void> | null = null;

function browserBucket(
  name: "localStorage" | "sessionStorage",
): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | undefined {
  if (Platform.OS !== "web") return undefined;
  try {
    return (globalThis as { localStorage?: Storage; sessionStorage?: Storage })[name];
  } catch {
    return undefined;
  }
}

export function getProviderStores(): Stores {
  if (cached) return cached;
  const web = Platform.OS === "web";
  cached = createSyntaxProviderStores({
    platform: web ? "web" : "native",
    secureStore,
    webStorage: browserBucket("localStorage"),
  });
  return cached;
}

export function keyStoreFor(provider: KeyedProviderId): ProviderKeyStore {
  return getProviderStores().keyStores[provider];
}

export function providerSelection(): ProviderSelectionStore {
  return getProviderStores().selection;
}

async function deleteSecure(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Missing keys reject on some native versions.
  }
}

function migrateLegacy(): Promise<void> {
  if (!migration) {
    migration = migrateLegacyOnce().catch((error) => {
      migration = null;
      throw error;
    });
  }
  return migration;
}

async function migrateLegacyOnce(): Promise<void> {
  const stores = getProviderStores();
  if (Platform.OS === "web") {
    const durable = [browserBucket("localStorage"), browserBucket("sessionStorage")];
    let legacyKey = (await AsyncStorage.getItem(LEGACY_OPENROUTER_KEY)) ?? "";
    let legacyModel = (await AsyncStorage.getItem(LEGACY_OPENROUTER_MODEL)) ?? "";
    for (const storage of durable) {
      const found = takeDurableProviderKeys(storage);
      legacyKey = legacyKey || found[LEGACY_OPENROUTER_KEY] || found[PROVIDER_KEY_NAMES.openrouter] || "";
      for (const id of Object.keys(PROVIDER_KEY_NAMES) as KeyedProviderId[]) {
        const saved = found[PROVIDER_KEY_NAMES[id]];
        if (saved && !(await stores.keyStores[id].getKey())) {
          await stores.keyStores[id].setKey(saved);
        }
      }
    }
    if (legacyKey.trim() && !(await stores.keyStores.openrouter.getKey())) {
      await stores.keyStores.openrouter.setKey(legacyKey);
    }
    if (legacyModel.trim()) {
      try {
        await stores.selection.setModel("openrouter", legacyModel);
      } catch {
        // A key-shaped model is rejected and not stored.
      }
    }
    await AsyncStorage.removeItem(LEGACY_OPENROUTER_KEY);
    await AsyncStorage.removeItem(LEGACY_OPENROUTER_MODEL);
    return;
  }

  const legacyKey = (await SecureStore.getItemAsync(LEGACY_OPENROUTER_KEY)) ?? "";
  const legacyModel = (await SecureStore.getItemAsync(LEGACY_OPENROUTER_MODEL)) ?? "";
  if (legacyKey.trim() && !(await stores.keyStores.openrouter.getKey())) {
    await stores.keyStores.openrouter.setKey(legacyKey);
  }
  if (legacyModel.trim()) {
    try {
      await stores.selection.setModel("openrouter", legacyModel);
    } catch {
      // A key-shaped model is rejected and not stored.
    }
  }
  await deleteSecure(LEGACY_OPENROUTER_KEY);
  await deleteSecure(LEGACY_OPENROUTER_MODEL);
}

async function last4(provider: KeyedProviderId): Promise<string> {
  const key = await keyStoreFor(provider).getKey();
  if (!key || key.length < 4) return "";
  return key.slice(-4);
}

export async function loadSyntaxDashboard(puterSignedIn: boolean): Promise<DashboardRow[]> {
  await migrateLegacy();
  const stores = getProviderStores();
  const openrouter = Boolean(await stores.keyStores.openrouter.getKey());
  const [gateway, gemini, nvidia, llmapi] = await Promise.all([
    stores.keyStores["vercel-gateway"].getKey(),
    stores.keyStores.gemini.getKey(),
    stores.keyStores.nvidia.getKey(),
    stores.keyStores.llmapi.getKey(),
  ]);
  const keyHints: Partial<Record<AiProviderId, string>> = {
    openrouter: await last4("openrouter"),
    "space-bunny": await last4("space-bunny"),
    "vercel-gateway": gateway && gateway.length >= 4 ? gateway.slice(-4) : "",
    gemini: gemini && gemini.length >= 4 ? gemini.slice(-4) : "",
    nvidia: nvidia && nvidia.length >= 4 ? nvidia.slice(-4) : "",
    llmapi: llmapi && llmapi.length >= 4 ? llmapi.slice(-4) : "",
  };
  return loadDashboard(stores.selection, {
    puterSignedIn,
    openrouterKey: openrouter,
    gatewayKey: Boolean(gateway),
    geminiKey: Boolean(gemini),
    nvidiaKey: Boolean(nvidia),
    llmapiKey: Boolean(llmapi),
    keyHints,
  });
}

export async function loadProviderSummary(puterSignedIn: boolean): Promise<AiProviderInfo> {
  const rows = await loadSyntaxDashboard(puterSignedIn);
  const active = rows.find((row) => row.activeLabel === DASHBOARD_LABELS.active);
  const any = rows.some((row) => row.configured);
  return {
    label: active?.label ?? "ai-buffer",
    description: active?.status ?? (any ? DASHBOARD_LABELS.configured : DASHBOARD_LABELS.notConfigured),
    configured: any,
  };
}

export async function loadChatRouterOptions(platform: "web" | "native") {
  await migrateLegacy();
  const stores = getProviderStores();
  const [openrouterKey, gateway, gemini, nvidia, llmapi, chosen, model] = await Promise.all([
    stores.keyStores.openrouter.getKey(),
    stores.keyStores["vercel-gateway"].getKey(),
    stores.keyStores.gemini.getKey(),
    stores.keyStores.nvidia.getKey(),
    stores.keyStores.llmapi.getKey(),
    stores.selection.getSelection(),
    stores.selection.getModel("openrouter"),
  ]);
  return {
    platform,
    apiKey: openrouterKey ?? "",
    model,
    keys: {
      vercelGateway: gateway ?? "",
      gemini: gemini ?? "",
      nvidia: nvidia ?? "",
      llmapi: llmapi ?? "",
    },
    selection: chosen,
  };
}
