import { useState } from "react";
import { DEFAULT_GROK_MODEL, loadLlmSettings, resolveModel, saveLlmSettings, type GrokMode } from "../lib/llm";

export function KeySettings() {
  const stored = loadLlmSettings(typeof localStorage === "undefined" ? null : localStorage);
  const [mode, setMode] = useState<GrokMode>(stored.mode);
  const [apiKey, setApiKey] = useState(stored.apiKey);
  const [passcode, setPasscode] = useState(stored.passcode);
  const [model, setModel] = useState(stored.model);
  const [note, setNote] = useState<string | null>(stored.passcode || stored.apiKey ? "A connection is already stored in this browser." : null);

  const persist = (next: { mode: GrokMode; apiKey: string; passcode: string; model: string }) => {
    const nextModel = resolveModel(next.model);
    saveLlmSettings(localStorage, { ...next, model: nextModel });
    setModel(nextModel);
    const kept = next.mode === "key" ? next.apiKey.trim() : next.passcode.trim();
    setNote(kept ? "Saved in this browser only. It is not in an export and it is not written to the log." : "Connection removed from this browser.");
  };

  return (
    <form
      className="setup key-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          persist({ mode, apiKey, passcode, model });
        } catch (caught) {
          setNote(caught instanceof Error ? caught.message : "The model id was refused.");
        }
      }}
    >
      <div className="span-2">
        <p className="kicker">Grok</p>
        <h3>Connection</h3>
        <p className="lede">
          RSI server is the default. It takes a passcode, not an xAI key. The model stays {DEFAULT_GROK_MODEL} unless you change it. That is the most capable chat model in the current xAI docs.
        </p>
      </div>
      <label>
        Connection
        <select value={mode} onChange={(event) => setMode(event.target.value as GrokMode)}>
          <option value="server">RSI server (passcode)</option>
          <option value="key">My own xAI key</option>
        </select>
      </label>
      <label>
        Model id
        <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={DEFAULT_GROK_MODEL} />
      </label>
      {mode === "server" ? (
        <label className="span-2">
          RSI server passcode
          <input type="password" autoComplete="off" value={passcode} onChange={(event) => setPasscode(event.target.value)} />
        </label>
      ) : (
        <label className="span-2">
          xAI API key
          <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="xai-…" />
        </label>
      )}
      <p className="funding">
        {mode === "server"
          ? "The passcode stays in this browser under rsi.llm. Desk export does not include it. It is sent only as a header to the RSI server, and only when you ask. It is not written to the log. The server accepts the published site. A wrong passcode or a rate limit is shown in the chat and does not change the ledger."
          : "The key stays in this browser under rsi.llm. Desk export does not include it. It is sent only to https://api.x.ai when you ask. Create one at console.x.ai. Anyone who can open this browser profile can read it."}
      </p>
      <div className="row-actions">
        <button type="submit" className="primary">Save connection</button>
        <button
          type="button"
          onClick={() => {
            const cleared = mode === "server" ? { mode, apiKey, passcode: "", model } : { mode, apiKey: "", passcode, model };
            if (mode === "server") setPasscode("");
            else setApiKey("");
            try {
              persist(cleared);
            } catch (caught) {
              setNote(caught instanceof Error ? caught.message : "The model id was refused.");
            }
          }}
        >
          Remove {mode === "server" ? "passcode" : "key"}
        </button>
      </div>
      {note ? <p className="funding">{note}</p> : null}
    </form>
  );
}
