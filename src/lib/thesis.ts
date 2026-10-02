import type { LoopStage, Thesis } from "../types";

/** Fields added in schema v2. Legacy cards start at the thesis step until a gate moves them. */
export function emptyLoop(stage: LoopStage = "thesis"): Pick<
  Thesis,
  "stage" | "disbelief" | "evidence" | "bearClaims" | "beatsBear" | "revisitOn" | "addBelowPrice" | "trimAbovePrice"
> {
  return {
    stage,
    disbelief: null,
    evidence: "",
    bearClaims: [],
    beatsBear: null,
    revisitOn: null,
    addBelowPrice: null,
    trimAbovePrice: null,
  };
}

const STAGES: LoopStage[] = ["scout", "thesis", "redteam", "watchlist", "approved", "sized", "archived"];

export function isLoopStage(value: unknown): value is LoopStage {
  return typeof value === "string" && STAGES.includes(value as LoopStage);
}
