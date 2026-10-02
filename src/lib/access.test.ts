import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailAllowed, GROK_DAY_LIMIT, GROK_MINUTE_LIMIT, PRIVATE_DESK, rateLimitDecision } from "./access";

const migration = readFileSync("supabase/migrations/20261002203818_rsi_schema.sql", "utf8");

describe("allowlist", () => {
  it("seeds the owner and refuses every other address", () => {
    expect(emailAllowed("miketankh@gmail.com", ["miketankh@gmail.com"])).toBe(true);
    expect(emailAllowed("  MikeTankh@gmail.com ", ["miketankh@gmail.com"])).toBe(true);
    expect(emailAllowed("someone@example.com", ["miketankh@gmail.com"])).toBe(false);
    expect(emailAllowed("", ["miketankh@gmail.com"])).toBe(false);
    expect(emailAllowed("not-an-email", ["miketankh@gmail.com"])).toBe(false);
  });

  it("stops a call once the minute or day window is full", () => {
    expect(rateLimitDecision(0, 0).ok).toBe(true);
    expect(rateLimitDecision(GROK_MINUTE_LIMIT - 1, GROK_DAY_LIMIT - 1).ok).toBe(true);
    expect(rateLimitDecision(GROK_MINUTE_LIMIT, 0).ok).toBe(false);
    expect(rateLimitDecision(0, GROK_DAY_LIMIT).ok).toBe(false);
  });

  it("locks the table, the signup hook, and row security to the owner email", () => {
    expect(migration).toContain("miketankh@gmail.com");
    expect(migration).toContain(PRIVATE_DESK);
    expect(migration).toContain("create table if not exists public.allowlist");
    expect(migration).toContain("alter table public.allowlist enable row level security");
    expect(migration).toContain("alter table public.grok_calls enable row level security");
    expect(migration).toContain("hook_before_user_created");
    expect(migration).toContain("auth.jwt() ->> 'email'");
    expect(migration).toContain("auth.uid()");
    expect(migration).not.toMatch(/user_metadata/);
    expect(migration).toContain("revoke all on table public.allowlist from public, anon");
    expect(migration).toContain("revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated");
  });
});
