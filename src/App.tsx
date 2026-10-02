import { AuthGate } from "./components/AuthGate";
import { PlanScreen } from "./components/PlanScreen";

export function App() {
  return (
    <AuthGate>
      {(session) => (
        <>
          <a className="skip" href="#main">Skip to the plan</a>
          <header className="mast">
            <p className="brand">RSI</p>
            <div>
              <p className="account">{session.email}</p>
              <button type="button" onClick={() => void session.signOut()}>Sign out</button>
            </div>
          </header>
          <p className="disclaimer" role="note">
            <strong>Not financial advice.</strong> Individual stocks and cash only. No index, no ETF, no T-bill. SPY and QQQ are never a buy or a sell. RSI does not place a trade.
          </p>
          <main id="main">
            <PlanScreen userId={session.userId} />
          </main>
        </>
      )}
    </AuthGate>
  );
}
