import { useState } from "react";
import { DEFAULT_GROK_MODEL, loadLlmSettings, resolveModel, saveLlmSettings } from "../lib/llm";

export function KeySettings() {
  const stored = loadLlmSettings(typeof localStorage === "undefined" ? null : localStorage);
  const [apiKey, setApiKey] = useState(stored.apiKey);
  const [model, setModel] = useState(stored.model);
  const [note, setNote] = useState<string | null>(stored.apiKey ? "A key is already stored in this browser." : null);

  return (
    <form
      className="setup key-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const nextModel = resolveModel(model);
          saveLlmSettings(localStorage, { apiKey, model: nextModel });
          setModel(nextModel);
          setNote(apiKey.trim() ? "Saved in this browser only. It is not in an export." : "Key removed from this browser.");
        } catch (caught) {
          setNote(caught instanceof Error ? caught.message : "The model id was refused.");
        }
      }}
    >
      <div className="span-2">
        <p className="kicker">xAI · Grok</p>
        <h3>Your key</h3>
        <p className="lede">
          Create an account at console.x.ai, add credits, then create a key on the API Keys page. Paste it here. The default model is {DEFAULT_GROK_MODEL}, the current chat model in xAI’s docs. Change the model id if you want another Grok.
        </p>
        <p className="funding">
          The key is stored only in this browser under rsi.llm. Desk export does not include it. It is sent only to https://api.x.ai when you ask. Anyone who can open this browser profile can read it. Do not use a shared computer. Revoke the key at console.x.ai if it leaks.
          api.x.ai currently answers browser preflight with Access-Control-Allow-Origin, so no proxy is required. If that stops, run a proxy under your own account that forwards the request and does not log the key. This site will not add a shared backend.
        </p>
      </div>
      <label>
        xAI API key
        <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="xai-…" />
      </label>
      <label>
        Model id
        <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={DEFAULT_GROK_MODEL} />
      </label>
      <div className="row-actions">
        <button type="submit" className="primary">Save key</button>
        <button
          type="button"
          onClick={() => {
            setApiKey("");
            saveLlmSettings(localStorage, { apiKey: "", model });
            setNote("Key removed from this browser.");
          }}
        >
          Remove key
        </button>
      </div>
      {note ? <p className="funding">{note}</p> : null}
    </form>
  );
}
