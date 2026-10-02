import { safeAllocate } from "../lib/allocation";
import { prettyDate } from "../lib/dates";
import { moneyAuto, pct, priceFmt } from "../lib/money";
import { wholeBuy, wholeSell } from "../lib/wholeShares";
import { useDesk, type TradeDraft } from "../state";
import { useState } from "react";
import type { BriefAction } from "../types";
import { ChatPanel } from "./ChatPanel";

export function HomeView() {
  const desk = useDesk();
  const [amount, setAmount] = useState(String(desk.state.settings.capital));
  const [amountError, setAmountError] = useState<string | null>(null);
  const commitAmount = () => {
    const plan = safeAllocate(Number(amount.replace(/,/g, "")), desk.state.settings.themeCount);
    if (!plan.ok) {
      setAmountError(plan.error);
      return;
    }
    setAmountError(null);
    desk.updateSettings({ capital: plan.allocation.capital });
  };
  const { brief, performance, buckets } = desk.derived;
  const actions = [...brief.schedule, ...brief.engine.filter((action) => action.side !== "hold"), ...brief.reminders];
  const holds = brief.engine.filter((action) => action.side === "hold").length;
  const latest = [...desk.state.theses].reverse().find((thesis) => !thesis.archived) ?? null;
  const score = [...desk.state.scorecards].reverse()[0] ?? null;
  const pitch = brief.reminders.find((action) => action.rule === "PITCH");

  return (
    <section className="home" aria-labelledby="home-title">
      <header className="sheet-head">
        <p className="kicker">{prettyDate(desk.today)}</p>
        <h2 id="home-title">Now</h2>
        <p className="lede">What matters today. The rest of the desk is one step away. Not financial advice.</p>
      </header>
      <form className="chat-form" onSubmit={(event) => { event.preventDefault(); commitAmount(); }}>
        <label>
          Amount to invest
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
        </label>
        <button type="submit" className="primary">Use this amount</button>
        {amountError ? <p className="warn">{amountError}</p> : <p className="funding">Core, conviction, and dry powder scale from {moneyAuto(desk.state.settings.capital)}. Nothing is bought until you record a fill.</p>}
      </form>
      <div className="home-grid">
        <article className="panel span-4">
          <div className="panel-mark" aria-hidden="true"><span className="shape square" /></div>
          <p className="kicker">Today</p>
          <h3>Actions</h3>
          {actions.length === 0 ? <p className="empty">No buy, sell, or review is due.</p> : null}
          <ul className="action-list">
            {actions.slice(0, 6).map((action) => (
              <li key={action.id}>
                <span className={`shape ${shapeFor(action.side)}`} aria-hidden="true" />
                <span>
                  <strong>{label(action.side)} {action.ticker}</strong>
                  <span className="funding"> {action.rule} · {action.title}{shareLine(action, desk.prices?.quotes[action.ticker]?.price ?? null, heldShares(desk, action))}</span>
                  <span className="fine"> {action.reason}</span>
                </span>
                {action.record && action.dollars != null && action.dollars > 0 && (action.side === "buy" || action.side === "sell") ? (
                  <button type="button" onClick={() => { desk.stageTrade(draftFrom(action, desk.today, desk.prices?.quotes[action.ticker]?.price ?? null)); desk.setTab("ledger"); }}>
                    Stage
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="funding">{holds} hold{holds === 1 ? "" : "s"} logged. <button type="button" onClick={() => desk.setTab("check")}>Full check</button></p>
        </article>
        <article className="panel span-2">
          <div className="panel-mark" aria-hidden="true"><span className={`shape ${brief.fridaySweep ? "circle" : "tri"}`} /></div>
          <p className="kicker">This week</p>
          <h3>{brief.fridaySweep ? "Friday sweep" : "Waiting on Friday"}</h3>
          <p>{brief.fridaySweep ? "The full engine runs today. Circuit breaker first, then the first rule that fires." : "The official sweep is Friday. The same rules still run, so a kill or trim is not missed."}</p>
          <p className={brief.circuitBreaker ? "warn" : "funding"}>{brief.circuitBreaker ? "Circuit breaker on. Adds are frozen." : brief.circuitBreakerEvaluated ? `Circuit breaker clear. Drawdown ${brief.drawdown == null ? "—" : pct(brief.drawdown)}.` : "Book is not fully marked. No freeze was invented."}</p>
        </article>
        <article className="panel span-3">
          <div className="panel-mark" aria-hidden="true"><span className="shape circle" /></div>
          <p className="kicker">This month</p>
          <h3>Scorecard</h3>
          {score ? (
            <p>Saved {score.month}. Book {pct(score.bookReturn)}. SPY {pct(score.spyReturn)}. QQQ {pct(score.qqqReturn)}. Brier {score.brier == null ? "—" : score.brier.toFixed(3)}.</p>
          ) : (
            <p>No scorecard is saved in this browser yet.</p>
          )}
          <p className="funding">{brief.reminders.some((action) => action.rule === "SCORECARD") ? "A scorecard is due. Open the full check to write it." : "Nothing monthly is waiting on the form."}</p>
        </article>
        <article className="panel span-3">
          <div className="panel-mark" aria-hidden="true"><span className="shape tri" /></div>
          <p className="kicker">Book</p>
          <h3>{moneyAuto(brief.bookValue)}</h3>
          <dl className="stats">
            <div><dt>Peak</dt><dd>{moneyAuto(brief.peak)}</dd></div>
            <div><dt>Cash</dt><dd>{moneyAuto(buckets.totalCash)}</dd></div>
            <div><dt>SPY</dt><dd>{pct(performance.spyReturn)}</dd></div>
            <div><dt>QQQ</dt><dd>{pct(performance.qqqReturn)}</dd></div>
          </dl>
          <p className="fine">SPY and QQQ are comparison only. Last marks {priceFmt(desk.prices?.quotes.SPY?.price)} and {priceFmt(desk.prices?.quotes.QQQ?.price)} from the snapshot.</p>
        </article>
        <article className="panel span-6">
          <div className="panel-mark" aria-hidden="true"><span className="shape square" /></div>
          <p className="kicker">Latest research</p>
          <h3>{latest ? `${latest.ticker || "Untitled"} · ${latest.stage}` : "No card yet"}</h3>
          <p>{latest ? latest.theme || latest.ourBelief || "A draft is on the research page." : "The basket and the thesis list start empty. Generate a card or start a scout. Neither one buys a stock."}</p>
          {latest?.stage === "watchlist" ? <p className="funding">Watchlist. Price is outside the band, or the band still needs your check. Not a buy.</p> : null}
          {pitch ? <p className="funding">{pitch.reason}</p> : null}
          <div className="row-actions">
            <button type="button" onClick={() => desk.setTab("loop")}>Research</button>
            <button type="button" onClick={() => desk.setTab("theses")}>Cards</button>
          </div>
        </article>
      </div>
      <ChatPanel />
    </section>
  );
}

function shapeFor(side: BriefAction["side"]): string {
  if (side === "buy") return "square";
  if (side === "sell") return "tri";
  if (side === "freeze") return "tri";
  return "circle";
}

function heldShares(desk: ReturnType<typeof useDesk>, action: BriefAction): number {
  const lot = desk.derived.lots.find((item) => item.ticker.toUpperCase() === action.ticker.toUpperCase());
  return lot?.shares ?? 0;
}

function shareLine(action: BriefAction, price: number | null, held: number): string {
  if (action.side !== "buy" && action.side !== "sell") return action.dollars ? ` · ${moneyAuto(action.dollars)}` : "";
  const sized = action.side === "buy" ? wholeBuy(action.dollars ?? 0, price) : wholeSell(action.dollars ?? 0, price, held);
  if (!sized) return " · price unavailable, no whole-share order";
  return ` · ${sized.shares} whole shares · ${moneyAuto(sized.dollars)} at ${priceFmt(sized.price)}`;
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
