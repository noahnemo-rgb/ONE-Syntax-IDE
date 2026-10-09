// Push / share destinations. All calls are made directly from the client so
// user secrets (GitHub PAT, webhook token) never touch our backend.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { maskKeyHint } from "ai-buffer";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

import {
  GH_PAT_KEY,
  PUSH_SECRET_KEYS,
  WEBHOOK_TOKEN_KEY,
  createPushSecretStore,
  hideSecret,
  takeDurablePushSecrets,
  type PushSecretStore,
} from "./push-secrets.js";

const secureStore = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: async (key: string) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Missing keys reject on some native versions.
    }
  },
};

let secretStore: PushSecretStore | null = null;
let secretMigration: Promise<void> | null = null;

function browserBucket(name: "localStorage" | "sessionStorage") {
  if (Platform.OS !== "web") return undefined;
  try {
    return (globalThis as { localStorage?: Storage; sessionStorage?: Storage })[name];
  } catch {
    return undefined;
  }
}

function getPushSecrets(): PushSecretStore {
  if (secretStore) return secretStore;
  secretStore = createPushSecretStore({
    platform: Platform.OS === "web" ? "web" : "native",
    secureStore,
  });
  return secretStore;
}

function migratePushSecrets(): Promise<void> {
  if (!secretMigration) {
    secretMigration = migratePushSecretsOnce().catch((error) => {
      secretMigration = null;
      throw error;
    });
  }
  return secretMigration;
}

async function migratePushSecretsOnce(): Promise<void> {
  if (Platform.OS !== "web") return;
  const store = getPushSecrets();
  const found: Record<string, string> = {};
  for (const key of PUSH_SECRET_KEYS) {
    const value = await AsyncStorage.getItem(key);
    if (value?.trim()) found[key] = value;
  }
  for (const bucket of [browserBucket("localStorage"), browserBucket("sessionStorage")]) {
    const lifted = takeDurablePushSecrets(bucket);
    for (const key of PUSH_SECRET_KEYS) {
      if (!found[key] && lifted[key]) found[key] = lifted[key];
    }
  }
  for (const key of PUSH_SECRET_KEYS) {
    const value = found[key];
    if (value?.trim() && !(await store.get(key))) await store.set(key, value);
    await AsyncStorage.removeItem(key);
  }
}

async function readSecret(name: string): Promise<string | null> {
  await migratePushSecrets();
  return getPushSecrets().get(name);
}

async function writeSecret(name: string, value: string): Promise<void> {
  await migratePushSecrets();
  await getPushSecrets().set(name, value);
}

async function clearSecret(name: string): Promise<void> {
  await migratePushSecrets();
  await getPushSecrets().clear(name);
}

async function secretHint(name: string): Promise<string> {
  await migratePushSecrets();
  return getPushSecrets().hint(name);
}

// --- GitHub PAT ---
export const githubPat = {
  get: () => readSecret(GH_PAT_KEY),
  set: (t: string) => writeSecret(GH_PAT_KEY, t),
  clear: () => clearSecret(GH_PAT_KEY),
  hint: () => secretHint(GH_PAT_KEY),
};

// --- GitHub push config (non-secret) ---
export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string; // path prefix or full path
}
const GH_CFG_KEY = "syntax.gh_cfg";
export async function loadGitHubConfig(): Promise<GitHubConfig | null> {
  const raw = await AsyncStorage.getItem(GH_CFG_KEY);
  return raw ? (JSON.parse(raw) as GitHubConfig) : null;
}
export async function saveGitHubConfig(c: GitHubConfig): Promise<void> {
  await AsyncStorage.setItem(GH_CFG_KEY, JSON.stringify(c));
}

// --- Webhook config ---
export interface WebhookConfig {
  url: string;
}
const WH_CFG_KEY = "syntax.webhook_cfg";
export const webhookToken = {
  get: () => readSecret(WEBHOOK_TOKEN_KEY),
  set: (t: string) => writeSecret(WEBHOOK_TOKEN_KEY, t),
  clear: () => clearSecret(WEBHOOK_TOKEN_KEY),
  hint: () => secretHint(WEBHOOK_TOKEN_KEY),
};

