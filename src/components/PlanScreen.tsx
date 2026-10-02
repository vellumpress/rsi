import { useEffect, useState } from "react";
import { ONBOARD_PLAN } from "../lib/onboardPlan";
import { completeGrok } from "../lib/llm";
import { moneyAuto, priceFmt } from "../lib/money";
import { MAX_CAPITAL_DOLLARS } from "../lib/cents";
import { getSupabase } from "../lib/supabase";

interface OrderView {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  shares: number;
  referencePrice: number;
  dollars: number;
  reason: string;
  notedOn: string;
  run: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function PlanScreen({ userId }: { userId: string | null }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [capital, setCapital] = useState<number | null>(null);
  const [filled, setFilled] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    void loadPlan().then((loaded) => {
      if (cancel || !loaded) return;
      setOrders(loaded.orders);
      setCapital(loaded.capital);
      setFilled(loaded.filled);
    }).catch(() => {
      if (!cancel) setError("Today's plan could not be read. No orders are shown.");
    });
    return () => {
      cancel = true;
    };
  }, [userId]);

  const spent = orders.reduce((sum, order) => sum + order.dollars, 0);
  const cash = capital == null ? null : Math.round((capital - spent) * 100) / 100;

  const build = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!userId) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_CAPITAL_DOLLARS) {
      setOrders([]);
      setCapital(null);
      setError(value > MAX_CAPITAL_DOLLARS ? "That amount is too large to size safely. No orders were stored." : "Enter how much to invest. No orders were stored.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setError("This desk is missing its Supabase anon key. No orders were stored.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: invokeError } = await supabase.functions.invoke("rsi-onboard", { body: { amount: value } });
    if (invokeError) {
      setOrders([]);
      setCapital(null);
      setError(await invokeMessage(invokeError));
      setBusy(false);
      return;
    }
    try {
      const loaded = await loadPlan();
      if (!loaded) {
        setOrders([]);
        setError("The plan was stored but could not be read.");
      } else {
        setOrders(loaded.orders);
        setCapital(loaded.capital);
        setFilled(loaded.filled);
      }
    } catch {
      setOrders([]);
      setError("The plan was stored but could not be read.");
    }
    setBusy(false);
  };

  const mark = async (order: OrderView) => {
    if (!userId || filled.has(order.id)) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const { error: insertError } = await supabase.from("fills").insert({
      user_id: userId,
      ticker: order.ticker,
      side: order.side,
      shares: order.shares,
      price: order.referencePrice,
      traded_on: order.notedOn,
      recommendation_id: order.id,
    });
    if (insertError) {
      setError(insertError.message || "The fill was not recorded.");
      return;
    }
    setFilled((prev) => new Set(prev).add(order.id));
  };

  const ask = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !userId || chatBusy) return;
    const messages = [...thread, { role: "user" as const, content: text }];
    setThread(messages);
    setDraft("");
    setChatBusy(true);
    try {
      const reply = await completeGrok({ stream: true, messages });
      setThread([...messages, { role: "assistant", content: reply }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The Boss did not answer.";
      setThread([...messages, { role: "assistant", content: message }]);
    }
    setChatBusy(false);
  };

  return (
    <>
      <section className="panel">
        <p className="kicker">Today</p>
        <h2>How much to invest</h2>
        <p className="lede">One number. The server prices a fixed list of large-cap stocks, then writes today's whole-share orders. RSI does not place a trade.</p>
        <form className="setup" onSubmit={(event) => void build(event)}>
          <label>
            Amount to invest
            <input
              inputMode="decimal"
              name="amount"
              autoComplete="off"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <div className="row-actions">
            <button type="submit" className="primary" disabled={busy || !userId}>{busy ? "Building" : "Build today's plan"}</button>
          </div>
        </form>
        {!userId ? <p>Sign in to build the plan.</p> : null}
        {error ? <p className="warn" role="alert">{error}</p> : null}
      </section>

      <section className="panel" aria-label="Today's orders">
        <h3>Today's orders</h3>
        {orders.length === 0 ? <p>No orders yet.</p> : (
          <>
            <p className="lede">
              Cash stays {cash == null ? "—" : moneyAuto(cash)}. That is the 25% dry powder plus the two tranches not bought today.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Side</th>
                    <th>Shares</th>
                    <th>Reference price</th>
                    <th>Amount</th>
                    <th>Reason</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.ticker}</td>
                      <td>{order.side === "sell" ? "SELL" : "BUY"}</td>
                      <td>{order.shares}</td>
                      <td>{priceFmt(order.referencePrice)}</td>
                      <td>{moneyAuto(order.dollars)}</td>
                      <td>{order.reason}</td>
                      <td>
                        {filled.has(order.id) ? <span className="status done">Recorded</span> : (
                          <button type="button" onClick={() => void mark(order)}>Mark as done</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="chat" aria-label="The Boss">
        <h2>The Boss</h2>
        <p className="lede">Ask about today's plan. The server reads the stored orders and the reasons. This box does not place a trade.</p>
        {thread.length > 0 ? (
          <div className="transcript">
            {thread.map((turn, index) => (
              <p key={`${turn.role}-${index}`} className={`bubble ${turn.role}`}>{turn.content}</p>
            ))}
          </div>
        ) : null}
        <form className="chat-form" onSubmit={(event) => void ask(event)}>
          <label>
            Message
            <input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!userId || chatBusy} />
          </label>
          <button type="submit" disabled={!userId || chatBusy || !draft.trim()}>Send</button>
        </form>
        {!userId ? <p>Sign in to talk to the Boss.</p> : null}
      </section>
    </>
  );
}

async function loadPlan(): Promise<{ orders: OrderView[]; capital: number | null; filled: Set<string> } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const [recs, profile, fills] = await Promise.all([
    supabase.from("recommendations").select("id, ticker, side, shares, reference_price, dollars, reason, noted_on, inputs, created_at").order("created_at", { ascending: true }),
    supabase.from("profiles").select("capital").maybeSingle(),
    supabase.from("fills").select("recommendation_id"),
  ]);
  if (recs.error || profile.error || fills.error) {
    throw new Error(recs.error?.message || profile.error?.message || fills.error?.message || "read failed");
  }
  const rows = (recs.data ?? []).flatMap((row) => {
    const order = toOrder(row);
    return order ? [order] : [];
  });
  const latest = rows.at(-1)?.run ?? "";
  const orders = rows.filter((order) => order.run === latest);
  const done = new Set(
    (fills.data ?? []).map((row) => row.recommendation_id).filter((id): id is string => typeof id === "string"),
  );
  const capital = profile.data?.capital == null ? null : Number(profile.data.capital);
  return { orders, capital: Number.isFinite(capital) ? capital : null, filled: done };
}

function toOrder(row: {
  id: string;
  ticker: string;
  side: string;
  shares: number | string | null;
  reference_price: number | string | null;
  dollars: number | string | null;
  reason: string;
  noted_on: string;
  inputs: unknown;
}): OrderView | null {
  const inputs = row.inputs && typeof row.inputs === "object" ? row.inputs as { plan?: unknown; run?: unknown } : null;
  const shares = Number(row.shares);
  const referencePrice = Number(row.reference_price);
  const dollars = Number(row.dollars);
  if (inputs?.plan !== ONBOARD_PLAN || typeof inputs.run !== "string" || !inputs.run) return null;
  if (!Number.isInteger(shares) || shares < 1 || !Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  if (row.side !== "buy" && row.side !== "sell") return null;
  return {
    id: row.id,
    ticker: row.ticker,
    side: row.side,
    shares,
    referencePrice,
    dollars,
    reason: row.reason,
    notedOn: String(row.noted_on).slice(0, 10),
    run: inputs.run,
  };
}

async function invokeMessage(error: unknown): Promise<string> {
  const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return body.error;
    } catch {
      /* The function body was not JSON. */
    }
  }
  return "The plan could not be built. No orders were stored.";
}
