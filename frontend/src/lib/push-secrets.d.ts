export const GH_PAT_KEY: "syntax.gh_pat";
export const WEBHOOK_TOKEN_KEY: "syntax.webhook_token";
export const PUSH_SECRET_KEYS: readonly ["syntax.gh_pat", "syntax.webhook_token"];

export interface PushSecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  clear(name: string): Promise<void>;
  hint(name: string): Promise<string>;
}

export function createPushSecretStore(options: {
  platform: "web" | "native";
  secureStore?: {
    get(key: string): Promise<string | null> | string | null;
    set(key: string, value: string): Promise<void> | void;
    delete(key: string): Promise<void> | void;
  };
}): PushSecretStore;

export function takeDurablePushSecrets(storage?: {
  getItem(key: string): string | null;
  removeItem(key: string): void;
} | null): Record<string, string>;

export function hideSecret(message: string, secret?: string): string;
