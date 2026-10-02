import { useState } from "react";
import { themeTarget } from "../lib/allocation";
import { prettyDate } from "../lib/dates";
import { uid } from "../lib/id";
import { moneyAuto } from "../lib/money";
import { emptyLoop } from "../lib/thesis";
import { useDesk } from "../state";
import type { Milestone, MilestoneStatus, MonthlyLogEntry, Thesis } from "../types";

export function ThesisBoard() {
  const desk = useDesk();
  const [editing, setEditing] = useState<string | null>(null);
  const active = desk.state.theses.filter((thesis) => !thesis.archived);
  const archived = desk.state.theses.filter((thesis) => thesis.archived);

  return (
    <section className="sheet">
      <header className="sheet-head">
        <p className="kicker">04 · Thesis cards</p>
        <h2>One card per theme</h2>
        <p className="lede">Finish the card before the first buy. The desk scores against it every month. Valuation percentile is entered by you. The engine will not guess it.</p>
      </header>
      <div className="row-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            const thesis = blankThesis(desk.today);
            desk.saveThesis(thesis);
            setEditing(thesis.id);
          }}
        >
          New thesis
        </button>
        <button type="button" onClick={() => desk.addExampleThesis()}>
          Load an illustration
        </button>
      </div>
      {active.length === 0 ? <p className="empty">No open themes. Week 0 will deploy the core only until a card is approved.</p> : null}
      {desk.state.theses.map((thesis) => (
        <ThesisCard key={thesis.id} thesis={thesis} editing={editing === thesis.id} onEdit={() => setEditing(thesis.id)} onClose={() => setEditing(null)} />
      ))}
      {archived.length > 0 ? <p className="funding">{archived.length} archived. Unused thirds have been released back into the conviction sleeve.</p> : null}
    </section>
  );
}

