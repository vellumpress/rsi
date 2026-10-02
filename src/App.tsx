import { BriefView } from "./components/BriefView";
import { CapitalView } from "./components/CapitalView";
import { FooterBar } from "./components/FooterBar";
import { GenerateThesis } from "./components/GenerateThesis";
import { HistoryView } from "./components/HistoryView";
import { HomeView } from "./components/HomeView";
import { KeySettings } from "./components/KeySettings";
import { LedgerView } from "./components/LedgerView";
import { LoopView } from "./components/LoopView";
import { RulebookView } from "./components/RulebookView";
import { ThesisBoard } from "./components/ThesisBoard";
import { prettyDate } from "./lib/dates";
import { DeskProvider, useDesk, type Tab } from "./state";

const NAV: { id: Tab; label: string }[] = [
  { id: "brief", label: "Now" },
  { id: "loop", label: "Research" },
  { id: "ledger", label: "Ledger" },
  { id: "rulebook", label: "Rules" },
  { id: "capital", label: "Settings" },
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
        <p className="brand">RSI</p>
        <p className="issue">{prettyDate(desk.today)}</p>
      </header>
      <p className="disclaimer" role="note">
        <strong>Not financial advice.</strong> Individual stocks and cash only. No index, no ETF, no T-bill. SPY and QQQ are never a buy or a sell. RSI does not place a trade.
      </p>
      <nav className="nav" aria-label="Desk">
        {NAV.map((tab) => (
          <button key={tab.id} type="button" aria-current={desk.tab === tab.id ? "page" : undefined} onClick={() => desk.setTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main id="main">
        {desk.tab === "brief" ? <HomeView /> : null}
        {desk.tab === "check" ? <BriefView /> : null}
        {desk.tab === "loop" ? (
          <>
            <GenerateThesis />
            <LoopView />
          </>
        ) : null}
        {desk.tab === "capital" ? (
          <>
            <KeySettings />
            <CapitalView />
            <FooterBar />
          </>
        ) : null}
        {desk.tab === "theses" ? <ThesisBoard /> : null}
        {desk.tab === "ledger" ? <LedgerView /> : null}
        {desk.tab === "rulebook" ? (
          <>
            <RulebookView />
            <HistoryView />
          </>
        ) : null}
        {desk.tab === "history" ? <HistoryView /> : null}
      </main>
    </>
  );
}
