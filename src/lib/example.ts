import type { Thesis } from "../types";
import { addMonths } from "./dates";
import { uid } from "./id";
import { emptyLoop } from "./thesis";

/** An editable illustration. Valuation is left blank on purpose. */
export function exampleThesis(today: string): Thesis {
  return {
    id: uid(),
    theme: "Software disbelief",
    ticker: "IGV",
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
    ...emptyLoop("approved"),
    disbelief: "negative-sentiment",
    evidence: "The sector sold off while reported cash flows were still being printed. This illustration is pre-marked approved so Week 0 can be inspected. A real theme goes through the loop gates first.",
  };
}
