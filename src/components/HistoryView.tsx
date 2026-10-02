import { prettyDate } from "../lib/dates";
import { moneyAuto } from "../lib/money";
import { useDesk } from "../state";

export function HistoryView() {
  const desk = useDesk();
  const briefs = [...desk.state.briefs].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="sheet">
      <header className="sheet-head">
        <p className="kicker">Archive</p>
        <h2>Past briefs</h2>
        <p className="lede">A brief is written when you open the desk, and replaced if the same day's inputs change. Nothing here is stored on a server.</p>
      </header>
      {briefs.length === 0 ? <p className="empty">No brief has been stored yet.</p> : null}
      {briefs.map((brief) => {
        const actionable = [...brief.schedule, ...brief.engine, ...brief.reminders].filter((action) => action.side !== "hold");
        return (
          <details key={brief.id + brief.generatedAt} className="history" open={brief.date === desk.today}>
            <summary>
              <span>{prettyDate(brief.date)}</span>
              <span>{brief.fridaySweep ? "Friday sweep" : "Daily check"}</span>
              <span>{brief.circuitBreaker ? "Breaker on" : "Breaker clear"}</span>
              <span>{moneyAuto(brief.bookValue)}</span>
            </summary>
            <ul>
              {actionable.length === 0 ? <li>No buy, sell, freeze, or review. Holds were logged.</li> : null}
              {actionable.map((action) => (
                <li key={action.id}>
                  <strong>{action.side}</strong> {action.ticker} {action.dollars ? moneyAuto(action.dollars) : ""} · {action.rule}. {action.reason}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}
