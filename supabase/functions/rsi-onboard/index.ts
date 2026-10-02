import { createClient } from "npm:@supabase/supabase-js@2.49.8";

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

  // Allowlisted accounts only. This call does not contact xAI and does not open a position.
  return json(200, {
    ok: true,
    email,
    message: "You are on the list. Onboarding will not call Grok or record a trade from this request.",
  }, origin);
});
