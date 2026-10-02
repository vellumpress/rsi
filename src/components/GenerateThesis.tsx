import { useState } from "react";
import { cardPrompt, gateGeneratedCard, redTeamPrompt, scoutPrompt, validateCard, validateRedTeam, validateScout, watchlistDocument, watchlistInstructions, extractJson, type CardDraft, type QuoteHint, type RedTeamDraft, type ScoutCandidate } from "../lib/generate";
import { classifyInstrument } from "../lib/instruments";
import { completeGrok, hasGrokCredential, loadLlmSettings } from "../lib/llm";
import { assessQuote } from "../lib/quotes";
import { uid } from "../lib/id";
import { useDesk } from "../state";

type Step = "idle" | "scouting" | "pick" | "drafting" | "redteam" | "review" | "saved";

export function GenerateThesis() {
  const desk = useDesk();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ScoutCandidate[]>([]);
  const [card, setCard] = useState<CardDraft | null>(null);
  const [redTeam, setRedTeam] = useState<RedTeamDraft | null>(null);
  const [beats, setBeats] = useState<"" | "yes" | "no">("");
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const known = quoteHints(desk);

  const fail = (message: string) => {
    setError(message);
    setStep("idle");
  };

  const scout = async () => {
    setError(null);
    setSavedNote(null);
    const settings = loadLlmSettings(typeof localStorage === "undefined" ? null : localStorage);
    if (!hasGrokCredential(settings)) {
      setError(settings.mode === "server" ? "Add the RSI server passcode in Settings. Scout does not run without it, and it never trades." : "Add an xAI API key in Settings. Scout does not run without it, and it never trades.");
      return;
    }
    setStep("scouting");
    try {
      const text = await completeGrok({
        settings,
        messages: [
          { role: "system", content: "You output JSON only. You do not approve trades." },
          { role: "user", content: scoutPrompt(known) },
        ],
      });
      const parsed = validateScout(extractJson(text), known);
      if (!parsed.ok) {
        fail(parsed.error);
        return;
      }
      setCandidates(parsed.candidates);
      setStep("pick");
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : "Scout failed. Nothing was saved.");
    }
  };

  const draft = async (candidate: ScoutCandidate) => {
    setError(null);
    const settings = loadLlmSettings(typeof localStorage === "undefined" ? null : localStorage);
    if (!hasGrokCredential(settings)) {
      setError(settings.mode === "server" ? "Add the RSI server passcode in Settings. Nothing was saved." : "Add an xAI API key in Settings. Nothing was saved.");
      setStep("pick");
      return;
    }
    setStep("drafting");
    try {
      const text = await completeGrok({
        settings,
        messages: [
          { role: "system", content: "You output JSON only. The card is a draft. You do not approve it." },
          { role: "user", content: cardPrompt(candidate, desk.derived.alloc.positionCap, known.find((quote) => quote.ticker === candidate.ticker) ?? null) },
        ],
      });
      const parsed = validateCard(extractJson(text), desk.derived.alloc.positionCap, known);
      if (!parsed.ok) {
        fail(parsed.error);
        return;
      }
      setCard(parsed.card);
      setStep("redteam");
      const bearText = await completeGrok({
        settings,
        messages: [
          { role: "system", content: "You are the red team. Output JSON only. Do not approve the thesis." },
          { role: "user", content: redTeamPrompt(parsed.card) },
        ],
      });
      const bear = validateRedTeam(extractJson(bearText));
      if (!bear.ok) {
        fail(bear.error);
        return;
      }
      setRedTeam(bear.redTeam);
      setBeats("");
      setStep("review");
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : "The draft failed. Nothing was saved.");
    }
  };

  const save = () => {
    if (!card || !redTeam) return;
    if (beats !== "yes" && beats !== "no") {
      setError("Answer whether the thesis beats the bear. There is no default yes.");
      return;
    }
    const quote = desk.prices?.quotes[card.ticker];
    const check = assessQuote(quote ? { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars } : undefined, desk.today);
    const price = check.block === "ok" || check.block === "short" ? quote?.price ?? null : null;
    const gated = gateGeneratedCard({
      card,
      redTeam,
      beatsBear: beats === "yes",
      price,
      quoteOk: price != null,
      today: desk.today,
      id: uid(),
      milestoneIds: [uid(), uid(), uid()],
      claimIds: redTeam.claims.map(() => uid()),
    });
    if (gated.approved !== false || gated.trade !== null || gated.thesis.stage === "approved" || gated.thesis.stage === "sized") {
      setError("The draft refused to save because it tried to approve or trade. Nothing was written.");
      return;
    }
    desk.saveThesis(gated.thesis);
    const listed = desk.prices?.quotes[card.ticker]?.instrumentType === "EQUITY";
    setSavedNote(`${gated.reason} ${listed ? "" : watchlistInstructions(card.ticker)}`.trim());
    setStep("saved");
  };

  const downloadWatchlist = () => {
    const tickers = [...desk.state.settings.coreTickers, ...desk.state.theses.map((thesis) => thesis.ticker), card?.ticker ?? ""];
    const blob = new Blob([watchlistDocument(tickers)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "watchlist.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel" aria-labelledby="generate-title">
      <div className="panel-mark" aria-hidden="true"><span className="shape square" /></div>
      <p className="kicker">Loop · steps 1–3</p>
      <h3 id="generate-title">Generate a thesis</h3>
      <p className="lede">Grok drafts a card from the playbook. You review it. Nothing is approved and nothing is traded from this button.</p>
      {step === "idle" || step === "saved" ? (
        <button type="button" className="primary" onClick={() => void scout()}>
          Generate thesis
        </button>
      ) : null}
      {step === "scouting" || step === "drafting" || step === "redteam" ? <p className="funding">{step === "scouting" ? "Scouting individual equities." : step === "drafting" ? "Drafting the card." : "Writing the bear case."} This does not write the ledger.</p> : null}
      {step === "pick" ? (
        <ul className="candidates">
          {candidates.map((candidate) => (
            <li key={candidate.ticker}>
              <strong>{candidate.ticker}</strong> · {candidate.disbelief}
              <p>{candidate.trend}</p>
              <p className="funding">{candidate.evidence}</p>
              <button type="button" onClick={() => void draft(candidate)}>Draft this card</button>
            </li>
          ))}
        </ul>
      ) : null}
      {step === "review" && card && redTeam ? (
        <div className="draft">
          <p className="pill">{card.ticker} · draft</p>
          <p>{card.theme}</p>
          <p><span className="kicker">Market</span> {card.marketBelief}</p>
          <p><span className="kicker">Ours</span> {card.ourBelief}</p>
          <p><span className="kicker">Why wrong</span> {card.whyWrong}</p>
          <p><span className="kicker">Kill</span> {card.killCondition}</p>
          <ul>
            {card.milestones.map((milestone) => (
              <li key={milestone.byDate}>{milestone.metric}: {milestone.target} by {milestone.byDate}. <span className="verify">model-generated, verify</span></li>
            ))}
          </ul>
          <p>Band {card.addBelow} / {card.trimAbove}. Target {card.targetDollars}. Tranche 1 suggestion {card.tranche1Dollars}. P {card.probability}. <span className="verify">model-generated, verify</span></p>
          <p>{redTeam.bearCase}</p>
          <ul>
            {redTeam.claims.map((claim) => (
              <li key={claim.claim}>{claim.claim} · P {claim.probability}</li>
            ))}
          </ul>
          {card.figures.map((figure) => (
            <p key={figure.label} className="verify">{figure.label}: {figure.value}{figure.source ? ` · ${figure.source}` : ""} · model-generated, verify</p>
          ))}
          <label>
            Does the thesis beat the bear case?
            <select value={beats} onChange={(event) => setBeats(event.target.value as "" | "yes" | "no")}>
              <option value="">Not answered</option>
              <option value="yes">Yes — still a draft</option>
              <option value="no">No — archive until next quarter</option>
            </select>
          </label>
          <div className="row-actions">
            <button type="button" className="primary" onClick={save}>Save draft</button>
            <button type="button" onClick={downloadWatchlist}>Download watchlist.json</button>
          </div>
        </div>
      ) : null}
      {savedNote ? <p className="funding">{savedNote}</p> : null}
      {error ? <p className="warn">{error}</p> : null}
    </section>
  );
}

function quoteHints(desk: ReturnType<typeof useDesk>): QuoteHint[] {
  const tickers = new Set<string>(["SPY", "QQQ", ...desk.state.settings.coreTickers, ...desk.state.theses.map((thesis) => thesis.ticker)]);
  return [...tickers].filter(Boolean).map((ticker) => {
    const quote = desk.prices?.quotes[ticker.toUpperCase()];
    return {
      ticker: ticker.toUpperCase(),
      price: quote?.price ?? null,
      instrument: classifyInstrument({ ticker, instrumentType: quote?.instrumentType, quoteType: quote?.quoteType }),
    };
  });
}
