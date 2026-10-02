import { serializeState } from "./storage";
import type { DeskState } from "../types";

/** Separate from the desk. Export of rsi.v2 must not contain a key or a passcode. */
export const LLM_STORAGE_KEY = "rsi.llm";

/** Most capable chat model named in the xAI docs. */
export const DEFAULT_GROK_MODEL = "grok-4.7";
export const GROK_CHAT_URL = "https://api.x.ai/v1/chat/completions";
export const RSI_GROK_URL = "https://thuxsshowkxacbfjdaks.supabase.co/functions/v1/rsi-grok";

export type GrokMode = "server" | "key";

export interface LlmSettings {
  mode: GrokMode;
  apiKey: string;
  passcode: string;
  model: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function emptyLlmSettings(): LlmSettings {
  return { mode: "server", apiKey: "", passcode: "", model: DEFAULT_GROK_MODEL };
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
    const parsed = JSON.parse(raw) as { mode?: unknown; apiKey?: unknown; passcode?: unknown; model?: unknown };
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    const passcode = typeof parsed.passcode === "string" ? parsed.passcode : "";
    const mode: GrokMode = parsed.mode === "key" || parsed.mode === "server" ? parsed.mode : apiKey ? "key" : "server";
    return {
      mode,
      apiKey,
      passcode,
      model: resolveModel(typeof parsed.model === "string" ? parsed.model : ""),
    };
  } catch {
    return emptyLlmSettings();
  }
}

export function saveLlmSettings(store: Store, settings: LlmSettings): void {
  const next: LlmSettings = {
    mode: settings.mode === "key" ? "key" : "server",
    apiKey: settings.apiKey.trim(),
    passcode: settings.passcode.trim(),
    model: resolveModel(settings.model),
  };
  if (!next.apiKey && !next.passcode) {
    store.removeItem(LLM_STORAGE_KEY);
    return;
  }
  store.setItem(LLM_STORAGE_KEY, JSON.stringify(next));
}

export function hasGrokCredential(settings: LlmSettings): boolean {
  return settings.mode === "key" ? settings.apiKey.trim().length > 0 : settings.passcode.trim().length > 0;
}

/** The desk file is the only export. A key or passcode must not appear in it. */
export function deskExportContainsSecret(state: DeskState, secret: string): boolean {
  if (!secret) return false;
  return serializeState(state).includes(secret);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function grokRequest(input: { settings: LlmSettings; messages: ChatMessage[] }): { url: string; body: string; headers: Record<string, string> } {
  const model = resolveModel(input.settings.model);
  const body = JSON.stringify({
    model,
    temperature: 0.2,
    messages: input.messages,
  });
  if (input.settings.mode === "key") {
    const key = input.settings.apiKey.trim();
    if (!key) throw new Error("Add an xAI API key in Settings. It stays in this browser.");
    return {
      url: GROK_CHAT_URL,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
    };
  }
  const passcode = input.settings.passcode.trim();
  if (!passcode) throw new Error("Add the RSI server passcode in Settings. It stays in this browser.");
  return {
    url: RSI_GROK_URL,
    headers: {
      "x-rsi-passcode": passcode,
      "Content-Type": "application/json",
    },
    body,
  };
}

export function grokFailureMessage(status: number, payload: unknown, mode: GrokMode, secret = ""): string {
  if (status === 401) {
    return mode === "server"
      ? "The passcode was refused. Check it in Settings. Nothing was written."
      : "xAI refused that API key. Check it in Settings. Nothing was written.";
  }
  if (status === 429) {
    return mode === "server"
      ? "The RSI server rate limited this request. Wait and try again. Nothing was written."
      : "xAI rate limited this request. Wait and try again. Nothing was written.";
  }
  const record = payload && typeof payload === "object" ? (payload as { error?: unknown }) : null;
  const nested = record?.error;
  const text = typeof nested === "string" ? nested : nested && typeof nested === "object" && typeof (nested as { message?: unknown }).message === "string" ? (nested as { message: string }).message : "";
  const fallback = status === 400 ? "Grok rejected the request." : status === 502 ? "Grok did not answer. Try again." : `Grok returned ${status}.`;
  return redact(text || fallback, secret);
}

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

export async function completeGrok(input: { settings: LlmSettings; messages: ChatMessage[] }): Promise<string> {
  const request = grokRequest(input);
  const secret = input.settings.mode === "key" ? input.settings.apiKey.trim() : input.settings.passcode.trim();
  let response: Response;
  try {
    response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body });
  } catch {
    throw new Error(
      input.settings.mode === "server"
        ? "The browser could not reach the RSI server. That host accepts the published site only. Nothing was written."
        : "The browser could not reach api.x.ai. Nothing was written.",
    );
  }
  const payload = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  if (!response.ok) throw new Error(grokFailureMessage(response.status, payload, input.settings.mode, secret));
  const text = payload?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error("Grok returned an empty reply. No card and no trade was written.");
  return text;
}
