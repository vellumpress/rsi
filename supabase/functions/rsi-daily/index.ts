import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const PRIVATE = "This RSI desk is private.";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only." });
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!bearer || !serviceKey || bearer !== serviceKey) return json(401, { error: "The engine only accepts the service role." });

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const listed = await admin.from("allowlist").select("email");
  if (listed.error || !listed.data) return json(502, { error: "The allowlist could not be read. No engine ran." });
  const allowed = new Set(listed.data.map((row) => String(row.email).toLowerCase()));

  const users = await admin.auth.admin.listUsers({ perPage: 200 });
  if (users.error) return json(502, { error: "Accounts could not be listed. No engine ran." });
  const run = users.data.users.filter((user) => allowed.has((user.email ?? "").trim().toLowerCase()));
  const skipped = users.data.users.length - run.length;

  // Anyone not on the allowlist is skipped. This job does not contact xAI and does not place a trade.
  return json(200, {
    ok: true,
    allowlisted: run.map((user) => user.id),
    skipped,
    message: skipped > 0 ? PRIVATE : "Allowlisted accounts only. No trade was placed.",
  });
});
