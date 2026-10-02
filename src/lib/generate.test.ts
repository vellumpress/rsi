import { describe, expect, it } from "vitest";
import { cardPrompt, extractJson, gateGeneratedCard, scoutPrompt, validateCard, validateRedTeam, validateScout, watchlistInstructions, type CardDraft, type RedTeamDraft } from "./generate";

const known = [
  { ticker: "JNJ", price: 255.5, instrument: "equity" as const },
  { ticker: "SPY", price: 769, instrument: "etf" as const },
];

const cardJson = {
  ticker: "JNJ",
  theme: "A staple the market treats as ex-growth",
  disbelief: "low-valuation",
  evidence: "Reported margins are intact while the multiple is low versus its own history.",
  marketBelief: "The business is ex-growth.",
  ourBelief: "Reported cash flows are intact.",
  whyWrong: "The multiple is low versus its own ten-year history. That is the evidence.",
  killCondition: "Two reported milestones miss.",
  milestones: [
    { metric: "Reported sales", target: "above the prior year", byDate: "2027-02-01" },
    { metric: "Reported margin", target: "within 1 point of last year", byDate: "2027-05-01" },
    { metric: "Reported free cash flow", target: "positive", byDate: "2027-08-01" },
  ],
  valuationMetric: "Multiple versus its own 10-year history",
  addBelow: 240,
  trimAbove: 320,
  valuationPercentile: 20,
  targetDollars: 50_000,
  probability: 55,
  figures: [{ label: "multiple vs history", value: "bottom quartile", source: "model estimate" }],
};

describe("generated thesis cards", () => {
  it("rejects an ETF scout and validates an equity card against the schema", () => {
    expect(scoutPrompt(known)).toMatch(/individual equit/i);
    expect(cardPrompt({ ticker: "JNJ", disbelief: "low-valuation", trend: "low multiple", evidence: "history" }, 15_000, known[0])).toMatch(/15%|15000/);
    const etf = validateScout({ candidates: [{ ticker: "SPY", disbelief: "low-valuation", trend: "index", evidence: "broad" }] }, known);
    expect(etf.ok).toBe(false);
    const fund = validateCard({ ...cardJson, ticker: "QQQ" }, 15_000, [{ ticker: "QQQ", price: 700, instrument: "etf" }]);
    expect(fund.ok).toBe(false);
    const card = validateCard(extractJson(JSON.stringify(cardJson)), 15_000, known);
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    expect(card.card.targetDollars).toBe(15_000);
    expect(card.card.tranche1Dollars).toBe(5000);
    expect(card.card.milestones).toHaveLength(3);
    expect(card.card.figures.every((figure) => figure.note === "model-generated, verify")).toBe(true);
  });

  it("runs the bear and band gates and never auto-approves or trades", () => {
    const card = validateCard(cardJson, 15_000, known);
    const red = validateRedTeam({ bearCase: "The multiple never re-rates and the next reports miss.", claims: [{ claim: "Growth never returns", probability: 40 }] });
    expect(card.ok && red.ok).toBe(true);
    if (!card.ok || !red.ok) return;
    const inside = gateGeneratedCard(base(card.card, red.redTeam, true, 200));
    expect(inside.approved).toBe(false);
    expect(inside.trade).toBeNull();
    expect(inside.thesis.stage).not.toBe("approved");
    expect(inside.thesis.stage).not.toBe("sized");
    expect(inside.thesis.stage).toBe("watchlist");
    expect(inside.reason).toMatch(/did not approve|Nothing was bought|draft/);
    const outside = gateGeneratedCard(base(card.card, red.redTeam, true, 400));
    expect(outside.thesis.stage).toBe("watchlist");
    expect(outside.trade).toBeNull();
    const lost = gateGeneratedCard(base(card.card, red.redTeam, false, 200));
    expect(lost.thesis.stage).toBe("archived");
    expect(lost.thesis.archived).toBe(true);
    expect(lost.approved).toBe(false);
    expect(lost.trade).toBeNull();
    const unanswered = gateGeneratedCard(base(card.card, red.redTeam, null, 200));
    expect(unanswered.thesis.stage).toBe("redteam");
    expect(unanswered.thesis.beatsBear).toBeNull();
    expect(watchlistInstructions("JNJ")).toMatch(/cannot commit/);
    expect(watchlistInstructions("JNJ")).toMatch(/github.com\/vellumpress\/rsi/);
  });
});

function base(card: CardDraft, redTeam: RedTeamDraft, beatsBear: boolean | null, price: number) {
  return {
    card,
    redTeam,
    beatsBear,
    price,
    quoteOk: true,
    today: "2026-10-02",
    id: "thesis-1",
    milestoneIds: ["m1", "m2", "m3"] as [string, string, string],
    claimIds: ["c1"],
  };
}
