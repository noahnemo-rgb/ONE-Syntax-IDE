// Vercel caps request bodies at 4.5 MB; larger projects should use the GitHub App.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const ZIP_END_OF_CENTRAL_DIR = [0x50, 0x4b, 0x05, 0x06];

export type UploadCheck = { ok: true } | { ok: false; error: string };

export function checkZipArchive(bytes: Uint8Array): UploadCheck {
  if (bytes.length === 0) return { ok: false, error: "The archive is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `Archives are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Use the GitHub App for larger projects.` };
  }
  if (!ZIP_LOCAL_HEADER.every((b, i) => bytes[i] === b)) {
    return { ok: false, error: "That file is not a .zip archive." };
  }
  // The end-of-central-directory record sits in the last 64 KB + 22 bytes.
  const start = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (ZIP_END_OF_CENTRAL_DIR.every((b, j) => bytes[i + j] === b)) return { ok: true };
  }
  return { ok: false, error: "The archive looks truncated or corrupt." };
}

export function sanitizeProjectName(input: string, fallback: string): string {
  const cleaned = input.replace(/[^\w.\- ]+/g, "").trim().slice(0, 80);
  return cleaned || fallback;
}
