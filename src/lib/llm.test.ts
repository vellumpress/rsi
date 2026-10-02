import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultState, serializeState } from "./storage";
import { AUTH_OPTIONS, forgetLegacySecrets, LEGACY_LLM_KEY } from "./supabase";
import { chatCompletionRequest, DEFAULT_GROK_MODEL, deskExportContainsSecret, grokFailureMessage, grokRequest, readSseDelta, resolveModel, RSI_CHAT_URL } from "./llm";

const messages = [{ role: "user" as const, content: "hello" }];

describe("signed-in grok", () => {
  it("keeps secrets out of the desk export and drops a leftover passcode", () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
    store.setItem(LEGACY_LLM_KEY, JSON.stringify({ passcode: "rsi-pass-secret", apiKey: "xai-test-secret" }));
    forgetLegacySecrets(store);
    expect(store.getItem(LEGACY_LLM_KEY)).toBeNull();
    const desk = defaultState("2026-10-02");
    expect(deskExportContainsSecret(desk, "rsi-pass-secret")).toBe(false);
    expect(deskExportContainsSecret(desk, "xai-test-secret")).toBe(false);
    expect(serializeState(desk).includes("xai-test-secret")).toBe(false);
  });

  it("sends the session token to the chat function and never a passcode or xAI key", () => {
    const request = grokRequest({ accessToken: "session-access-token", messages });
    expect(RSI_CHAT_URL).toBe("https://ojntnbaakfowmnrsetbb.supabase.co/functions/v1/rsi-chat");
    expect(request.url).toBe(RSI_CHAT_URL);
    expect(request.headers.Authorization).toBe("Bearer session-access-token");
    expect(request.headers["x-rsi-passcode"]).toBeUndefined();
    expect(request.body.includes("session-access-token")).toBe(false);
    expect(request.body.includes("xai-")).toBe(false);
    expect(JSON.parse(request.body).messages).toEqual(messages);
    expect(AUTH_OPTIONS.persistSession).toBe(true);
    expect(AUTH_OPTIONS.autoRefreshToken).toBe(true);
    expect(resolveModel("")).toBe(DEFAULT_GROK_MODEL);
  });

  it("names a private desk and a rate limit", () => {
    expect(grokFailureMessage(403, { error: "nope" })).toBe("This RSI desk is private.");
    expect(grokFailureMessage(429, { error: "slow down" })).toMatch(/rate limited/i);
    expect(grokFailureMessage(401, {})).toMatch(/Sign in again/);
  });
});

describe("function gates", () => {
  const chat = readFileSync("supabase/functions/rsi-chat/index.ts", "utf8");
  const onboard = readFileSync("supabase/functions/rsi-onboard/index.ts", "utf8");
  const daily = readFileSync("supabase/functions/rsi-daily/index.ts", "utf8");

  it("checks the allowlist before any Grok call", () => {
    for (const source of [chat, onboard, daily]) {
      expect(source).toContain("This RSI desk is private.");
      expect(source).toContain("allowlist");
    }
    expect(chat.indexOf("allowlist")).toBeLessThan(chat.indexOf("api.x.ai"));
    expect(onboard).not.toContain("api.x.ai");
    expect(daily).not.toContain("api.x.ai");
    expect(daily).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(chat).toContain("verify the signed-in user");
    expect(chat.indexOf("user_feedback")).toBeLessThan(chat.indexOf("api.x.ai"));
    expect(chat).toContain("immutable");
    expect(chat).toContain("stream");
    expect(chat).not.toContain("proposeRuleChange");
  });

  it("matches the live chat-completions shape and reads a streamed delta", () => {
    const body = chatCompletionRequest({ model: "grok-4.7", temperature: 0.2, messages, stream: true });
    expect(body).toEqual({ model: "grok-4.7", temperature: 0.2, messages, stream: true });
    expect(body).not.toHaveProperty("api_key");
    const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n';
    expect(readSseDelta(chunk)).toBe("Hello");
  });
});
