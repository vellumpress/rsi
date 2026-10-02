/** A quarterly label is only skill or luck, and it needs the evidence sentence. */
export function validatePostmortem(raw: unknown): { ok: true; skillOrLuck: "skill" | "luck"; evidence: string } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "The post-mortem was empty." };
  const label = (raw as { skillOrLuck?: unknown }).skillOrLuck;
  const evidence = (raw as { evidence?: unknown }).evidence;
  if (label !== "skill" && label !== "luck") {
    return { ok: false, reason: "A post-mortem is skill or luck. Mixed, or anything else, is not a label." };
  }
  if (typeof evidence !== "string" || evidence.trim().length < 20) {
    return { ok: false, reason: "A post-mortem needs a sentence of evidence." };
  }
  return { ok: true, skillOrLuck: label, evidence: evidence.trim() };
}
