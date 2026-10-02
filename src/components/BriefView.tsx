import { useState } from "react";
import type { BriefAction } from "../types";
import { monthKey, prettyDate } from "../lib/dates";
import { uid } from "../lib/id";
import { brierScore, calibrationTable } from "../lib/loop";
import { moneyAuto, pctPlain, priceFmt } from "../lib/money";
import { useDesk, type TradeDraft } from "../state";

export function BriefView() {
  const desk = useDesk();
  const { brief } = desk.derived;
  const holds = brief.engine.filter((action) => action.side === "hold");
  const orders = brief.engine.filter((action) => action.side !== "hold");

  return (
    <section className="sheet" aria-labelledby="brief-title">
      <header className="sheet-head">
        <p className="kicker">{brief.fridaySweep ? "Friday · full engine sweep" : "Daily · price and signal check"}</p>
        <h2 id="brief-title">Today's actions</h2>
        <p className="lede">
          {prettyDate(brief.date)}. {brief.fridaySweep
            ? "The playbook runs the full engine every Friday. This is that sweep: circuit breaker first, then each open position, first rule that fires."
            : "The playbook's official sweep is Friday. Today's brief still runs the same rules, so a kill, trim, freeze, or add is not missed between Fridays."}
        </p>
      </header>

      <div className={brief.circuitBreaker ? "breaker on" : "breaker"}>
        <strong>{brief.circuitBreaker ? "Circuit breaker on" : brief.circuitBreakerEvaluated ? "Circuit breaker clear" : "Circuit breaker not evaluated"}</strong>
        <span>
          {brief.circuitBreaker
            ? "The book is down 30% or more from its peak. Adds are frozen. Exits and trims still run."
            : brief.circuitBreakerEvaluated
              ? `Drawdown ${pctPlain(brief.drawdown)} from the peak. Adds are allowed.`
              : "Book value is incomplete, so no drawdown is shown and no freeze is invented."}
        </span>
      </div>

      <h3>Snapshot</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Session</th>
              <th>Age</th>
              <th>Source</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {brief.quotes.map((quote) => (
              <tr key={quote.ticker}>
                <td>{quote.ticker}{quote.role === "benchmark" ? " · benchmark" : ""}</td>
                <td>{quote.asOf ? prettyDate(quote.asOf) : "—"}</td>
                <td>{quote.ageTradingDays == null ? "—" : `${quote.ageTradingDays} trading day${quote.ageTradingDays === 1 ? "" : "s"}`}</td>
                <td>{quote.source}</td>
                <td>{quote.block}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="funding">Fetched {desk.prices?.fetchedAt ? new Date(desk.prices.fetchedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—"}. {desk.priceNote}</p>

      <dl className="stats">
        <div>
          <dt>Book</dt>
          <dd>{moneyAuto(brief.bookValue)}</dd>
        </div>
        <div>
          <dt>Peak</dt>
          <dd>{moneyAuto(brief.peak)}</dd>
        </div>
        <div>
          <dt>Dry powder</dt>
          <dd>{moneyAuto(desk.derived.buckets.dryPowder)}</dd>
        </div>
        <div>
          <dt>Cash</dt>
          <dd>{moneyAuto(desk.derived.buckets.totalCash)}</dd>
        </div>
      </dl>

      <ActionGroup title="Deployment" empty="No calendar buy is due today." actions={brief.schedule} />
      <ActionGroup title="Execution engine" empty="No open position produced an exit, trim, freeze, or add." actions={orders} />
      <ActionGroup title="Scorecard and calendar" empty="No monthly, quarterly, or yearly review is due." actions={brief.reminders} />

      {holds.length > 0 && (
        <details className="log">
          <summary>Logged holds · {holds.length}</summary>
          <ActionGroup title="Holds" empty="" actions={holds} />
        </details>
      )}

      {brief.dataGaps.length > 0 && (
        <div className="gaps">
          <h3>Missing data</h3>
          <ul>
            {brief.dataGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="notes">
        {brief.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      <details className="rules">
        <summary>Rule order</summary>
        <ol>
          <li>Circuit breaker. Book down 30% from its peak freezes every add, including scheduled deployment. Exits and trims still run.</li>
          <li>R1. Kill condition, or a second missed milestone. Exit 100%. Proceeds to cash. Post-mortem within 7 days.</li>
          <li>R2. Extreme greed (price 50% or more above the 200-day average, or a top-decile valuation) or a position above 20% of the book. Trim 20% in v1.0, inside the 20–25% band, or back to 15% if overweight. Never a full exit.</li>
          <li>R3. One missed milestone. Freeze adds. A second miss is a kill. Never average down.</li>
          <li>R4. Extreme fear needs all three signals, on the stock itself, plus intact milestones. Buy tranche 2 from earmarked cash, then dry powder. A later cash add waits until tranches 2 and 3 are both done.</li>
          <li>R5. A milestone confirmed since the last buy, on reported numbers. Buy tranche 3 if it is unused. Same 15% cap.</li>
          <li>Otherwise hold, and log the check.</li>
        </ol>
      </details>
    </section>
  );
}

function ActionGroup({ title, empty, actions }: { title: string; empty: string; actions: BriefAction[] }) {
  const desk = useDesk();
  return (
    <div className="group">
      <h3>{title}</h3>
      {actions.length === 0 && empty ? <p className="empty">{empty}</p> : null}
      <div className="actions">
        {actions.map((action) => (
          <article key={action.id} className={`action ${action.side}`}>
            <div className="action-top">
              <span className="side">{label(action.side)}</span>
              <span className="ticker">{action.ticker}</span>
              <span className="amount">{action.dollars == null || action.dollars === 0 ? "—" : moneyAuto(action.dollars)}</span>
            </div>
            <p className="action-title">{action.rule} · {action.title}</p>
            <p>{action.reason}</p>
            {action.funding ? <p className="funding">{action.funding}</p> : null}
            {action.shares != null && action.side !== "hold" ? (
              <p className="funding">About {action.shares.toLocaleString("en-US")} shares at the snapshot price {priceFmt(desk.prices?.quotes[action.ticker]?.price)}.</p>
            ) : null}
            {action.rule === "SCORECARD" ? <ScorecardForm month={action.id.split(":")[1] ?? monthKey(desk.today)} /> : null}
            {action.rule === "POSTMORTEM" ? <PostmortemForm quarterDate={action.id.split(":")[1] ?? desk.today} /> : null}
            <div className="action-buttons">
              {action.record && action.dollars != null && action.dollars > 0 && (action.side === "buy" || action.side === "sell") ? (
                <button type="button" onClick={() => desk.stageTrade(draftFrom(action, desk.today, desk.prices?.quotes[action.ticker]?.price ?? null))}>
                  Record this trade
                </button>
              ) : null}
              {action.rule === "REBALANCE" ? (
                <button type="button" onClick={() => desk.ackReview(action)}>
                  Record that the core was reviewed
                </button>
              ) : null}
              {action.rule === "METARULE" ? (
                <button type="button" onClick={() => desk.setTab("rulebook")}>
                  Open the meta-rule
                </button>
              ) : null}
              {action.rule === "MILESTONE-DUE" ? (
                <button type="button" onClick={() => desk.setTab("theses")}>
                  Update the card
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function label(side: BriefAction["side"]): string {
  if (side === "buy") return "Buy";
  if (side === "sell") return "Sell";
  if (side === "freeze") return "Freeze";
  if (side === "review") return "Review";
  return "Hold";
}

function draftFrom(action: BriefAction, today: string, price: number | null): TradeDraft {
  const tranche = action.record?.tranche;
  return {
    date: today,
    ticker: action.ticker,
    side: action.side === "sell" ? "sell" : "buy",
    dollars: action.dollars == null ? "" : String(action.dollars),
    price: price == null ? "" : String(Math.round(price * 100) / 100),
    sleeve: action.record?.sleeve ?? "conviction",
    thesisId: action.record?.thesisId ?? "",
    tranche: tranche == null ? "" : (String(tranche) as TradeDraft["tranche"]),
    note: action.title,
    fromEngine: true,
    exitReason: action.rule === "R1" ? "kill" : "trim",
  };
}

function ScorecardForm({ month }: { month: string }) {
  const desk = useDesk();
  const [notes, setNotes] = useState("");
  const [calls, setCalls] = useState(() =>
    desk.state.theses.filter((thesis) => !thesis.archived && thesis.probability != null).map((thesis) => ({
      id: thesis.id,
      label: thesis.ticker,
      probability: (thesis.probability ?? 0) / 100,
      outcome: null as 0 | 1 | null,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const table = calibrationTable(calls);
  const brier = brierScore(calls);

  return (
    <form
      className="setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (notes.trim().length < 20) {
          setError("Write the scorecard. Milestones, calibration, and the benchmark comparison need a sentence.");
          return;
        }
        desk.saveScorecard({
          id: uid(),
          month,
          date: desk.today,
          notes: notes.trim(),
          calls,
          brier,
          bookReturn: desk.derived.performance.bookReturn,
          spyReturn: desk.derived.performance.spyReturn,
          qqqReturn: desk.derived.performance.qqqReturn,
          convictionReturn: desk.derived.performance.convictionReturn,
        });
        setError(null);
      }}
    >
      <p className="kicker">p.2 step 6 · this does not clear until the form is saved</p>
      <label>
        What was hit, missed, and how the probabilities compared
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {calls.map((call) => (
        <label key={call.id}>
          {call.label} · P {Math.round(call.probability * 100)}
          <select
            value={call.outcome == null ? "" : String(call.outcome)}
            onChange={(event) => {
              const outcome = event.target.value === "" ? null : (Number(event.target.value) as 0 | 1);
              setCalls(calls.map((item) => (item.id === call.id ? { ...item, outcome } : item)));
            }}
          >
            <option value="">Unresolved</option>
            <option value="1">Hit</option>
            <option value="0">Missed</option>
          </select>
        </label>
      ))}
      <p className="funding">Brier {brier == null ? "n/a (unresolved calls are not misses)" : brier.toFixed(3)}. Calibration buckets with data: {table.filter((row) => row.count > 0).length}.</p>
      {error ? <p className="warn">{error}</p> : null}
      <button type="submit" className="primary">Save the scorecard</button>
    </form>
  );
}

function PostmortemForm({ quarterDate }: { quarterDate: string }) {
  const desk = useDesk();
  const [skill, setSkill] = useState<"skill" | "luck" | "mixed">("mixed");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (notes.trim().length < 20) {
          setError("A post-mortem names skill or luck and the evidence. One sentence at least.");
          return;
        }
        desk.savePostmortem({ id: uid(), quarterDate, date: desk.today, skillOrLuck: skill, notes: notes.trim() });
        setError(null);
      }}
    >
      <p className="kicker">p.2 step 7 · change at most one rule, on the Rulebook tab, and not in a drawdown</p>
      <label>
        Skill or luck
        <select value={skill} onChange={(event) => setSkill(event.target.value as "skill" | "luck" | "mixed")}>
          <option value="skill">Skill</option>
          <option value="luck">Luck</option>
          <option value="mixed">Mixed</option>
        </select>
      </label>
      <label>
        What won, what lost, and why
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {error ? <p className="warn">{error}</p> : null}
      <button type="submit" className="primary">Save the post-mortem</button>
      <button type="button" onClick={() => desk.setTab("rulebook")}>Open the rulebook</button>
    </form>
  );
}
