import type { Thesis } from "../types";
import { addMonths } from "./dates";
import { uid } from "./id";
import { emptyLoop } from "./thesis";

/** A blank illustration. It is not a stock pick and it is not approved, so it cannot become a buy. */
export function exampleThesis(today: string): Thesis {
  return {
    id: uid(),
    theme: "Illustration — replace this",
    ticker: "",
    openedOn: today,
    version: 1,
    marketBelief: "Software is a broken sector. The market has already taken the drawdown as proof that the business is impaired.",
    ourBelief: "This is a disbelief phase in a business that still has to print reported numbers. The desk owns it only inside a valuation band.",
    whyWrong: "The selling is broad. The edge in this card is patience and a pre-written kill, not a private fact.",
    killCondition: "Replace this with the one reported fact that would prove the thesis wrong.",
    killHit: false,
    milestones: [3, 6, 12].map((months, index) => ({
      id: uid(),
      metric: `Reported metric ${index + 1}`,
      target: "Write the number you will accept",
      byDate: addMonths(today, months),
      status: "pending" as const,
      resolvedOn: null,
    })),
    valuationMetric: "Valuation versus its own 10-year history",
    addBelow: "Bottom quartile",
    trimAbove: "Top decile",
    valuationPercentile: null,
    bearCase: "The multiple never re-rates, and the next two reported milestones miss. That is a kill, not a dip to buy.",
    targetMode: "plan",
    targetDollars: null,
    probability: null,
    benchmark: "QQQ",
    archived: false,
    log: [],
    ...emptyLoop("thesis"),
    disbelief: "negative-sentiment",
    evidence: "Replace this with evidence. This card is not a recommendation and it is not approved, so the brief will not buy it.",
  };
}
