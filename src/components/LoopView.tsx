import { useState } from "react";
import { themeTarget } from "../lib/allocation";
import { prettyDate } from "../lib/dates";
import { uid } from "../lib/id";
import { buyBlockedReason, classifyInstrument } from "../lib/instruments";
import { bandGate, bearGate, scoutGate, sizeTranche1, type Disbelief } from "../lib/loop";
import { moneyAuto } from "../lib/money";
import { assessQuote } from "../lib/quotes";
import { emptyLoop } from "../lib/thesis";
import { useDesk } from "../state";
import type { Thesis } from "../types";

/** Playbook p.2. Scout, thesis, red team, band, then the entry third. Later thirds stay with the engine. */
export function LoopView() {
  const desk = useDesk();
  const open = desk.state.theses.filter((thesis) => !thesis.archived);
  const [activeId, setActiveId] = useState<string | null>(open[0]?.id ?? null);
  const active = open.find((thesis) => thesis.id === activeId) ?? null;

  return (
    <section className="sheet">
      <header className="sheet-head">
        <p className="kicker">Recursive loop · steps 1–4</p>
        <h2>From disbelief to a sized entry</h2>
        <p className="lede">
          The strategy follows the Alpha Desk playbook. A theme is not bought until the scout, the thesis card, the bear case, and the valuation band have all passed. Tranches 2 and 3 are never bought from this page.
        </p>
      </header>
      <div className="row-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            const thesis = blankScout(desk.today);
            desk.saveThesis(thesis);
            setActiveId(thesis.id);
          }}
        >
          Start a scout
        </button>
        {open.map((thesis) => (
          <button key={thesis.id} type="button" aria-current={thesis.id === activeId ? "true" : undefined} onClick={() => setActiveId(thesis.id)}>
            {thesis.ticker || "Untitled"} · {thesis.stage}
          </button>
        ))}
      </div>
      {active ? <LoopCard thesis={active} /> : <p className="empty">No theme is in the loop. Start a scout, or open an illustration from Theses.</p>}
      <Revisits />
    </section>
  );
}

function LoopCard({ thesis }: { thesis: Thesis }) {
  const desk = useDesk();
  if (thesis.stage === "scout" || thesis.stage === "thesis") return <ScoutAndThesis thesis={thesis} />;
  if (thesis.stage === "redteam") return <RedTeam thesis={thesis} />;
  if (thesis.stage === "watchlist" || thesis.stage === "approved") return <BandAndSize thesis={thesis} />;
  if (thesis.stage === "sized") {
    return <p className="funding">{thesis.ticker} is sized. Later adds come from the Friday engine, not from a second entry here.</p>;
  }
  return (
    <p className="funding">
      {thesis.ticker} is {thesis.stage}. {thesis.revisitOn ? `Revisit ${prettyDate(thesis.revisitOn)}.` : ""}
      <button type="button" onClick={() => desk.setTab("theses")}>Open the card</button>
    </p>
  );
}

function ScoutAndThesis({ thesis }: { thesis: Thesis }) {
  const desk = useDesk();
  const [trend, setTrend] = useState(thesis.theme);
  const [ticker, setTicker] = useState(thesis.ticker);
  const [disbelief, setDisbelief] = useState<Disbelief | "">(thesis.disbelief ?? "");
  const [evidence, setEvidence] = useState(thesis.evidence);
  const [marketBelief, setMarketBelief] = useState(thesis.marketBelief);
  const [ourBelief, setOurBelief] = useState(thesis.ourBelief);
  const [whyWrong, setWhyWrong] = useState(thesis.whyWrong);
  const [killCondition, setKillCondition] = useState(thesis.killCondition);
  const [bearCase, setBearCase] = useState(thesis.bearCase);
  const [error, setError] = useState<string | null>(null);

  const save = (stage: Thesis["stage"]) => {
    const scout = scoutGate({
      trend,
      ticker,
      disbelief: disbelief === "negative-sentiment" || disbelief === "low-valuation" ? disbelief : null,
      evidence,
    });
    if (!scout.ok) {
      setError(scout.reason);
      return;
    }
    if (stage === "redteam" && (!marketBelief.trim() || !ourBelief.trim() || !whyWrong.trim() || !killCondition.trim() || !bearCase.trim())) {
      setError("The thesis card needs the market belief, your belief, why the market is wrong, a kill condition, and a bear case.");
      return;
    }
    desk.saveThesis({
      ...thesis,
      theme: trend.trim(),
      ticker: ticker.trim().toUpperCase(),
      disbelief: disbelief === "" ? null : disbelief,
      evidence: evidence.trim(),
      marketBelief: marketBelief.trim(),
      ourBelief: ourBelief.trim(),
      whyWrong: whyWrong.trim(),
      killCondition: killCondition.trim(),
      bearCase: bearCase.trim(),
      stage,
    });
    setError(stage === "redteam" ? null : scout.reason);
  };

  return (
    <form
      className="setup"
      onSubmit={(event) => {
        event.preventDefault();
        save("redteam");
      }}
    >
      <p className="kicker">p.2 step 1 · scout, then the page 5 card</p>
      <label>
        Trend the market disbelieves
        <input value={trend} onChange={(event) => setTrend(event.target.value)} />
      </label>
      <label>
        Ticker of one company
        <input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} />
      </label>
      <label>
        Disbelief
        <select value={disbelief} onChange={(event) => setDisbelief(event.target.value as Disbelief | "")}>
          <option value="">Select</option>
          <option value="negative-sentiment">Improving fundamentals, negative sentiment</option>
          <option value="low-valuation">Low valuation versus its own history</option>
        </select>
      </label>
      <label>
        Evidence
        <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} />
      </label>
      <label>
        What the market believes
        <textarea value={marketBelief} onChange={(event) => setMarketBelief(event.target.value)} />
      </label>
      <label>
        What we believe
        <textarea value={ourBelief} onChange={(event) => setOurBelief(event.target.value)} />
      </label>
      <label>
        Why the market is wrong
        <textarea value={whyWrong} onChange={(event) => setWhyWrong(event.target.value)} />
      </label>
      <label>
        Kill condition
        <textarea value={killCondition} onChange={(event) => setKillCondition(event.target.value)} />
      </label>
      <label>
        Bear case
        <textarea value={bearCase} onChange={(event) => setBearCase(event.target.value)} />
      </label>
      {error ? <p className="warn">{error}</p> : null}
      <button type="submit" className="primary">Save the card and open the red team</button>
    </form>
  );
}

