import { describe, expect, it } from "vitest";
import { defaultState, serializeState } from "./storage";
import { DEFAULT_GROK_MODEL, GROK_CHAT_URL, LLM_STORAGE_KEY, deskExportContainsSecret, grokRequest, loadLlmSettings, resolveModel, saveLlmSettings } from "./llm";

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

describe("llm key storage", () => {
  it("keeps the xAI key out of the desk export and defaults the model to grok-4.7", () => {
    const store = memoryStore();
    saveLlmSettings(store, { apiKey: "xai-test-secret", model: "" });
    expect(store.data.has(LLM_STORAGE_KEY)).toBe(true);
    expect(store.data.has("rsi.v2")).toBe(false);
    expect(loadLlmSettings(store).model).toBe(DEFAULT_GROK_MODEL);
    const desk = defaultState("2026-10-02");
    expect(deskExportContainsSecret(desk, "xai-test-secret")).toBe(false);
    expect(serializeState(desk).includes("xai-test-secret")).toBe(false);
    const request = grokRequest({ apiKey: "xai-test-secret", messages: [{ role: "user", content: "hello" }] });
    expect(request.url).toBe(GROK_CHAT_URL);
    expect(request.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(JSON.parse(request.body).model).toBe("grok-4.7");
    expect(request.headers.Authorization).toBe("Bearer xai-test-secret");
    expect(resolveModel("grok-4.5")).toBe("grok-4.5");
  });

  it("refuses a model id that is not a token", () => {
    expect(() => resolveModel("grok 4; rm")).toThrow(/token/);
  });
});
