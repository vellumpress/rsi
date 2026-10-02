import { BriefView } from "./components/BriefView";
import { EngineRoom } from "./components/EngineRoom";
import { CapitalView } from "./components/CapitalView";
import { FooterBar } from "./components/FooterBar";
import { GenerateThesis } from "./components/GenerateThesis";
import { HistoryView } from "./components/HistoryView";
import { HomeView } from "./components/HomeView";
import { AuthGate } from "./components/AuthGate";
import { LedgerView } from "./components/LedgerView";
import { LoopView } from "./components/LoopView";
import { RulebookView } from "./components/RulebookView";
import { ThesisBoard } from "./components/ThesisBoard";
import { prettyDate } from "./lib/dates";
import { DeskProvider, useDesk, type Tab } from "./state";

const NAV: { id: Tab; label: string }[] = [
  { id: "brief", label: "Now" },
  { id: "loop", label: "Research" },
  { id: "ledger", label: "Portfolio" },
  { id: "engine", label: "Engine" },
  { id: "rulebook", label: "Rules" },
  { id: "capital", label: "Settings" },
];

export function App() {
  return (
    <AuthGate>
      {(session) => (
        <DeskProvider>
          <Shell email={session.email} onSignOut={session.signOut} />
        </DeskProvider>
      )}
    </AuthGate>
  );
}

function Shell({ email, onSignOut }: { email: string; onSignOut: () => Promise<void> }) {
  const desk = useDesk();
  return (
    <>
      <a className="skip" href="#main">Skip to the desk</a>
      <header className="mast">
        <p className="brand">RSI</p>
        <div>
          <p className="account">{email}</p>
          <p className="issue">{prettyDate(desk.today)}</p>
        </div>
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
            <section className="panel">
              <p className="kicker">Account</p>
              <h3>Signed in</h3>
              <p className="lede">Grok runs on the RSI server as grok-4.7. This browser keeps the sign-in session and does not hold an xAI key.</p>
              <button type="button" onClick={() => void onSignOut()}>Sign out</button>
            </section>
            <CapitalView />
            <FooterBar />
          </>
        ) : null}
        {desk.tab === "theses" ? <ThesisBoard /> : null}
        {desk.tab === "ledger" ? <LedgerView /> : null}
        {desk.tab === "engine" ? <EngineRoom /> : null}
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
