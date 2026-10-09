import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalStorageStore,
  createProviderKeyStore,
  DASHBOARD_LABELS,
  loadDashboard,
  looksLikeSecret,
  PROVIDER_CATALOG,
} from "ai-buffer";
import {
  createSyntaxProviderStores,
  KEYED_PROVIDER_IDS,
  LEGACY_OPENROUTER_KEY,
  takeDurableProviderKeys,
} from "./ai-provider-stores.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    dump() {
      return Object.fromEntries(values);
    },
  };
}

function asyncStore() {
  const values = new Map();
  return {
    get: async (key) => (values.has(key) ? values.get(key) : null),
    set: async (key, value) => {
      values.set(key, String(value));
    },
    delete: async (key) => {
      values.delete(key);
    },
    dump() {
      return Object.fromEntries(values);
    },
  };
}

const APPROVED = new Set([
  "ai-buffer",
  DASHBOARD_LABELS.model,
  DASHBOARD_LABELS.active,
  DASHBOARD_LABELS.configured,
  DASHBOARD_LABELS.notConfigured,
  ...PROVIDER_CATALOG.map((item) => item.label),
  "",
]);

test("web keys stay in memory and localStorage keeps only the selection", async () => {
  const local = memoryStorage();
  const session = memoryStorage({
    [LEGACY_OPENROUTER_KEY]: "sk-or-v1-session-key-1234567890abcd",
  });
  const { keyStores, selection } = createSyntaxProviderStores({
    platform: "web",
    secureStore: asyncStore(),
    webStorage: local,
  });

  const lifted = takeDurableProviderKeys(session);
  assert.equal(lifted[LEGACY_OPENROUTER_KEY].endsWith("abcd"), true);
  assert.equal(session.dump()[LEGACY_OPENROUTER_KEY], undefined);
  await keyStores.openrouter.setKey(lifted[LEGACY_OPENROUTER_KEY]);

  await keyStores.gemini.setKey("AIzaSyExampleKey123456789012345");
  await keyStores["vercel-gateway"].setKey("gateway-example-key-1234567890ab12");
  await keyStores.nvidia.setKey("nvapi-example-key-1234567890wxyz");
  await keyStores.llmapi.setKey("llmapi-example-key-1234567890qrst");
  await selection.setProvider("vercel-gateway");
  await selection.setModel("vercel-gateway", "openai/gpt-4o-mini");

  const durable = JSON.stringify(local.dump());
  assert.equal(durable.includes("AIza"), false);
  assert.equal(durable.includes("sk-or"), false);
  assert.equal(durable.includes("nvapi-"), false);
  assert.equal(durable.includes("gateway-example"), false);
  assert.equal(durable.includes("llmapi-example"), false);
  assert.equal(looksLikeSecret(local.dump()["ai-buffer.model.vercel-gateway"]), false);
  await assert.rejects(() => selection.setModel("gemini", "sk-or-v1-not-a-model-value"));

  const rows = await loadDashboard(selection, {
    puterSignedIn: false,
    openrouterKey: true,
    gatewayKey: true,
    geminiKey: true,
    nvidiaKey: true,
    llmapiKey: true,
    keyHints: {
      openrouter: await keyStores.openrouter.getKey(),
      "space-bunny": await keyStores["space-bunny"].getKey(),
      "vercel-gateway": "ab12",
      gemini: await keyStores.gemini.getKey(),
      nvidia: await keyStores.nvidia.getKey(),
      llmapi: await keyStores.llmapi.getKey(),
    },
  });
  const labels = rows.map((row) => row.label);
  assert.deepEqual(labels, PROVIDER_CATALOG.map((item) => item.label));
  assert.equal(rows.find((row) => row.id === "vercel-gateway").keyHint, "••••ab12");
  assert.equal(rows.find((row) => row.id === "vercel-gateway").activeLabel, "active");
  const rendered = JSON.stringify(rows);
  assert.equal(rendered.includes("AIzaSyExample"), false);
  assert.equal(rendered.includes("sk-or-v1-session"), false);
  for (const row of rows) {
    for (const value of [row.label, row.status, row.activeLabel, row.modelLabel, row.keyHint]) {
      assert.equal(APPROVED.has(value) || /^••••.{4}$/.test(value), true, value);
    }
  }
  assert.equal(await keyStores["space-bunny"].getKey(), await keyStores.openrouter.getKey());
});

test("native secure store holds every provider key", async () => {
  const secure = asyncStore();
  const local = memoryStorage();
  const { keyStores, selection } = createSyntaxProviderStores({
    platform: "native",
    secureStore: secure,
    webStorage: local,
  });
  await keyStores.openrouter.setKey("sk-or-v1-phone-key-1234567890abcd");
  await keyStores["vercel-gateway"].setKey("gateway-phone-key-1234567890ab12");
  await keyStores.gemini.setKey("AIzaSyPhoneKey123456789012345678");
  await keyStores.nvidia.setKey("nvapi-phone-key-1234567890wxyz");
  await keyStores.llmapi.setKey("llmapi-phone-key-1234567890qrst");
  await selection.setProvider("nvidia");
  await selection.setModel("nvidia", "nvidia/nemotron-3-nano-30b-a3b");

  const saved = secure.dump();
  assert.equal(saved["ai-buffer.openrouter_key"].endsWith("abcd"), true);
  assert.ok(saved["ai-buffer.gateway_key"]);
  assert.ok(saved["ai-buffer.gemini_key"]);
  assert.ok(saved["ai-buffer.nvidia_key"]);
  assert.ok(saved["ai-buffer.llmapi_key"]);
  assert.equal(await keyStores["space-bunny"].getKey(), saved["ai-buffer.openrouter_key"]);
  assert.deepEqual(local.dump(), {});
  assert.equal(KEYED_PROVIDER_IDS.length, 6);
});

test("createLocalStorageStore cannot back a provider key", () => {
  const local = memoryStorage();
  assert.throws(() => createProviderKeyStore(createLocalStorageStore(local), "gemini"));
  assert.throws(() => createProviderKeyStore(createLocalStorageStore(local), "openrouter"));
});
