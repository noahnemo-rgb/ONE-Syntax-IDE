import assert from "node:assert/strict";
import test from "node:test";
import { AiBufferError } from "ai-buffer";
import { createSyntaxRouter } from "./syntax-router.js";

function sse(text) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\ndata: [DONE]\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("web tries Puter, then Space Bunny Alpha, then the saved model", async () => {
  const models = [];
  const router = createSyntaxRouter({
    platform: "web",
    apiKey: "sk-test",
    model: "openai/gpt-4o-mini",
    timeoutMs: 1000,
    loadPuter: async () => {
      throw new Error("puter signed out");
    },
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      models.push(payload.model);
      if (models.length === 1) return new Response("slow down", { status: 429 });
      return sse("named");
    },
  });

  assert.equal(await router.streamChat({ message: "Explain this function" }), "named");
  assert.deepEqual(models, ["stealth/space-bunny-alpha", "openai/gpt-4o-mini"]);
  assert.equal(router.route("puter").id, "puter");
});

test("phone has no Puter route and starts at Space Bunny Alpha", () => {
  const router = createSyntaxRouter({
    platform: "native",
    apiKey: "sk-test",
    model: "openai/gpt-4o-mini",
  });
  assert.equal(router.route("space-bunny").id, "space-bunny");
  assert.throws(
    () => router.route("puter"),
    (error) => error instanceof AiBufferError && error.code === "provider_error",
  );
  assert.equal(createSyntaxRouter({ platform: "native", apiKey: "  " }), null);
});

test("a saved provider is tried first and Gemini keeps the key out of the URL", async () => {
  let seenUrl = "";
  let seenHeader = "";
  const router = createSyntaxRouter({
    platform: "web",
    apiKey: "",
    timeoutMs: 1000,
    keys: { gemini: "AIzaSyExampleKey123456789012345" },
    selection: { provider: "gemini", model: "gemini-3.8-flash" },
    fetchImpl: async (input, init) => {
      seenUrl = String(input);
      seenHeader = new Headers(init?.headers).get("x-goog-api-key") ?? "";
      const body = `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: "gem" }] } }],
      })}\n\n`;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });

  assert.equal(await router.streamChat({ message: "Explain this function" }), "gem");
  assert.match(seenUrl, /generativelanguage\.googleapis\.com/);
  assert.equal(seenUrl.includes("AIza"), false);
  assert.equal(seenUrl.includes("key="), false);
  assert.equal(seenHeader, "AIzaSyExampleKey123456789012345");
  assert.throws(
    () => router.route("vercel-gateway"),
    (error) => error instanceof AiBufferError && error.code === "provider_error",
  );
});
