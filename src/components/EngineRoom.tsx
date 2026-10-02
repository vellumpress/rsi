import { prettyDate } from "../lib/dates";
import { useDesk } from "../state";

/** Read-only. The Boss and the operator look here. Nothing on this page writes a rule or a trade. */
export function EngineRoom() {
  const desk = useDesk();
  const { brief } = desk.derived;
  const book = desk.state.rulebook;
  const card = desk.state.scorecards.at(-1) ?? null;
  const note = desk.state.postmortems.at(-1) ?? null;
  return (
    <section className="sheet" aria-labelledby="engine-title">
      <header className="sheet-head">
        <p className="kicker">Closed loop</p>
        <h2 id="engine-title">Engine room</h2>
        <p className="lede">Loop status, the latest scorecard, lessons from the Boss, and the rulebook. This page does not place a trade and does not change a rule.</p>
      </header>
      <div className="home-grid">
        <article className="panel span-3">
          <p className="kicker">Loop</p>
          <h3>{brief.fridaySweep ? "Friday sweep" : "Daily check"}</h3>
          <p>{brief.circuitBreaker ? "Circuit breaker on. Adds are frozen." : "Circuit breaker is not on."}</p>
          <p className="funding">{prettyDate(brief.date)}. Rulebook {book.version}, cycle {book.cycle}.</p>
        </article>
        <article className="panel span-3">
          <p className="kicker">Scorecard</p>
          <h3>{card ? card.month : "None yet"}</h3>
          <p>{card ? `Brier ${card.brier == null ? "unset" : card.brier.toFixed(3)}. ${card.notes}` : "The first monthly scorecard is written after a month of the loop."}</p>
        </article>
        <article className="panel span-6">
          <p className="kicker">Rulebook</p>
          <h3>{book.changelog.length ? "Versions" : "No change yet"}</h3>
          {book.changelog.length === 0 ? <p>v{book.version} is the live book. One change a quarter, and never an immutable rail.</p> : null}
          <ul className="action-list">
            {book.changelog.map((change) => (
              <li key={change.id}>
                <span>
                  <strong>{change.fromVersion} → {change.toVersion}</strong>
                  <span className="funding"> {change.quarterKey} · {change.parameter} {String(change.previous)} → {String(change.next)}</span>
                  <span className="fine"> {change.evidence}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel span-3">
          <p className="kicker">Post-mortem</p>
          <h3>{note ? note.skillOrLuck : "None yet"}</h3>
          <p>{note ? note.notes : "A quarter labels a result skill or luck, with the evidence written down."}</p>
        </article>
        <article className="panel span-3">
          <p className="kicker">Boss notes</p>
          <h3>{desk.feedback.length ? `${desk.feedback.length} stored` : "None yet"}</h3>
          <ul className="action-list">
            {desk.feedback.slice(-6).map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.tag}</strong>
                  <span className="funding"> {item.date}</span>
                  <span className="fine"> {item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel span-6">
          <p className="kicker">Data health</p>
          <h3>Snapshot</h3>
          <ul className="action-list">
            {brief.quotes.map((quote) => (
              <li key={quote.ticker}>
                <span>
                  <strong>{quote.ticker}</strong>
                  <span className="funding"> {quote.block}</span>
                  <span className="fine"> {quote.message}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