function RedTeam({ thesis }: { thesis: Thesis }) {
  const desk = useDesk();
  const [claims, setClaims] = useState(thesis.bearClaims.length ? thesis.bearClaims : [{ id: uid(), claim: thesis.bearCase, probability: 40 }]);
  const [probability, setProbability] = useState(thesis.probability == null ? "" : String(thesis.probability));
  const [beats, setBeats] = useState<"" | "yes" | "no">(thesis.beatsBear == null ? "" : thesis.beatsBear ? "yes" : "no");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const p = probability === "" ? null : Number(probability);
    const gate = bearGate(
      {
        beatsBear: beats === "" ? null : beats === "yes",
        claims,
        thesisProbability: p,
      },
      desk.today,
    );
    if (gate.decision === "incomplete") {
      setError(gate.reason);
      return;
    }
    if (gate.decision === "archive") {
      desk.saveThesis({ ...thesis, bearClaims: claims, probability: p, beatsBear: false, archived: true, stage: "archived", revisitOn: gate.revisitOn });
      setError(gate.reason);
      return;
    }
    desk.saveThesis({ ...thesis, bearClaims: claims, probability: p, beatsBear: true, stage: "watchlist" });
    setError(null);
  };

  return (
    <form
      className="setup"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="kicker">p.2 step 3 · does the thesis beat the bear case?</p>
      {claims.map((claim, index) => (
        <div key={claim.id} className="pair">
          <label>
            Bear claim {index + 1}
            <input
              value={claim.claim}
              onChange={(event) => setClaims(claims.map((item) => (item.id === claim.id ? { ...item, claim: event.target.value } : item)))}
            />
          </label>
          <label>
            P(claim) 0–100
            <input
              inputMode="decimal"
              value={String(claim.probability)}
              onChange={(event) => setClaims(claims.map((item) => (item.id === claim.id ? { ...item, probability: Number(event.target.value) } : item)))}
            />
          </label>
        </div>
      ))}
      <button type="button" onClick={() => setClaims([...claims, { id: uid(), claim: "", probability: 50 }])}>
        Add a claim
      </button>
      <label>
        P(thesis) over three years, 0–100
        <input inputMode="decimal" value={probability} onChange={(event) => setProbability(event.target.value)} />
      </label>
      <label>
        Does the thesis beat the bear case?
        <select value={beats} onChange={(event) => setBeats(event.target.value as "" | "yes" | "no")}>
          <option value="">Not answered</option>
          <option value="yes">Yes</option>
          <option value="no">No — archive and revisit next quarter</option>
        </select>
      </label>
      {error ? <p className="warn">{error}</p> : null}
      <button type="submit" className="primary">Judge the bear case</button>
    </form>
  );
}

