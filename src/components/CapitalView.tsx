import { useEffect, useState } from "react";
import { clampCoreSlots, coreNameTarget, safeAllocate, themeTarget } from "../lib/allocation";
import { prettyDate } from "../lib/dates";
import { buyBlockedReason, classifyInstrument, isBenchmarkTicker } from "../lib/instruments";
import { moneyAuto, pctPlain } from "../lib/money";
import { useDesk } from "../state";

export function CapitalView() {
  const desk = useDesk();
  const { settings } = desk.state;
  const { alloc, buckets, schedule } = desk.derived;
  const [capital, setCapital] = useState(String(settings.capital));
  const [capitalError, setCapitalError] = useState<string | null>(null);
  const [coreDraft, setCoreDraft] = useState("");
  const [coreError, setCoreError] = useState<string | null>(null);

  useEffect(() => {
    setCapital(String(settings.capital));
  }, [settings.capital]);

  const active = desk.state.theses.filter((thesis) => !thesis.archived);
  const commitCapital = (raw = capital) => {
    const next = Number(raw.replace(/,/g, ""));
    const plan = safeAllocate(next, settings.themeCount);
    if (!plan.ok) {
      setCapitalError(plan.error);
      setCapital(String(settings.capital));
      return;
    }
    setCapitalError(null);
    desk.updateSettings({ capital: plan.allocation.capital });
  };

  return (
    <section className="sheet">
      <header className="sheet-head">
        <p className="kicker">01 · Allocation</p>
        <h2>Capital map</h2>
        <p className="lede">
          The worked example is $100,000. Every sleeve, tranche, and cap scales with the amount you fund. Core 30%, conviction 45%, dry powder 25%. Core is individual stocks you choose, not an index. Idle money is cash, not T-bills.
        </p>
      </header>

      <form
        className="setup"
        onSubmit={(event) => {
          event.preventDefault();
          const field = event.currentTarget.querySelector("input");
          commitCapital(field?.value ?? capital);
        }}
      >
        <label>
          Amount to invest
          <input
            inputMode="decimal"
            value={capital}
            onChange={(event) => setCapital(event.target.value)}
            onBlur={(event) => commitCapital(event.currentTarget.value)}
          />
        </label>
        {capitalError ? <p className="warn">{capitalError}</p> : null}
        <label>
          Start date
          <input type="date" value={settings.startDate} onChange={(event) => desk.updateSettings({ startDate: event.target.value })} />
        </label>
        <label>
          Conviction themes
          <select
            value={settings.themeCount}
            onChange={(event) => desk.updateSettings({ themeCount: Number(event.target.value) as 3 | 4 | 5 })}
          >
            <option value={3}>3 themes</option>
            <option value={4}>4 themes</option>
            <option value={5}>5 themes</option>
          </select>
        </label>
        <label>
          Core slots
          <input
            type="number"
            min={1}
            max={20}
            value={settings.coreSlots}
            onChange={(event) => desk.updateSettings({ coreSlots: clampCoreSlots(Number(event.target.value)) })}
          />
        </label>
      </form>
      <form
        className="setup"
        onSubmit={(event) => {
          event.preventDefault();
          const ticker = coreDraft.trim().toUpperCase();
          if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
            setCoreError("Enter one company's ticker.");
            return;
          }
          if (isBenchmarkTicker(ticker)) {
            setCoreError("SPY and QQQ are benchmarks. They cannot sit in the core.");
            return;
          }
          const quote = desk.prices?.quotes[ticker];
          const kind = classifyInstrument({ ticker, instrumentType: quote?.instrumentType, quoteType: quote?.quoteType });
          const blocked = kind === "etf" || kind === "mutualfund" || kind === "other" ? buyBlockedReason(kind) : null;
          if (blocked) {
            setCoreError(blocked);
            return;
          }
          if (settings.coreTickers.includes(ticker)) {
            setCoreDraft("");
            setCoreError(null);
            return;
          }
          desk.updateSettings({ coreTickers: [...settings.coreTickers, ticker] });
          setCoreDraft("");
          setCoreError(kind === "unknown" ? "Added. Buys stay blocked until the snapshot says this symbol is EQUITY." : null);
        }}
      >
        <label>
          Add a core stock you choose
          <input value={coreDraft} onChange={(event) => setCoreDraft(event.target.value.toUpperCase())} placeholder="Ticker" />
        </label>
        <button type="submit">Add to the basket</button>
      </form>
      {coreError ? <p className="warn">{coreError}</p> : null}
      {settings.coreTickers.length === 0 ? (
        <p className="warn">No core names yet. The brief will not recommend a core buy until you choose them. RSI does not ship a stock list.</p>
      ) : (
        <ul className="notes">
          {settings.coreTickers.map((ticker) => (
            <li key={ticker}>
              {ticker} · you chose this
              <button type="button" onClick={() => desk.updateSettings({ coreTickers: settings.coreTickers.filter((item) => item !== ticker) })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {settings.coreSlots < 8 || settings.coreSlots > 10 ? (
        <p className="funding">The intended basket is about 8–10 equal-weight names. Another count is allowed. Unfilled slots stay in cash, and no single name can be bought through 15% of the book.</p>
      ) : (
        <p className="funding">Each name is one equal-weight slot of the 30% core, bought in three monthly tranches. Unfilled slots stay in cash.</p>
      )}
      {desk.state.trades.length > 0 ? (
        <p className="warn">Changing the funded amount rewrites opening cash. Export a backup first if the ledger already has trades.</p>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sleeve</th>
              <th>Weight</th>
              <th>Amount</th>
              <th>Holds</th>
              <th>Benchmark</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Core</td>
              <td>30%</td>
              <td>{moneyAuto(alloc.core)}</td>
              <td>Equal-weight stocks you choose. Three monthly tranches. Sleeve tranche {moneyAuto(alloc.coreTranche)} before it is split.</td>
              <td>The basket</td>
            </tr>
            <tr>
              <td>Conviction</td>
              <td>45%</td>
              <td>{moneyAuto(alloc.conviction)}</td>
              <td>{settings.themeCount} themes, each in thirds. Unspent thirds wait in cash.</td>
              <td>QQQ</td>
            </tr>
            <tr>
              <td>Dry powder</td>
              <td>25%</td>
              <td>{moneyAuto(alloc.dryPowder)}</td>
              <td>Cash. Extra fear adds, new themes, and every trim or exit.</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Whole book</td>
              <td>100%</td>
              <td>{moneyAuto(alloc.capital)}</td>
              <td>Buys stop at 15% of book ({moneyAuto(alloc.positionCap)}). Trim above 20%.</td>
              <td>SPY, comparison only</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Tranche math</h3>
      <p className="lede">
        {settings.themeCount} themes at {moneyAuto(alloc.perTheme)} each = {moneyAuto(alloc.themeTranche)} tranches. The fewer the themes, the higher the bar each one must clear. A theme target cannot exceed {moneyAuto(alloc.positionCap)}, 15% of the funded book.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Theme</th>
              <th>Target</th>
              <th>One tranche</th>
              <th>Still earmarked</th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 ? (
              <tr>
                <td colSpan={4}>No thesis cards yet. The conviction sleeve, {moneyAuto(buckets.unassignedConviction)}, is cash.</td>
              </tr>
            ) : (
              active.map((thesis) => {
                const target = themeTarget(alloc, thesis);
                const earmarked = buckets.earmarked.find((row) => row.thesisId === thesis.id)?.dollars ?? 0;
                return (
                  <tr key={thesis.id}>
                    <td>{thesis.ticker || "—"} · {thesis.theme || "Untitled"}</td>
                    <td>{moneyAuto(target)}</td>
                    <td>{moneyAuto(target / 3)}</td>
                    <td>{moneyAuto(earmarked)}</td>
                  </tr>
                );
              })
            )}
            <tr>
              <td>Unassigned conviction</td>
              <td colSpan={3}>{moneyAuto(buckets.unassignedConviction)} in cash, waiting for a theme that clears the bar.</td>
            </tr>
          </tbody>
        </table>
      </div>
      {active.length < settings.themeCount ? (
        <p className="empty">{settings.themeCount - active.length} theme slot{settings.themeCount - active.length === 1 ? "" : "s"} still open.</p>
      ) : null}
      {buckets.overAllocated ? <p className="warn">Reservations exceed the cash on hand. Lower a target or match the theme count to the cards.</p> : null}

      <h3>Where the cash sits</h3>
      <dl className="stats">
        <div>
          <dt>Core reserve</dt>
          <dd>{moneyAuto(buckets.coreReserve)}</dd>
        </div>
        <div>
          <dt>Earmarked</dt>
          <dd>{moneyAuto(buckets.earmarkedTotal)}</dd>
        </div>
        <div>
          <dt>Unassigned</dt>
          <dd>{moneyAuto(buckets.unassignedConviction)}</dd>
        </div>
        <div>
          <dt>Dry powder</dt>
          <dd>{moneyAuto(buckets.dryPowder)}</dd>
        </div>
      </dl>
      <p className="funding">
        Idle money is cash, carried at par.{" "}
        {settings.coreTickers.length === 0
          ? "Name the core stocks before a core dollar is sized."
          : `Each chosen name is targeted at ${moneyAuto(coreNameTarget(alloc, settings.coreTickers.length, settings.coreSlots))}.`}{" "}
        SPY and QQQ are not holdings.
      </p>

      <h3>Deployment</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Date</th>
              <th>Status</th>
              <th>Plan</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((row) => (
              <tr key={row.id}>
                <td>{row.label}</td>
                <td>{prettyDate(row.date)}</td>
                <td className={`status ${row.status}`}>{row.status}</td>
                <td>
                  {row.detail}
                  {row.amount != null ? ` ${moneyAuto(row.amount)}.` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Four rules that do not bend</h3>
      <ol className="rules-list">
        <li>Never average down on a thesis that has missed a milestone.</li>
        <li>Never exit a whole position on sentiment alone. Only the kill condition does that.</li>
        <li>Never change a rule during a drawdown. Here that means the marked book is down 10% or more from its peak. An incomplete mark stays locked too.</li>
        <li>If the conviction sleeve trails QQQ after four quarters, move that capital into the core stock basket.</li>
      </ol>

      <h3>Cadence</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Work</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Weekly, Friday</td>
              <td>Full engine on every position. Circuit breaker first. The app also checks prices on the other days.</td>
            </tr>
            <tr>
              <td>Monthly</td>
              <td>Scorecard: milestones, probability calibration, returns versus QQQ and SPY. Those two are benchmarks only.</td>
            </tr>
            <tr>
              <td>Quarterly</td>
              <td>Post-mortems. Change at most one rule. Version the rulebook. Refresh valuation bands.</td>
            </tr>
            <tr>
              <td>Yearly</td>
              <td>Rebalance the core stocks to equal weight. Meta-rule test: has the conviction sleeve earned its place against QQQ? If not, the capital moves into the core basket.</td>
            </tr>
          </tbody>
        </table>
      </div>
      {desk.derived.performance.bookReturn != null ? (
        <p className="funding">
          Book {pctPlain(desk.derived.performance.bookReturn)} since funding. SPY {pctPlain(desk.derived.performance.spyReturn)} and QQQ{" "}
          {pctPlain(desk.derived.performance.qqqReturn)} since the first snapshot stored in this browser. Conviction sleeve{" "}
          {pctPlain(desk.derived.performance.convictionReturn)}.
        </p>
      ) : null}
    </section>
  );
}
