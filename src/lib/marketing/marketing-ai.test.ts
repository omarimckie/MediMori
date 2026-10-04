import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  DEFAULT_AI_MULTIMODAL_TIMEOUT_MS,
  MockAIProvider,
  OpenAIProvider,
  type AIProvider,
} from "./ai";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "ai-test-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("MockAIProvider legacy generateText unchanged", async () => {
  const provider = new MockAIProvider();
  const text = await provider.generateText({ task: "t", prompt: "hello world" });
  assert.match(text, /\[mock:t\]/);
});

test("MockAIProvider multimodal returns fallback structured payload", async () => {
  const provider = new MockAIProvider();
  const fallback = { mode: "shared", sharedBody: "ok" };
  const result = await provider.generateMultimodalStructuredOutput({
    task: "smart_upload_generate_captions",
    systemPrompt: "sys",
    userText: "user",
    image: { mimeType: "image/png", base64: "aa" },
    fallback,
  });
  assert.deepEqual(result, fallback);
});

test("OpenAI multimodal structured success via fetch mock", async () => {
  const provider = new OpenAIProvider("test-key");
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ mode: "shared", sharedBody: "Hi" }) } }],
      }),
      { status: 200 },
    );

  const result = await provider.generateMultimodalStructuredOutput<{ mode: string; sharedBody: string }>({
    task: "smart_upload_generate_captions",
    systemPrompt: "sys",
    userText: "user",
    image: { mimeType: "image/png", base64: "aa" },
    fallback: { mode: "shared", sharedBody: "fallback" },
  });
  assert.equal(result.sharedBody, "Hi");
});

test("OpenAI multimodal HTTP failure throws", async () => {
  const provider = new OpenAIProvider("test-key");
  globalThis.fetch = async () => new Response("err", { status: 500 });
  await assert.rejects(
    () =>
      provider.generateMultimodalStructuredOutput({
        task: "t",
        systemPrompt: "s",
        userText: "u",
        image: { mimeType: "image/png", base64: "x" },
        fallback: {},
      }),
    /OpenAI HTTP 500/,
  );
});

test("OpenAI multimodal malformed JSON throws", async () => {
  const provider = new OpenAIProvider("test-key");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), {
      status: 200,
    });
  await assert.rejects(
    () =>
      provider.generateMultimodalStructuredOutput({
        task: "t",
        systemPrompt: "s",
        userText: "u",
        image: { mimeType: "image/png", base64: "x" },
        fallback: { ok: true },
      }),
    /not valid JSON/i,
  );
});

test("OpenAI multimodal timeout aborts", async () => {
  const provider = new OpenAIProvider("test-key");
  globalThis.fetch = async (_input, init) => {
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };
  await assert.rejects(
    () =>
      provider.generateMultimodalStructuredOutput({
        task: "t",
        systemPrompt: "s",
        userText: "u",
        image: { mimeType: "image/png", base64: "x" },
        fallback: {},
        timeoutMs: 5,
      }),
    /timed out/i,
  );
});

test("DEFAULT_AI_MULTIMODAL_TIMEOUT_MS is positive", () => {
  assert.ok(DEFAULT_AI_MULTIMODAL_TIMEOUT_MS >= 30_000);
});

test("AIProvider interface includes multimodal method", () => {
  const provider: AIProvider = new MockAIProvider();
  assert.equal(typeof provider.generateMultimodalStructuredOutput, "function");
});
