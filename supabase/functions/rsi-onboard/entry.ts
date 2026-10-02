import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { ONBOARD_PLAN, runOnboard, type StoredPlan } from "../../../src/lib/onboardPlan.ts";
import { yahooChartUrl } from "../../../src/lib/yahoo.ts";

const PRIVATE = "This RSI desk is private.";
const ORIGINS = new Set([
  "https://vellumpress.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

function cors(origin: string | null): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin && ORIGINS.has(origin) ? origin : "https://vellumpress.github.io");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Vary", "Origin");
  headers.set("Content-Type", "application/json");
  return headers;
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json(405, { error: "POST only." }, origin);

  const header = req.headers.get("Authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return json(401, { error: "Sign in again. Nothing was written." }, origin);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase() ?? "";
  if (error || !data.user?.id || !email) return json(401, { error: "Sign in again. Nothing was written." }, origin);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const listed = await admin.from("allowlist").select("email").eq("email", email).maybeSingle();
  if (listed.error || listed.data?.email !== email) return json(403, { error: PRIVATE }, origin);

  let body: { amount?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Send an amount. No orders were stored." }, origin);
  }
  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const today = new Date().toISOString().slice(0, 10);
  const userId = data.user.id;

  const result = await runOnboard({
    userId,
    amount,
    today,
    fetchChart,
    completeJson: askGrok,
    save: (plan) => storePlan(admin, plan),
  });
  if (!result.ok) return json(422, { error: result.error }, origin);
  return json(200, {
    ok: true,
    plan: ONBOARD_PLAN,
    capital: result.plan.amount,
    cash: result.plan.cash,
    orders: result.plan.orders.length,
  }, origin);
});

async function fetchChart(ticker: string): Promise<unknown> {
  const response = await fetch(yahooChartUrl(ticker), { headers: { "user-agent": "rsi-onboard/1.0" } });
  if (!response.ok) throw new Error(`${ticker} price could not be fetched. No orders were stored.`);
  return response.json();
}

async function askGrok(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("XAI_API_KEY") ?? "";
  if (!apiKey) throw new Error("Grok is not configured. No orders were stored.");
  const model = Deno.env.get("RSI_MODEL")?.trim() || "grok-4.7";
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Reply with JSON only. Do not include prices or share counts." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error("Grok did not return a plan. No orders were stored.");
  const body = await response.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null;
  const text = body?.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error("Grok did not return a plan. No orders were stored.");
  return text;
}

async function storePlan(admin: ReturnType<typeof createClient>, plan: StoredPlan): Promise<void> {
  const profile = await admin.from("profiles").upsert({
    user_id: plan.userId,
    capital: plan.amount,
    noted_on: plan.notedOn,
    updated_at: new Date().toISOString(),
  });
  if (profile.error) throw new Error("The amount could not be stored. No orders were stored.");
  const inserted = await admin.from("recommendations").insert(plan.orders).select("id");
  if (inserted.error || !inserted.data?.length) throw new Error("The plan could not be stored.");
  const keep = new Set(inserted.data.map((row) => String(row.id)));
  const filled = await admin.from("fills").select("recommendation_id").eq("user_id", plan.userId).not("recommendation_id", "is", null);
  if (filled.error) throw new Error("The plan could not be stored.");
  for (const row of filled.data ?? []) {
    if (row.recommendation_id) keep.add(String(row.recommendation_id));
  }
  const existing = await admin.from("recommendations").select("id").eq("user_id", plan.userId);
  if (existing.error) throw new Error("The plan could not be stored.");
  const drop = (existing.data ?? []).map((row) => String(row.id)).filter((id) => !keep.has(id));
  if (drop.length === 0) return;
  const removed = await admin.from("recommendations").delete().in("id", drop).eq("user_id", plan.userId);
  if (removed.error) throw new Error("The plan could not be stored.");
}
