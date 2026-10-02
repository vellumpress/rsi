import { serializeState } from "./storage";
import type { DeskState } from "../types";

/** Separate from the desk. Export of rsi.v2 must not contain this key. */
export const LLM_STORAGE_KEY = "rsi.llm";

export const DEFAULT_GROK_MODEL = "grok-4.7";
export const GROK_CHAT_URL = "https://api.x.ai/v1/chat/completions";

export interface LlmSettings {
  apiKey: string;
  model: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function emptyLlmSettings(): LlmSettings {
  return { apiKey: "", model: DEFAULT_GROK_MODEL };
}

export function resolveModel(model: string | null | undefined): string {
  const trimmed = model?.trim() ?? "";
  if (!trimmed) return DEFAULT_GROK_MODEL;
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(trimmed)) {
    throw new Error("Model id must be a short token such as grok-4.7. It is not sent until you save it.");
  }
  return trimmed;
}

export function loadLlmSettings(store: Pick<Storage, "getItem"> | null): LlmSettings {
  if (!store) return emptyLlmSettings();
  const raw = store.getItem(LLM_STORAGE_KEY);
  if (!raw) return emptyLlmSettings();
  try {
    const parsed = JSON.parse(raw) as { apiKey?: unknown; model?: unknown };
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: resolveModel(typeof parsed.model === "string" ? parsed.model : ""),
    };
  } catch {
    return emptyLlmSettings();
  }
}

export function saveLlmSettings(store: Store, settings: LlmSettings): void {
  const next = { apiKey: settings.apiKey.trim(), model: resolveModel(settings.model) };
  if (!next.apiKey) {
    store.removeItem(LLM_STORAGE_KEY);
    return;
  }
  store.setItem(LLM_STORAGE_KEY, JSON.stringify(next));
}

/** The desk file is the only export. The key must not appear in it. */
export function deskExportContainsSecret(state: DeskState, secret: string): boolean {
  if (!secret) return false;
  return serializeState(state).includes(secret);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function grokRequest(input: { apiKey: string; model?: string; messages: ChatMessage[] }): { url: string; body: string; headers: Record<string, string> } {
  const key = input.apiKey.trim();
  if (!key) throw new Error("Add an xAI API key in Settings. It stays in this browser.");
  return {
    url: GROK_CHAT_URL,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveModel(input.model),
      temperature: 0.2,
      messages: input.messages,
    }),
  };
}

export async function completeGrok(input: { apiKey: string; model?: string; messages: ChatMessage[] }): Promise<string> {
  const request = grokRequest(input);
  let response: Response;
  try {
    response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body });
  } catch {
    throw new Error(
      "The browser could not reach api.x.ai. A preflight from this app currently receives Access-Control-Allow-Origin. If xAI removes that, the smallest fix is a proxy you deploy under your own account that forwards the body and does not log the key. This site has no shared backend.",
    );
  }
  const payload = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
  if (!response.ok) {
    const message = payload?.error?.message || `xAI returned ${response.status}.`;
    throw new Error(message);
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error("xAI returned an empty reply. No card and no trade was written.");
  return text;
}
