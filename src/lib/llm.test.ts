import { describe, expect, it } from "vitest";
import { defaultState, serializeState } from "./storage";
import {
  DEFAULT_GROK_MODEL,
  GROK_CHAT_URL,
  LLM_STORAGE_KEY,
  RSI_GROK_URL,
  deskExportContainsSecret,
  grokFailureMessage,
  grokRequest,
  hasGrokCredential,
  loadLlmSettings,
  resolveModel,
  saveLlmSettings,
  type LlmSettings,
} from "./llm";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

const messages = [{ role: "user" as const, content: "hello" }];

describe("llm connection", () => {
  it("keeps a passcode and an xAI key out of the desk export", () => {
    const store = memoryStore();
    saveLlmSettings(store, { mode: "server", apiKey: "", passcode: "rsi-pass-secret", model: "" });
    expect(store.data.has(LLM_STORAGE_KEY)).toBe(true);
    expect(store.data.has("rsi.v2")).toBe(false);
    expect(loadLlmSettings(store)).toMatchObject({ mode: "server", passcode: "rsi-pass-secret", model: DEFAULT_GROK_MODEL });
    const desk = defaultState("2026-10-02");
    expect(deskExportContainsSecret(desk, "rsi-pass-secret")).toBe(false);
    expect(serializeState(desk).includes("rsi-pass-secret")).toBe(false);
    expect(serializeState(desk).includes("xai-test-secret")).toBe(false);
  });

  it("routes server mode to the RSI function and key mode to api.x.ai", () => {
    const server: LlmSettings = { mode: "server", apiKey: "xai-test-secret", passcode: "rsi-pass-secret", model: "grok-4.7" };
    const viaServer = grokRequest({ settings: server, messages });
    expect(RSI_GROK_URL).toBe("https://ojntnbaakfowmnrsetbb.supabase.co/functions/v1/rsi-grok");
    expect(viaServer.url).toBe(RSI_GROK_URL);
    expect(viaServer.headers["x-rsi-passcode"]).toBe("rsi-pass-secret");
    expect(viaServer.headers.Authorization).toBeUndefined();
    expect(viaServer.body.includes("rsi-pass-secret")).toBe(false);
    expect(viaServer.body.includes("xai-test-secret")).toBe(false);
    expect(JSON.parse(viaServer.body).model).toBe("grok-4.7");

    const viaKey = grokRequest({ settings: { ...server, mode: "key" }, messages });
    expect(viaKey.url).toBe(GROK_CHAT_URL);
    expect(viaKey.headers.Authorization).toBe("Bearer xai-test-secret");
    expect(viaKey.headers["x-rsi-passcode"]).toBeUndefined();
    expect(hasGrokCredential({ ...server, passcode: "" })).toBe(false);
    expect(hasGrokCredential({ ...server, mode: "key", apiKey: "" })).toBe(false);
    expect(resolveModel("grok-4.5")).toBe("grok-4.5");
  });

  it("names a bad passcode and a rate limit without repeating the secret", () => {
    expect(grokFailureMessage(401, { error: "nope rsi-pass-secret" }, "server", "rsi-pass-secret")).toBe(
      "The passcode was refused. Check it in Settings. Nothing was written.",
    );
    expect(grokFailureMessage(429, { error: "slow down" }, "server", "rsi-pass-secret")).toMatch(/rate limited/i);
    expect(grokFailureMessage(429, { error: "slow down" }, "server", "rsi-pass-secret")).not.toMatch(/rsi-pass-secret/);
    expect(grokFailureMessage(502, { error: "upstream rsi-pass-secret failed" }, "server", "rsi-pass-secret")).toBe("upstream [redacted] failed");
    expect(grokFailureMessage(400, { error: "bad model" }, "key")).toBe("bad model");
  });

  it("keeps an older saved key on the key path", () => {
    const store = memoryStore();
    store.setItem(LLM_STORAGE_KEY, JSON.stringify({ apiKey: "xai-test-secret", model: "grok-4.7" }));
    expect(loadLlmSettings(store).mode).toBe("key");
  });

  it("refuses a model id that is not a token", () => {
    expect(() => resolveModel("grok 4; rm")).toThrow(/token/);
  });
});