function ThesisCard({ thesis, editing, onEdit, onClose }: { thesis: Thesis; editing: boolean; onEdit: () => void; onClose: () => void }) {
  const desk = useDesk();
  const target = themeTarget(desk.derived.alloc, thesis);
  if (editing) return <ThesisForm initial={thesis} onClose={onClose} />;

  return (
    <article className={`thesis ${thesis.archived ? "archived" : ""}`}>
      <header className="thesis-top">
        <div>
          <p className="kicker">Theme / ticker</p>
          <h3>{thesis.theme || "Untitled"}</h3>
          <p className="ticker-lg">{thesis.ticker || "—"}</p>
        </div>
        <p className="meta">
          {prettyDate(thesis.openedOn)} · v{thesis.version}
          {thesis.archived ? " · archived" : ""}
        </p>
      </header>
      <div className="thesis-grid">
        <div>
          <Field label="What the market believes" text={thesis.marketBelief} />
          <Field label="What we believe" text={thesis.ourBelief} />
          <Field label="Why the market is wrong" text={thesis.whyWrong} />
          <Field label="Kill condition" text={thesis.killCondition} />
          {thesis.killHit ? <p className="warn">Kill condition marked hit. The engine will exit, or refuse the entry.</p> : null}
        </div>
        <div>
          <p className="kicker">Milestones · dated · reported numbers</p>
          <ol className="milestones">
            {thesis.milestones.map((milestone, index) => (
              <li key={milestone.id}>
                <span className={`pill ${milestone.status}`}>M{index + 1} {milestone.status}</span>
                <strong>{milestone.metric}</strong>
                <span>{milestone.target}</span>
                <span>by {milestone.byDate ? prettyDate(milestone.byDate) : "—"}</span>
              </li>
            ))}
          </ol>
          <p className="kicker">Valuation band · its own history</p>
          <p>{thesis.valuationMetric || "Metric not set"}</p>
          <p>Add below {thesis.addBelow || "—"} · Trim above {thesis.trimAbove || "—"}</p>
          <p>Percentile {thesis.valuationPercentile == null ? "not entered" : thesis.valuationPercentile}</p>
          <Field label="Bear case" text={thesis.bearCase} />
          <p className="kicker">Sizing</p>
          <p>
            Target {moneyAuto(target)} · tranche {moneyAuto(target / 3)} · P(thesis) {thesis.probability == null ? "—" : `${thesis.probability}%`} · {thesis.benchmark}
          </p>
        </div>
      </div>
      {thesis.log.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>P(thesis)</th>
                <th>Price vs band</th>
                <th>Engine</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {thesis.log.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.month}</td>
                  <td>{entry.probability == null ? "—" : `${entry.probability}%`}</td>
                  <td>{entry.priceVsBand || "—"}</td>
                  <td>{entry.engineAction || "—"}</td>
                  <td>{entry.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!thesis.archived ? (
        <div className="row-actions">
          <button type="button" className="primary" onClick={onEdit}>Edit card</button>
          <button
            type="button"
            onClick={() => {
              if (desk.state.trades.some((trade) => trade.thesisId === thesis.id)) desk.archiveThesis(thesis.id);
              else if (window.confirm("Delete this card? It has no trades.")) desk.deleteThesis(thesis.id);
            }}
          >
            {desk.state.trades.some((trade) => trade.thesisId === thesis.id) ? "Archive" : "Delete"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <p>
      <span className="kicker">{label}</span>
      <span className="prose">{text || "—"}</span>
    </p>
  );
}

function ThesisForm({ initial, onClose }: { initial: Thesis; onClose: () => void }) {
  const desk = useDesk();
  const [draft, setDraft] = useState<Thesis>(ensureThree(initial));
  const [error, setError] = useState<string | null>(null);
  const [logNote, setLogNote] = useState("");
  const cap = desk.derived.alloc.positionCap;

  const save = () => {
    const next = {
      ...draft,
      ticker: draft.ticker.trim().toUpperCase(),
      theme: draft.theme.trim(),
    };
    const problem = validate(next);
    if (problem) {
      setError(problem);
      return;
    }
    desk.saveThesis(next);
    onClose();
  };

  const setMilestone = (index: number, patch: Partial<Milestone>) => {
    setDraft((current) => ({
      ...current,
      milestones: current.milestones.map((milestone, i) => (i === index ? { ...milestone, ...patch } : milestone)),
    }));
  };

  return (
    <form
      className="thesis editing"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="split">
        <label>
          Theme
          <input value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value })} />
        </label>
        <label>
          Ticker
          <input value={draft.ticker} onChange={(event) => setDraft({ ...draft, ticker: event.target.value.toUpperCase() })} />
        </label>
        <label>
          Date opened
          <input type="date" value={draft.openedOn} onChange={(event) => setDraft({ ...draft, openedOn: event.target.value })} />
        </label>
        <label>
          Version
          <input type="number" min={1} value={draft.version} onChange={(event) => setDraft({ ...draft, version: Number(event.target.value) || 1 })} />
        </label>
      </div>
      <label>
        What the market believes
        <textarea rows={3} value={draft.marketBelief} onChange={(event) => setDraft({ ...draft, marketBelief: event.target.value })} />
      </label>
      <label>
        What we believe
        <textarea rows={3} value={draft.ourBelief} onChange={(event) => setDraft({ ...draft, ourBelief: event.target.value })} />
      </label>
      <label>
        Why the market is wrong
        <textarea rows={3} value={draft.whyWrong} onChange={(event) => setDraft({ ...draft, whyWrong: event.target.value })} />
      </label>
      <label>
        Kill condition
        <textarea rows={2} value={draft.killCondition} onChange={(event) => setDraft({ ...draft, killCondition: event.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.killHit} onChange={(event) => setDraft({ ...draft, killHit: event.target.checked })} />
        Kill condition has been hit
      </label>
      <p className="kicker">Three milestones</p>
      {draft.milestones.map((milestone, index) => (
        <fieldset key={milestone.id} className="milestone-edit">
          <legend>M{index + 1}</legend>
          <label>
            Metric
            <input value={milestone.metric} onChange={(event) => setMilestone(index, { metric: event.target.value })} />
          </label>
          <label>
            Target
            <input value={milestone.target} onChange={(event) => setMilestone(index, { target: event.target.value })} />
          </label>
          <label>
            By
            <input type="date" value={milestone.byDate} onChange={(event) => setMilestone(index, { byDate: event.target.value })} />
          </label>
          <div className="pills">
            {(["pending", "hit", "missed"] as MilestoneStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                className={milestone.status === status ? "pill on" : "pill"}
                onClick={() =>
                  setMilestone(index, {
                    status,
                    resolvedOn: status === "pending" ? null : milestone.resolvedOn || desk.today,
                  })
                }
              >
                {status}
              </button>
            ))}
          </div>
          {milestone.status !== "pending" ? (
            <label>
              Resolved on
              <input type="date" value={milestone.resolvedOn ?? ""} onChange={(event) => setMilestone(index, { resolvedOn: event.target.value })} />
            </label>
          ) : null}
          {milestone.status === "hit" ? <p className="funding">Mark hit only on reported numbers, not guidance.</p> : null}
        </fieldset>
      ))}
      <div className="split">
        <label>
          Valuation metric
          <input value={draft.valuationMetric} onChange={(event) => setDraft({ ...draft, valuationMetric: event.target.value })} />
        </label>
        <label>
          Add below
          <input value={draft.addBelow} onChange={(event) => setDraft({ ...draft, addBelow: event.target.value })} />
        </label>
        <label>
          Trim above
          <input value={draft.trimAbove} onChange={(event) => setDraft({ ...draft, trimAbove: event.target.value })} />
        </label>
        <label>
          Valuation percentile (0–100)
          <input
            inputMode="decimal"
            placeholder="Blank if you have not scored it"
            value={draft.valuationPercentile ?? ""}
            onChange={(event) => {
              const raw = event.target.value.trim();
              setDraft({ ...draft, valuationPercentile: raw === "" ? null : Number(raw) });
            }}
          />
        </label>
      </div>
      <label>
        Bear case
        <textarea rows={3} value={draft.bearCase} onChange={(event) => setDraft({ ...draft, bearCase: event.target.value })} />
      </label>
      <div className="split">
        <label className="check">
          <input
            type="checkbox"
            checked={draft.targetMode === "custom"}
            onChange={(event) => setDraft({ ...draft, targetMode: event.target.checked ? "custom" : "plan", targetDollars: draft.targetDollars ?? cap })}
          />
          Custom target, capped at {moneyAuto(cap)}
        </label>
        {draft.targetMode === "custom" ? (
          <label>
            Target $
            <input
              inputMode="decimal"
              value={draft.targetDollars ?? ""}
              onChange={(event) => setDraft({ ...draft, targetDollars: Number(event.target.value) })}
            />
          </label>
        ) : (
          <p className="funding">Plan target {moneyAuto(themeTarget(desk.derived.alloc, draft))}.</p>
        )}
        <label>
          P(thesis), 3 years
          <input
            inputMode="decimal"
            value={draft.probability ?? ""}
            onChange={(event) => {
              const raw = event.target.value.trim();
              setDraft({ ...draft, probability: raw === "" ? null : Number(raw) });
            }}
          />
        </label>
        <label>
          Benchmark
          <input value={draft.benchmark} onChange={(event) => setDraft({ ...draft, benchmark: event.target.value.toUpperCase() })} />
        </label>
      </div>
      <fieldset>
        <legend>Monthly log</legend>
        <label>
          Note for {desk.today.slice(0, 7)}
          <input value={logNote} onChange={(event) => setLogNote(event.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => {
            const entry: MonthlyLogEntry = {
              id: uid(),
              month: desk.today.slice(0, 7),
              probability: draft.probability,
              priceVsBand: "",
              engineAction: "",
              note: logNote,
            };
            setDraft({ ...draft, log: [...draft.log, entry] });
            setLogNote("");
          }}
        >
          Add log row
        </button>
      </fieldset>
      {error ? <p className="warn">{error}</p> : null}
      <div className="row-actions">
        <button type="submit" className="primary">Save card</button>
        <button
          type="button"
          onClick={() => {
            if (!desk.state.theses.some((item) => item.id === initial.id && item.theme)) desk.deleteThesis(initial.id);
            onClose();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function blankMilestone(today: string): Milestone {
  return { id: uid(), metric: "", target: "", byDate: today, status: "pending", resolvedOn: null };
}

function blankThesis(today: string): Thesis {
  return {
    id: uid(),
    theme: "",
    ticker: "",
    openedOn: today,
    version: 1,
    marketBelief: "",
    ourBelief: "",
    whyWrong: "",
    killCondition: "",
    killHit: false,
    milestones: [blankMilestone(today), blankMilestone(today), blankMilestone(today)],
    valuationMetric: "",
    addBelow: "",
    trimAbove: "",
    valuationPercentile: null,
    bearCase: "",
    targetMode: "plan",
    targetDollars: null,
    probability: null,
    benchmark: "QQQ",
    archived: false,
    log: [],
    ...emptyLoop("scout"),
  };
}

function ensureThree(thesis: Thesis): Thesis {
  const milestones = thesis.milestones.slice(0, 3);
  while (milestones.length < 3) milestones.push(blankMilestone(thesis.openedOn));
  return { ...thesis, milestones };
}

function validate(thesis: Thesis): string | null {
  if (!thesis.theme.trim()) return "Name the theme.";
  if (!/^[A-Z0-9.-]{1,12}$/.test(thesis.ticker.trim().toUpperCase())) return "Enter a ticker such as IGV or BRK-B.";
  if (!thesis.marketBelief.trim() || !thesis.ourBelief.trim() || !thesis.whyWrong.trim()) {
    return "Write the market belief, your belief, and why the market is wrong.";
  }
  if (!thesis.killCondition.trim()) return "Write the kill condition before the first buy.";
  if (!thesis.bearCase.trim()) return "The Red Team still needs a bear case.";
  for (const [index, milestone] of thesis.milestones.entries()) {
    if (!milestone.metric.trim() || !milestone.target.trim() || !milestone.byDate) {
      return `Milestone ${index + 1} needs a metric, a target, and a date.`;
    }
    if (milestone.status !== "pending" && !milestone.resolvedOn) return `Milestone ${index + 1} needs the date it was hit or missed.`;
  }
  if (thesis.probability != null && (thesis.probability < 0 || thesis.probability > 100 || Number.isNaN(thesis.probability))) {
    return "P(thesis) is a percentage from 0 to 100.";
  }
  if (
    thesis.valuationPercentile != null &&
    (thesis.valuationPercentile < 0 || thesis.valuationPercentile > 100 || Number.isNaN(thesis.valuationPercentile))
  ) {
    return "Valuation percentile is a number from 0 to 100, or blank.";
  }
  return null;
}
