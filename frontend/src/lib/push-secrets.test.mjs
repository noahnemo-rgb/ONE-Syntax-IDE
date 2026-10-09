import assert from "node:assert/strict";
import test from "node:test";
import { createLocalStorageStore, createProviderKeyStore, maskKeyHint } from "ai-buffer";
import {
  GH_PAT_KEY,
  WEBHOOK_TOKEN_KEY,
  createPushSecretStore,
  hideSecret,
  takeDurablePushSecrets,
} from "./push-secrets.js";

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

const PAT = "github_pat_exampletoken1234567890abcd";
const HOOK = "whsec_exampletoken1234567890wxyz";

test("web push secrets stay in memory and durable copies are deleted", async () => {
  const local = memoryStorage({ [GH_PAT_KEY]: PAT });
  const session = memoryStorage({ [WEBHOOK_TOKEN_KEY]: HOOK });
  const secure = asyncStore();
  const store = createPushSecretStore({ platform: "web", secureStore: secure });

  const liftedLocal = takeDurablePushSecrets(local);
  const liftedSession = takeDurablePushSecrets(session);
  assert.equal(local.dump()[GH_PAT_KEY], undefined);
  assert.equal(session.dump()[WEBHOOK_TOKEN_KEY], undefined);
  await store.set(GH_PAT_KEY, liftedLocal[GH_PAT_KEY]);
  await store.set(WEBHOOK_TOKEN_KEY, liftedSession[WEBHOOK_TOKEN_KEY]);

  assert.equal(await store.hint(GH_PAT_KEY), maskKeyHint(PAT));
  assert.equal(await store.hint(WEBHOOK_TOKEN_KEY), "••••wxyz");
  assert.equal(JSON.stringify(local.dump()).includes(PAT), false);
  assert.equal(JSON.stringify(session.dump()).includes(HOOK), false);
  assert.deepEqual(secure.dump(), {});
  assert.equal((await store.hint(GH_PAT_KEY)).includes(PAT), false);
});

test("native push secrets use the secure store", async () => {
  const secure = asyncStore();
  const local = memoryStorage();
  const store = createPushSecretStore({ platform: "native", secureStore: secure });
  await store.set(GH_PAT_KEY, PAT);
  await store.set(WEBHOOK_TOKEN_KEY, HOOK);
  assert.equal(secure.dump()[GH_PAT_KEY], PAT);
  assert.equal(secure.dump()[WEBHOOK_TOKEN_KEY], HOOK);
  assert.deepEqual(local.dump(), {});
  assert.equal(await store.hint(GH_PAT_KEY), "••••abcd");
  await store.clear(GH_PAT_KEY);
  assert.equal(await store.get(GH_PAT_KEY), null);
  assert.equal(await store.hint(GH_PAT_KEY), "");
});

test("error text keeps a masked hint and drops the raw secret", () => {
  const message = hideSecret(`GitHub push failed (401): token ${PAT}`, PAT);
  assert.equal(message.includes(PAT), false);
  assert.equal(message.includes("••••abcd"), true);
  const echoed = hideSecret(`Webhook responded 500: Bearer ${HOOK} and sk-or-v1-secretvalue1234567890abcd`, HOOK);
  assert.equal(echoed.includes(HOOK), false);
  assert.equal(echoed.includes("sk-or-v1"), false);
  assert.match(echoed, /\[redacted\]/);
  assert.equal(hideSecret("GitHub push failed (401): token", ""), "GitHub push failed (401): token");
});

test("localStorage cannot back a push secret store", () => {
  const local = memoryStorage();
  assert.throws(() => createProviderKeyStore(createLocalStorageStore(local), "openrouter"));
  const store = createPushSecretStore({ platform: "web", secureStore: asyncStore() });
  return store.set(GH_PAT_KEY, PAT).then(() => {
    assert.deepEqual(local.dump(), {});
  });
});
