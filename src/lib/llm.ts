import { getSupabase, supabaseConfig } from "./supabase";
import { serializeState } from "./storage";
import type { DeskState } from "../types";

/** Most capable chat model named in the xAI docs. The server picks it. The browser cannot override the key. */
export const DEFAULT_GROK_MODEL = "grok-4.7";
export const RSI_CHAT_URL = "https://ojntnbaakfowmnrsetbb.supabase.co/functions/v1/rsi-chat";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function resolveModel(model: string | null | undefined): string {
  const trimmed = model?.trim() ?? "";
  if (!trimmed) return DEFAULT_GROK_MODEL;
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(trimmed)) {
    throw new Error("Model id must be a short token such as grok-4.7.");
  }
  return trimmed;
}

/** The desk file is the only export. A key or passcode must not appear in it. */
export function deskExportContainsSecret(state: DeskState, secret: string): boolean {
  if (!secret) return false;
  return serializeState(state).includes(secret);
}

/**
 * What the browser sends. The access token is the signed-in session.
 * The xAI key stays on the server. There is no passcode header.
 */
/**
 * The JSON body posted to xAI chat completions. No key lives in this object.
 * `stream: true` is the live server-sent-events shape. Omit it for a single JSON reply.
 */
export function chatCompletionRequest(input: {
  model: string;
  temperature: number;
  messages: ChatMessage[];
  stream?: boolean;
  responseFormat?: { type: "json_object" };
}): { model: string; temperature: number; messages: ChatMessage[]; stream?: true; response_format?: { type: "json_object" } } {
  return {
    model: input.model,
    temperature: input.temperature,
    messages: input.messages,
    ...(input.stream ? { stream: true as const } : {}),
    ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
  };
}

/** Pulls text deltas out of one SSE chunk. `[DONE]` and non-data lines contribute nothing. */
export function readSseDelta(chunk: string): string {
  let text = "";
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const piece = json.choices?.[0]?.delta?.content;
      if (typeof piece === "string") text += piece;
    } catch {
      text += "";
    }
  }
  return text;
}

export function grokRequest(input: {
  accessToken: string;
  messages: ChatMessage[];
  feedback?: { text: string; date: string; id: string };
  stream?: boolean;
}): { url: string; body: string; headers: Record<string, string> } {
  const token = input.accessToken.trim();
  if (!token) throw new Error("Sign in to use Grok. Nothing was written.");
  const anonKey = supabaseConfig()?.anonKey ?? "";
  return {
    url: RSI_CHAT_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      temperature: 0.2,
      messages: input.messages,
      ...(input.feedback ? { feedback: input.feedback } : {}),
      ...(input.stream ? { stream: true } : {}),
    }),
  };
}

export function grokFailureMessage(status: number, payload: unknown): string {
  if (status === 401) return "Sign in again. The session was refused. Nothing was written.";
  if (status === 403) return "This RSI desk is private.";
  if (status === 429) return "Grok is rate limited for this account. Wait and try again. Nothing was written.";
  const record = payload && typeof payload === "object" ? (payload as { error?: unknown }) : null;
  const nested = record?.error;
  const text = typeof nested === "string" ? nested : nested && typeof nested === "object" && typeof (nested as { message?: unknown }).message === "string" ? (nested as { message: string }).message : "";
  if (status === 400 && text) return text;
  if (status === 502 || status === 400) return "Grok did not answer. Try again. Nothing was written.";
  return `Grok returned ${status}. Nothing was written.`;
}

export async function completeGrok(input: {
  messages: ChatMessage[];
  responseFormat?: { type: "json_object" };
  feedback?: { text: string; date: string; id: string };
  stream?: boolean;
}): Promise<string> {
  if (import.meta.env.VITE_RSI_DEMO === "1") {
    return "Preview only. After you sign in, Grok answers from the RSI server. This browser does not hold an xAI key. Not financial advice.";
  }
  const supabase = getSupabase();
  if (!supabase) throw new Error("This desk is missing its Supabase anon key. Nothing was written.");
  const { data: first } = await supabase.auth.getSession();
  let session = first.session;
  if (!session) throw new Error("Sign in to use Grok. Nothing was written.");
  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt < Date.now() + 60_000) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      throw new Error("The sign-in session expired. Sign in again. Nothing was written.");
    }
    session = refreshed.data.session;
  }
  const request = grokRequest({
    accessToken: session.access_token,
    messages: input.messages,
    feedback: input.feedback,
    stream: input.stream,
  });
  const body = JSON.parse(request.body) as { temperature: number; messages: ChatMessage[]; stream?: boolean; feedback?: { text: string; date: string; id: string } };
  if (input.stream) {
    const response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body });
    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      throw new Error(grokFailureMessage(response.status, payload));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Grok returned an empty reply. No card and no trade was written.");
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      text += readSseDelta(decoder.decode(step.value, { stream: true }));
    }
    if (!text.trim()) throw new Error("Grok returned an empty reply. No card and no trade was written.");
    return text;
  }
  const { data, error } = await supabase.functions.invoke("rsi-chat", {
    body: input.responseFormat ? { ...body, response_format: input.responseFormat } : body,
  });
  if (error) {
    const status = typeof (error as { context?: Response }).context?.status === "number" ? (error as { context: Response }).context.status : 0;
    let payload: unknown = null;
    try {
      payload = await (error as { context?: Response }).context?.json();
    } catch {
      payload = null;
    }
    throw new Error(grokFailureMessage(status, payload));
  }
  const text = (data as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error("Grok returned an empty reply. No card and no trade was written.");
  return text;
}