export { hideSecret };
export async function loadWebhookConfig(): Promise<WebhookConfig | null> {
  const raw = await AsyncStorage.getItem(WH_CFG_KEY);
  return raw ? (JSON.parse(raw) as WebhookConfig) : null;
}
export async function saveWebhookConfig(c: WebhookConfig): Promise<void> {
  await AsyncStorage.setItem(WH_CFG_KEY, JSON.stringify(c));
}

// --- Base64 encode (UTF-8 safe, cross-platform) ---
function utf8ToBase64(text: string): string {
  const g = globalThis as { btoa?: (s: string) => string; Buffer?: { from: (t: string, e: string) => { toString: (e: string) => string } } };
  if (g.btoa) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((b: number) => (binary += String.fromCharCode(b)));
    return g.btoa(binary);
  }
  if (g.Buffer) return g.Buffer.from(text, "utf-8").toString("base64");
  throw new Error("No Base64 encoder available");
}

// --- Redact a token for error messages ---
export function redact(token: string): string {
  return maskKeyHint(token);
}

// --- GitHub push (create or update a single file) ---
export interface GitHubPushResult {
  commitSha: string;
  url: string;
}

export async function pushToGitHub(opts: {
  pat: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  message: string;
  content: string;
}): Promise<GitHubPushResult> {
  const { pat, owner, repo, branch, path, message, content } = opts;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "SyntaxMobileIDE/1.0",
    "Content-Type": "application/json",
  };
  // 1) Look up current SHA (if file exists) so we can update in place
  let sha: string | undefined;
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
  if (getRes.ok) {
    const j = await getRes.json();
    if (!Array.isArray(j)) sha = j.sha;
  } else if (getRes.status !== 404) {
    const body = await getRes.text();
    throw new Error(hideSecret(`GitHub read failed (${getRes.status}): ${body.slice(0, 200)}`, pat));
  }
  // 2) PUT create/update
  const putRes = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message,
      content: utf8ToBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(hideSecret(`GitHub push failed (${putRes.status}): ${body.slice(0, 200)}`, pat));
  }
  const json = await putRes.json();
  return {
    commitSha: json.commit?.sha ?? "",
    url: json.content?.html_url ?? "",
  };
}

// --- Custom webhook push (HTTPS only) ---
export async function pushToWebhook(opts: {
  url: string;
  token?: string;
  filename: string;
  language: string;
  content: string;
}): Promise<{ status: number }> {
  const { url, token, filename, language, content } = opts;
  if (!/^https:\/\//i.test(url)) throw new Error("Webhook URL must use https://");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "SyntaxMobileIDE/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ filename, language, content, timestamp: new Date().toISOString() }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(hideSecret(`Webhook responded ${res.status}: ${body.slice(0, 200)}`, token ?? ""));
  }
  return { status: res.status };
}

// --- Native share (OS share sheet) ---
export type ShareResult = { kind: "share" } | { kind: "clipboard"; message: string } | { kind: "cancelled" };

export async function shareViaNative(opts: { filename: string; content: string }): Promise<ShareResult> {
  const { filename, content } = opts;
  // On mobile: write to cache and open the Share sheet with the file.
  if (Platform.OS === "ios" || Platform.OS === "android") {
    if (await Sharing.isAvailableAsync()) {
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { dialogTitle: `Share ${filename}` });
      return { kind: "share" };
    }
  }
  // Web: try the Web Share API first, then fall back to clipboard.
  if (Platform.OS === "web") {
    const nav = (globalThis as { navigator?: { share?: (d: { title: string; text: string }) => Promise<void>; clipboard?: { writeText: (s: string) => Promise<void> } } }).navigator;
    try {
      if (nav?.share) {
        await nav.share({ title: filename, text: content });
        return { kind: "share" };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort|cancel/i.test(msg)) return { kind: "cancelled" };
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(content);
      return { kind: "clipboard", message: `Copied ${filename} to clipboard — the Web Share API is unavailable in this browser.` };
    }
  }
  // Last-resort fallback: React Native Share text.
  await Share.share({ title: filename, message: content });
  return { kind: "share" };
}
