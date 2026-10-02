import { describe, expect, it } from "vitest";
import { applyMetaRuleCycle, defaultRulebook, metaRuleVerdict, proposeRuleChange, ruleEditsLocked } from "./rulebook";

const openBook = { bookValue: 100_000, peak: 100_000 };

describe("rulebook", () => {
  it("blocks a second rule change in the same quarter", () => {
    const first = proposeRuleChange(defaultRulebook("2026-10-02"), {
      id: "c1",
      date: "2027-01-02",
      quarterKey: "2027-01-02",
      parameter: "trimFraction",
      next: 0.25,
      evidence: "Four trims were smaller than the drawups that followed them.",
      ...openBook,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.rulebook.version).toBe("1.1");
    expect(first.rulebook.thresholds.trimFraction).toBe(0.25);
    const second = proposeRuleChange(first.rulebook, {
      id: "c2",
      date: "2027-01-03",
      quarterKey: "2027-01-02",
      parameter: "greedAboveSma",
      next: 0.6,
      evidence: "A second change in the same quarter should be refused.",
      ...openBook,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/at most one/i);
  });

  it("locks every threshold edit while the book is below its peak, including an incomplete mark", () => {
    expect(ruleEditsLocked(99_000, 100_000).locked).toBe(true);
    expect(ruleEditsLocked(100_000, 100_000).locked).toBe(false);
    expect(ruleEditsLocked(null, 100_000).locked).toBe(true);
    const refused = proposeRuleChange(defaultRulebook("2026-10-02"), {
      id: "c1",
      date: "2026-11-02",
      quarterKey: "2027-01-02",
      parameter: "trimFraction",
      next: 0.25,
      evidence: "Trying to edit during a drawdown, which the rule forbids.",
      bookValue: 90_000,
      peak: 100_000,
    });
    expect(refused.ok).toBe(false);
  });

  it("does not let the 15% cap or the circuit breaker bend", () => {
    const cap = proposeRuleChange(defaultRulebook("2026-10-02"), {
      id: "c1",
      date: "2026-11-02",
      quarterKey: "2027-01-02",
      parameter: "positionCap",
      next: 0.2,
      evidence: "This would raise the cap and it must be refused.",
      ...openBook,
    });
    expect(cap.ok).toBe(false);
  });

  it("versions a new cycle when rule 04 shrinks the sleeve, even in a drawdown", () => {
    const next = applyMetaRuleCycle(defaultRulebook("2026-10-02"), {
      id: "cycle",
      date: "2027-10-02",
      quarterKey: "2027-10-02",
      evidence: "Conviction trailed QQQ over four quarters.",
    });
    expect(next.version).toBe("2.0");
    expect(next.cycle).toBe(2);
    expect(next.thresholds.trimFraction).toBe(0.2);
  });

  it("shrinks the sleeve only after four quarters and only when it trails QQQ", () => {
    expect(metaRuleVerdict(0.1, 0.2, 3).due).toBe(false);
    expect(metaRuleVerdict(-0.05, 0.04, 4).shrink).toBe(true);
    expect(metaRuleVerdict(0.2, 0.1, 4).shrink).toBe(false);
    expect(metaRuleVerdict(null, 0.1, 4).shrink).toBe(false);
    expect(metaRuleVerdict(null, 0.1, 4).reason).toMatch(/Insufficient data, no action/);
  });
});