function BandAndSize({ thesis }: { thesis: Thesis }) {
  const desk = useDesk();
  const [addBelow, setAddBelow] = useState(thesis.addBelowPrice == null ? "" : String(thesis.addBelowPrice));
  const [trimAbove, setTrimAbove] = useState(thesis.trimAbovePrice == null ? "" : String(thesis.trimAbovePrice));
  const [message, setMessage] = useState<string | null>(null);
  const quote = desk.prices?.quotes[thesis.ticker.toUpperCase()];
  const check = assessQuote(
    quote ? { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars } : undefined,
    desk.today,
  );
  const price = check.block === "ok" || check.block === "short" ? quote?.price ?? null : null;
  const instrument = classifyInstrument({ ticker: thesis.ticker, instrumentType: quote?.instrumentType, quoteType: quote?.quoteType });
  const equityBlock = buyBlockedReason(instrument);
  const target = themeTarget(desk.derived.alloc, thesis);
  const lot = desk.derived.lots.find((item) => item.thesisId === thesis.id);
  const earmarked = desk.derived.buckets.earmarked.find((row) => row.thesisId === thesis.id)?.dollars ?? 0;

  const judge = () => {
    const add = addBelow === "" ? null : Number(addBelow);
    const trim = trimAbove === "" ? null : Number(trimAbove);
    const gate = bandGate({ price, addBelow: add, trimAbove: trim, quoteOk: price != null });
    const stage = gate.status === "inside" ? "approved" : "watchlist";
    desk.saveThesis({
      ...thesis,
      addBelowPrice: add,
      trimAbovePrice: trim,
      addBelow: add == null ? thesis.addBelow : `Add below ${add}`,
      trimAbove: trim == null ? thesis.trimAbove : `Trim above ${trim}`,
      stage,
    });
    setMessage(gate.reason);
  };

  const sized = thesis.stage === "approved" ? sizeTranche1({
    targetDollars: thesis.targetMode === "custom" && thesis.targetDollars ? thesis.targetDollars : target,
    capDollars: desk.derived.alloc.positionCap,
    earmarked,
    price,
    marketValue: lot ? (desk.derived.marks.positions.find((item) => item.thesisId === thesis.id)?.marketValue ?? 0) : 0,
    bookValue: desk.derived.marks.bookValue,
    alreadyDeployed: lot?.tranche1 ?? false,
  }) : null;

  return (
    <form
      className="setup"
      onSubmit={(event) => {
        event.preventDefault();
        judge();
      }}
    >
      <p className="kicker">p.2 · valuation band, then one third</p>
      <p className="funding">
        {thesis.ticker} last {price == null ? "unavailable" : moneyAuto(price)} · {check.message} · source {quote?.source ?? "none"} · session {quote?.asOf ?? "—"}
      </p>
      <label>
        Add below
        <input inputMode="decimal" value={addBelow} onChange={(event) => setAddBelow(event.target.value)} />
      </label>
      <label>
        Trim above
        <input inputMode="decimal" value={trimAbove} onChange={(event) => setTrimAbove(event.target.value)} />
      </label>
      {message ? <p className="funding">{message}</p> : null}
      <button type="submit">Check the band</button>
      {equityBlock ? <p className="warn">{equityBlock}</p> : null}
      {thesis.stage === "approved" && sized ? (
        <div className="action buy">
          <p>{sized.reason}</p>
          <p>{sized.ok && !equityBlock ? `Entry third ${moneyAuto(sized.dollars)} · ${sized.shares.toLocaleString("en-US")} shares. This is a suggestion. Confirm to write the ledger.` : equityBlock ?? sized.reason}</p>
          {sized.ok && !equityBlock ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                desk.addTrade({
                  date: desk.today,
                  ticker: thesis.ticker.toUpperCase(),
                  side: "buy",
                  dollars: sized.dollars,
                  shares: sized.shares,
                  price: price ?? 0,
                  sleeve: "conviction",
                  thesisId: thesis.id,
                  tranche: 1,
                  note: "Loop step 4 · entry tranche",
                });
                desk.saveThesis({ ...thesis, stage: "sized" });
              }}
            >
              Confirm entry tranche
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function Revisits() {
  const desk = useDesk();
  const due = desk.state.theses.filter((thesis) => thesis.revisitOn);
  if (due.length === 0) return null;
  return (
    <div className="gaps">
      <h3>Archived until next quarter</h3>
      <ul>
        {due.map((thesis) => (
          <li key={thesis.id}>
            {thesis.ticker || thesis.theme}: revisit {thesis.revisitOn ? prettyDate(thesis.revisitOn) : ""}. The bear case won.
          </li>
        ))}
      </ul>
    </div>
  );
}

function blankScout(today: string): Thesis {
  return {
    id: uid(),
    theme: "",
    ticker: "",
    openedOn: today,
    version: 1,
    marketBelief: "",
    ourBelief: "",
    whyWrong: "",
    killCondition: "",
    killHit: false,
    milestones: [0, 1, 2].map(() => ({
      id: uid(),
      metric: "",
      target: "",
      byDate: "",
      status: "pending" as const,
      resolvedOn: null,
    })),
    valuationMetric: "Versus its own history",
    addBelow: "",
    trimAbove: "",
    valuationPercentile: null,
    bearCase: "",
    targetMode: "plan",
    targetDollars: null,
    probability: null,
    benchmark: "QQQ",
    archived: false,
    log: [],
    ...emptyLoop("scout"),
  };
}
