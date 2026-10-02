import { useState } from "react";
import { answerLocally, chatSystemPrompt, commitScreened, extractProposal, factsFromActions, screenProposal, type ChatFacts, type Screened } from "../lib/chat";
import { classifyInstrument } from "../lib/instruments";
import { reviewManualTrade } from "../lib/guards";
import { completeGrok, loadLlmSettings } from "../lib/llm";
import { moneyAuto } from "../lib/money";
import { useDesk } from "../state";
import { GenerateThesis } from "./GenerateThesis";

interface Bubble {
  role: "user" | "assistant";
  text: string;
  screen?: Screened;
}

export function ChatPanel() {
  const desk = useDesk();
  const [text, setText] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const facts = buildFacts(desk);

  const ask = async () => {
    const question = text.trim();
    if (!question || busy) return;
    setText("");
    setNotice(null);
    const local = answerLocally(question, facts);
    const settings = loadLlmSettings(typeof localStorage === "undefined" ? null : localStorage);
    if (!settings.apiKey) {
      const help = local ?? "Add an xAI API key in Settings to talk to Grok. Until then I can answer from the desk: what should I do today, what is the book worth, which rule fired, and how the benchmarks compare. Not financial advice.";
      setBubbles((current) => [...current, { role: "user", text: question }, { role: "assistant", text: help }]);
      return;
    }
    setBubbles((current) => [...current, { role: "user", text: question }]);
    setBusy(true);
    try {
      const reply = await completeGrok({
        apiKey: settings.apiKey,
        model: settings.model,
        messages: [
          { role: "system", content: chatSystemPrompt(facts) },
          ...bubbles.slice(-6).map((bubble) => ({ role: bubble.role, content: bubble.text })),
          { role: "user", content: question },
        ],
      });
      const raw = extractProposal(reply);
      const screen = raw ? screenProposal(raw, facts) : undefined;
      const visible = reply.replace(/```proposal[\s\S]*?```/i, "").replace(/```json[\s\S]*?```/i, "").trim();
      setBubbles((current) => [...current, { role: "assistant", text: visible || screen?.reason || "No reply.", screen }]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Grok did not answer.";
      setBubbles((current) => [...current, { role: "assistant", text: local ? `${message}\n${local}` : message }]);
    } finally {
      setBusy(false);
    }
  };

  const confirm = (screen: Screened) => {
    const write = commitScreened(screen, true);
    if (!write || write.kind !== "trade") {
      setNotice("Nothing was written.");
      return;
    }
    const quote = desk.prices?.quotes[write.ticker];
    const thesis = desk.state.theses.find((item) => item.ticker.toUpperCase() === write.ticker && !item.archived);
    if (write.sleeve === "conviction" && !thesis) {
      setNotice("A conviction trade needs a thesis card. Generate or start one first. Nothing was written.");
      return;
    }
    if (write.side === "buy" && write.sleeve === "core" && !desk.state.settings.coreTickers.includes(write.ticker)) {
      setNotice("Add the stock to the core basket in Settings before a core buy. Nothing was written.");
      return;
    }
    const lot = desk.derived.lots.find((item) => (write.sleeve === "core" ? item.id === `core:${write.ticker}` : item.thesisId === thesis?.id));
    const review = reviewManualTrade({
      side: write.side,
      dollars: write.dollars,
      price: write.price,
      sleeve: write.sleeve,
      tranche: write.side === "buy" ? 1 : null,
      heldShares: lot?.shares ?? 0,
      missedMilestones: thesis?.milestones.filter((milestone) => milestone.status === "missed").length ?? 0,
      killHit: thesis?.killHit ?? false,
      exitReason: "trim",
      fromEngine: false,
      alreadyDeployed: lot?.tranche1 === true,
      marketValue: 0,
      bookValue: desk.derived.marks.bookValue,
      cash: desk.derived.buckets.dryPowder,
      instrument: classifyInstrument({ ticker: write.ticker, instrumentType: quote?.instrumentType, quoteType: quote?.quoteType }),
    });
    if (!review.ok) {
      setNotice(review.reason);
      return;
    }
    desk.addTrade({
      date: desk.today,
      ticker: write.ticker,
      side: write.side,
      dollars: review.dollars,
      shares: review.shares,
      price: write.price,
      sleeve: write.sleeve,
      thesisId: write.sleeve === "conviction" ? thesis?.id : undefined,
      tranche: write.side === "buy" ? 1 : undefined,
      note: write.note,
    });
    setNotice(`Recorded ${write.side} of ${write.ticker} for ${moneyAuto(review.dollars)} after you confirmed. Not financial advice.`);
  };

  return (
    <section className="chat" aria-labelledby="chat-title">
      <div className="panel-mark" aria-hidden="true"><span className="shape circle" /></div>
      <p className="kicker">Ask the desk</p>
      <h2 id="chat-title">Chat</h2>
      <p className="lede">Grok can explain the book and propose a trade or a thesis. It cannot write the ledger, approve a card, or bend a rule until you confirm. Not financial advice.</p>
      <div className="transcript" aria-live="polite">
        {bubbles.length === 0 ? <p className="empty">Try “what should I do today?” It answers from this desk even with no key.</p> : null}
        {bubbles.map((bubble, index) => (
          <article key={`${bubble.role}-${index}`} className={`bubble ${bubble.role}`}>
            <p className="kicker">{bubble.role === "user" ? "You" : "Desk"}</p>
            <p>{bubble.text}</p>
            {bubble.screen ? (
              <div className="proposal">
                <p>{bubble.screen.reason}</p>
                {bubble.screen.ok && bubble.screen.proposal.kind === "trade" ? (
                  <button type="button" className="primary" onClick={() => confirm(bubble.screen as Screened)}>Confirm and record</button>
                ) : null}
                {bubble.screen.ok && bubble.screen.proposal.kind === "generate-thesis" ? (
                  <button type="button" onClick={() => setShowGenerator(true)}>Open the generator</button>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {notice ? <p className="funding">{notice}</p> : null}
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label>
          Message
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="What should I do today?" />
        </label>
        <button type="submit" className="primary" disabled={busy}>{busy ? "Asking…" : "Send"}</button>
        <button type="button" onClick={() => setShowGenerator((open) => !open)}>Generate thesis</button>
      </form>
      {showGenerator ? <GenerateThesis /> : null}
    </section>
  );
}

function buildFacts(desk: ReturnType<typeof useDesk>): ChatFacts {
  const { brief, performance, buckets, alloc } = desk.derived;
  const actions = [...brief.schedule, ...brief.engine.filter((action) => action.side !== "hold"), ...brief.reminders];
  const tickers = new Set<string>([...actions.map((action) => action.ticker), "SPY", "QQQ", ...desk.state.settings.coreTickers]);
  return factsFromActions(actions, {
    today: desk.today,
    fridaySweep: brief.fridaySweep,
    bookValue: brief.bookValue,
    peak: brief.peak,
    drawdown: brief.drawdown,
    cash: buckets.totalCash,
    spyReturn: performance.spyReturn,
    qqqReturn: performance.qqqReturn,
    bookReturn: performance.bookReturn,
    ruleEditsLocked: desk.derived.brief.bookValue != null && desk.derived.brief.peak != null ? (desk.derived.brief.peak - (desk.derived.brief.bookValue ?? 0)) / desk.derived.brief.peak >= 0.1 : true,
    prices: [...tickers].filter((ticker) => ticker && ticker !== "DESK" && ticker !== "CORE").map((ticker) => {
      const quote = desk.prices?.quotes[ticker];
      return {
        ticker,
        price: quote?.price ?? null,
        instrument: classifyInstrument({ ticker, instrumentType: quote?.instrumentType, quoteType: quote?.quoteType }),
      };
    }),
    theses: desk.state.theses.filter((thesis) => !thesis.archived).map((thesis) => ({ ticker: thesis.ticker, theme: thesis.theme, stage: thesis.stage })),
    positionCap: alloc.positionCap,
  });
}
