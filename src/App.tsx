import { BriefView } from "./components/BriefView";
import { CapitalView } from "./components/CapitalView";
import { FooterBar } from "./components/FooterBar";
import { HistoryView } from "./components/HistoryView";
import { LedgerView } from "./components/LedgerView";
import { LoopView } from "./components/LoopView";
import { RulebookView } from "./components/RulebookView";
import { ThesisBoard } from "./components/ThesisBoard";
import { prettyDate } from "./lib/dates";
import { DeskProvider, useDesk, type Tab } from "./state";

const TABS: { id: Tab; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "loop", label: "Loop" },
  { id: "capital", label: "Capital" },
  { id: "theses", label: "Theses" },
  { id: "ledger", label: "Ledger" },
  { id: "rulebook", label: "Rulebook" },
  { id: "history", label: "History" },
];

export function App() {
  return (
    <DeskProvider>
      <Shell />
    </DeskProvider>
  );
}

function Shell() {
  const desk = useDesk();
  return (
    <>
      <a className="skip" href="#main">Skip to the desk</a>
      <header className="mast">
        <div className="mast-row">
          <p className="brand">RSI</p>
          <p className="issue">{prettyDate(desk.today)}</p>
        </div>
        <p className="tagline">Recursive Self Investing</p>
        <p className="tagline">Follows the Alpha Desk playbook, with one deliberate change: individual stocks and cash only.</p>
      </header>
      <p className="disclaimer" role="note">
        <strong>Not financial advice.</strong> Verify before trading. RSI never places a trade and never connects to a brokerage.
        The playbook's core index fund and T-bills are not used. Core is a basket of stocks you choose. Idle money is cash. SPY and QQQ are benchmarks and are never a buy or a sell.
      </p>
      <nav className="nav" aria-label="Desk">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" aria-current={desk.tab === tab.id ? "page" : undefined} onClick={() => desk.setTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main id="main">
        {desk.tab === "brief" ? <BriefView /> : null}
        {desk.tab === "loop" ? <LoopView /> : null}
        {desk.tab === "capital" ? <CapitalView /> : null}
        {desk.tab === "theses" ? <ThesisBoard /> : null}
        {desk.tab === "ledger" ? <LedgerView /> : null}
        {desk.tab === "rulebook" ? <RulebookView /> : null}
        {desk.tab === "history" ? <HistoryView /> : null}
      </main>
      <FooterBar />
    </>
  );
}
