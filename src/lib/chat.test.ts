import { describe, expect, it } from "vitest";
import { answerLocally, commitScreened, extractProposal, screenProposal, type ChatFacts } from "./chat";

const facts: ChatFacts = {
  today: "2026-10-02",
  fridaySweep: true,
  bookValue: 100000,
  peak: 100000,
  drawdown: 0,
  cash: 25000,
  spyReturn: 0.01,
  qqqReturn: 0.02,
  bookReturn: 0,
  ruleEditsLocked: false,
  actions: [{ ticker: "JNJ", side: "buy", rule: "WEEK0", title: "Core tranche", dollars: 1000, reason: "Calendar entry." }],
  prices: [
    { ticker: "JNJ", price: 255.5, instrument: "equity" },
    { ticker: "SPY", price: 769, instrument: "etf" },
    { ticker: "QQQ", price: 748, instrument: "etf" },
  ],
  theses: [],
  positionCap: 15000,
};

describe("chat guardrails", () => {
  it("answers what to do today from local state when no key is required", () => {
    const text = answerLocally("what should I do today?", facts);
    expect(text).toMatch(/JNJ/);
    expect(text).toMatch(/WEEK0/);
    expect(text).toMatch(/Not financial advice/);
  });

  it("does not emit a ledger write unless the user confirms", () => {
    const raw = extractProposal('Note.\n```proposal\n{"kind":"trade","side":"buy","ticker":"JNJ","dollars":1000,"price":255.5,"sleeve":"conviction","note":"draft"}\n```');
    const screen = screenProposal(raw, facts);
    expect(screen.ok).toBe(true);
    expect(commitScreened(screen, false)).toBeNull();
    expect(commitScreened(screen, true)?.kind).toBe("trade");
  });

  it("rejects an ETF or benchmark even if the user would confirm", () => {
    const spy = screenProposal({ kind: "trade", side: "buy", ticker: "SPY", dollars: 1000, price: 769, sleeve: "core", note: "index" }, facts);
    expect(spy.ok).toBe(false);
    expect(spy.reason).toMatch(/ETF|benchmark|individual/i);
    expect(commitScreened(spy, true)).toBeNull();
    const labeledEquity = screenProposal(
      { kind: "trade", side: "buy", ticker: "QQQ", dollars: 1000, price: 748, sleeve: "conviction", note: "fund" },
      { ...facts, prices: facts.prices.map((quote) => (quote.ticker === "QQQ" ? { ...quote, instrument: "equity" as const } : quote)) },
    );
    expect(labeledEquity.ok).toBe(false);
    expect(commitScreened(labeledEquity, true)).toBeNull();
  });

  it("refuses a rule change and a price the snapshot does not have", () => {
    expect(screenProposal({ kind: "rule", parameter: "trimFraction", next: 0.25 }, facts).ok).toBe(false);
    const invented = screenProposal({ kind: "trade", side: "buy", ticker: "JNJ", dollars: 1000, price: 1, sleeve: "conviction", note: "cheap" }, facts);
    expect(invented.ok).toBe(false);
    expect(invented.reason).toMatch(/snapshot/);
    expect(commitScreened(invented, true)).toBeNull();
  });

  it("treats generate-thesis as a prompt, not a write", () => {
    const screen = screenProposal({ kind: "generate-thesis" }, facts);
    expect(screen.ok).toBe(true);
    expect(commitScreened(screen, true)).toBeNull();
  });
});
