import { useState } from "react";
import { useDesk } from "../state";

export function FooterBar() {
  const desk = useDesk();
  const [importError, setImportError] = useState<string | null>(null);

  return (
    <footer className="desk-foot">
      <p>{desk.priceNote}</p>
      <div className="row-actions">
        <button type="button" onClick={() => void desk.refreshPrices()} disabled={desk.refreshing}>
          {desk.refreshing ? "Refreshing…" : "Refresh live prices"}
        </button>
        <button type="button" onClick={desk.exportJson}>Export JSON</button>
        <label className="file">
          Import JSON
          <input
            type="file"
            accept="application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const message = desk.importJson(await file.text());
              setImportError(message);
            }}
          />
        </label>
        {desk.notificationPermission === "unsupported" ? (
          <span>Notifications are not available in this browser.</span>
        ) : desk.notificationPermission === "granted" ? (
          <span>Notifications on. They fire when you open the desk, not from a server.</span>
        ) : (
          <button type="button" onClick={() => void desk.enableNotifications()}>
            Enable notifications
          </button>
        )}
        {desk.canInstall ? (
          <button type="button" onClick={() => void desk.promptInstall()}>
            Install app
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Erase this desk from the browser? Export first if you want the cards.")) desk.reset();
          }}
        >
          Reset desk
        </button>
      </div>
      {importError ? <p className="warn">{importError}</p> : null}
      <p className="fine">Not financial advice. A template to adapt. Your cards, trades, and briefs stay in this browser until you export them.</p>
    </footer>
  );
}
