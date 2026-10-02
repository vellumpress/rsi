import { useEffect, useState } from "react";
import { prettyDate } from "../lib/dates";
import { reviewManualTrade } from "../lib/guards";
import { moneyAuto, pctPlain, priceFmt } from "../lib/money";
import { useDesk, type TradeDraft } from "../state";
import type { TrancheTag } from "../types";

const emptyDraft = (today: string, core: "SPY" | "QQQ"): TradeDraft => ({
  date: today,
  ticker: core,
  side: "buy",
  dollars: "",
  price: "",
  sleeve: "core",
  thesisId: "",
  tranche: "1",
  note: "",
});

export function LedgerView() {
  const desk = useDesk();
  const [form, setForm] = useState<TradeDraft>(() => emptyDraft(desk.today, desk.state.settings.coreTicker));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ dollars: number; shares: number } | null>(null);

  useEffect(() => {
    if (!desk.draft) return;
    setForm(desk.draft);
    setError(null);
    desk.clearDraft();
  }, [desk.draft, desk]);

  const price = Number(form.price);
  const dollars = Number(form.dollars);
  const quote = desk.prices?.quotes[form.ticker.toUpperCase()];
  const thesis = desk.state.theses.find((item) => item.id === form.thesisId);
  const lot = desk.derived.lots.find((item) => (form.sleeve === "core" ? item.id === "core" : item.thesisId === form.thesisId));
  const mark = desk.derived.marks.positions.find((item) => item.id === lot?.id);

  const prepare = () => {
    if (form.sleeve === "conviction" && !form.thesisId) {
      setError("Pick the thesis this trade belongs to.");
      setPending(null);
      return;
    }
    const tranche: TrancheTag | null = form.side === "buy" && form.tranche ? (form.tranche === "fear" ? "fear" : (Number(form.tranche) as 1 | 2 | 3)) : null;
    const cash = form.sleeve === "core"
      ? desk.derived.buckets.coreReserve
      : (desk.derived.buckets.earmarked.find((row) => row.thesisId === form.thesisId)?.dollars ?? 0) + desk.derived.buckets.dryPowder;
    const review = reviewManualTrade({
      side: form.side,
      dollars,
      price,
      sleeve: form.sleeve,
      tranche,
      heldShares: lot?.shares ?? 0,
      missedMilestones: thesis?.milestones.filter((milestone) => milestone.status === "missed").length ?? 0,
      killHit: thesis?.killHit ?? false,
      exitReason: form.exitReason ?? "trim",
      fromEngine: form.fromEngine === true,
      alreadyDeployed: lot?.tranche1 === true && tranche === 1,
      marketValue: mark?.marketValue ?? 0,
      bookValue: desk.derived.marks.bookValue,
      cash,
    });
    if (!review.ok) {
      setError(review.reason);
      setPending(null);
      return;
    }
    setError(null);
    setPending({ dollars: review.dollars, shares: review.shares });
  };

  const confirm = () => {
    if (!pending) return;
    const tranche: TrancheTag | undefined = form.side === "buy" && form.tranche ? (form.tranche === "fear" ? "fear" : (Number(form.tranche) as 1 | 2 | 3)) : undefined;
    desk.addTrade({
      date: form.date,
      ticker: form.ticker.trim().toUpperCase(),
      side: form.side,
      dollars: pending.dollars,
      shares: pending.shares,
      price,
      sleeve: form.sleeve,
      thesisId: form.sleeve === "conviction" ? form.thesisId : undefined,
      tranche,
      note: form.note,
    });
    setPending(null);
    setForm(emptyDraft(desk.today, desk.state.settings.coreTicker));
  };

  return (
    <section className="sheet">
      <header className="sheet-head">
        <p className="kicker">Ledger</p>
        <h2>Holdings</h2>
        <p className="lede">The brief recommends. The book changes only when you record a buy or a sell. Fill prices are yours. Mark-to-market uses the snapshot, and only the snapshot.</p>
      </header>

      <form
        className="setup"
        onSubmit={(event) => {
          event.preventDefault();
          prepare();
        }}
      >
        <label>
          Date
          <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </label>
        <label>
          Side
          <select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value as "buy" | "sell" })}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>
        <label>
          Sleeve
          <select
            value={form.sleeve}
            onChange={(event) => {
              const sleeve = event.target.value as "core" | "conviction";
              setForm({
                ...form,
                sleeve,
                ticker: sleeve === "core" ? desk.state.settings.coreTicker : form.ticker,
                thesisId: sleeve === "core" ? "" : form.thesisId,
              });
            }}
          >
            <option value="core">Core</option>
            <option value="conviction">Conviction</option>
          </select>
        </label>
        {form.sleeve === "conviction" ? (
          <label>
            Thesis
            <select value={form.thesisId} onChange={(event) => {
              const thesis = desk.state.theses.find((item) => item.id === event.target.value);
              setForm({ ...form, thesisId: event.target.value, ticker: thesis?.ticker || form.ticker });
            }}>
              <option value="">Select</option>
              {desk.state.theses.filter((thesis) => !thesis.archived).map((thesis) => (
                <option key={thesis.id} value={thesis.id}>{thesis.ticker} · {thesis.theme}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Ticker
          <input value={form.ticker} onChange={(event) => setForm({ ...form, ticker: event.target.value.toUpperCase() })} />
        </label>
        {form.side === "buy" ? (
          <label>
            Tranche
            <select value={form.tranche || "1"} onChange={(event) => setForm({ ...form, tranche: event.target.value as TradeDraft["tranche"], fromEngine: false })}>
              <option value="1">1 · entry</option>
              {form.fromEngine ? <option value={form.tranche}>{form.tranche} · from the engine</option> : null}
            </select>
          </label>
        ) : null}
        <label>
          Dollars
          <input inputMode="decimal" value={form.dollars} onChange={(event) => setForm({ ...form, dollars: event.target.value })} />
        </label>
        <label>
          Fill price
          <input inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
        </label>
        {form.side === "sell" ? (
          <label>
            Why
            <select value={form.exitReason ?? "trim"} onChange={(event) => setForm({ ...form, exitReason: event.target.value as TradeDraft["exitReason"] })}>
              <option value="trim">Trim · not a full exit</option>
              <option value="kill">Kill · full exit</option>
              <option value="meta-rule">Rule 04 · shrink the sleeve</option>
              <option value="sentiment">Sentiment</option>
            </select>
          </label>
        ) : null}
        <label>
          Note
          <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
        <p className="funding">
          {quote?.price != null ? `Snapshot last is ${priceFmt(quote.price)} as of ${quote.asOf ?? "an unknown session"} · ${quote.source}. Use your fill if it differs.` : "No snapshot price for this ticker."}
        </p>
        {error ? <p className="warn">{error}</p> : null}
        <button type="submit">Check this trade</button>
        {pending ? (
          <div className="action buy">
            <p>Confirm {form.side} of {moneyAuto(pending.dollars)} · {pending.shares.toLocaleString("en-US")} shares. Nothing is written until you confirm.</p>
            <button type="button" className="primary" onClick={confirm}>Confirm and record</button>
          </div>
        ) : null}
      </form>
      {desk.undoId ? (
        <p className="funding">
          The last trade is on the book. <button type="button" onClick={desk.undoTrade}>Undo it</button>
        </p>
      ) : null}

      <h3>Book</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Sleeve</th>
              <th>Shares</th>
              <th>Avg cost</th>
              <th>Last</th>
              <th>Value</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {desk.derived.marks.positions.length === 0 ? (
              <tr>
                <td colSpan={7}>No open positions. Cash is {moneyAuto(desk.derived.buckets.totalCash)}.</td>
              </tr>
            ) : (
              desk.derived.marks.positions.map((position) => (
                <tr key={position.id}>
                  <td>{position.ticker}</td>
                  <td>{position.sleeve}</td>
                  <td>{position.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                  <td>{priceFmt(position.avgCost)}</td>
                  <td>{position.price == null ? "Missing" : priceFmt(position.price)}</td>
                  <td>{moneyAuto(position.marketValue)}</td>
                  <td>{pctPlain(position.weight)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="funding">
        Peak book {moneyAuto(desk.state.peakBook)}. {desk.derived.marks.complete ? `Marked book ${moneyAuto(desk.derived.marks.bookValue)}.` : "Marked book is incomplete because a price is missing."}
      </p>

      <h3>Trades</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Side</th>
              <th>Ticker</th>
              <th>Dollars</th>
              <th>Price</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...desk.state.trades].reverse().map((trade) => (
              <tr key={trade.id}>
                <td>{prettyDate(trade.date)}</td>
                <td>{trade.side}</td>
                <td>{trade.ticker}</td>
                <td>{moneyAuto(trade.dollars)}</td>
                <td>{priceFmt(trade.price)}</td>
                <td>
                  <button type="button" onClick={() => desk.deleteTrade(trade.id)}>Remove</button>
                </td>
              </tr>
            ))}
            {desk.state.trades.length === 0 ? (
              <tr>
                <td colSpan={6}>No trades recorded.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
