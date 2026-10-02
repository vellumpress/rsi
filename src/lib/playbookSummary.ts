/**
 * Structured summary of the Alpha Desk playbook for prompts.
 * This is not the PDF and it is not a copy of the PDF.
 */

export function playbookSummary(): string {
  return [
    "RSI follows the Alpha Desk playbook with one override: individual stocks and cash only. No index fund, no ETF, no T-bill.",
    "Allocation: core 30% (user-chosen equal-weight stocks, about 8–10 names, three monthly tranches, yearly rebalance), conviction 45% (3–5 themes), dry powder 25% uninvested cash. Unspent tranches are cash. Exit and trim proceeds go to cash.",
    "Four rules: (1) never average down after a missed milestone. (2) sentiment is not an exit; a full exit is a kill, including a second missed milestone, or the meta-rule. (3) change at most one rule a quarter, and never during a drawdown of 10% or more from the peak. (4) after four quarters, a conviction sleeve that trails QQQ moves into the core stock basket, not an index.",
    "Position cap: no buy above 15% of the book. Trim line: 20% of the book. Circuit breaker: book down 30% from peak freezes adds; exits and trims still run.",
    "Page-3 engine order: circuit breaker, then R1 kill (100% exit), R2 greed or weight above 20% (trim, never a full exit), R3 one missed milestone freezes adds, R4 extreme fear only if all three signals are true and milestones are intact, R5 confirmation only on a reported number, otherwise hold.",
    "Page-2 loop steps 1–3, then the page-5 card: (1) Scout a real trend the market disbelieves: improving fundamentals with negative sentiment, or a low valuation versus the company's own history. One company, not a fund. (2) Thesis card: market belief, our belief, why the market is wrong as evidence, kill condition, three dated milestones that can be checked on reported numbers, valuation band versus roughly 10 years of its own history (metric, add-below, trim-above), target dollars at most 15% of the book, tranche 1 is one third of that target, P(thesis) over 3 years. (3) Red team: the strongest bear case, each claim with a probability. If the thesis does not beat the bear, archive it until next quarter. If the snapshot price is outside the add band, watchlist it. A card is a draft until the user approves it. Nothing is auto-approved and nothing is auto-traded.",
    "SPY and QQQ are benchmarks only. They are never a buy or a sell. Signals use the position itself.",
    "Do not invent prices, returns, or fundamentals. If a number is not in the supplied snapshot, say it is missing. Any figure you assert is model-generated and must be verified.",
    "Not financial advice. You propose. The user confirms. You cannot write the ledger, change a rule, or approve a card.",
  ].join("\n");
}
