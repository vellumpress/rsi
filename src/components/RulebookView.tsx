import { useState } from "react";
import { elapsedQuarters, prettyDate, quarterKey } from "../lib/dates";
import { metaRuleVerdict, ruleEditsLocked, type EditableParameter } from "../lib/rulebook";
import { useDesk } from "../state";

const FIELDS: { id: EditableParameter; label: string; min: number; max: number }[] = [
  { id: "trimFraction", label: "Trim fraction (0.20–0.25)", min: 0.2, max: 0.25 },
  { id: "greedAboveSma", label: "Greed above the 200-day average (0.40–0.75)", min: 0.4, max: 0.75 },
  { id: "fearBelowHigh", label: "Fear below the 52-week high (0.20–0.40)", min: 0.2, max: 0.4 },
  { id: "topDecile", label: "Top decile percentile (85–95)", min: 85, max: 95 },
  { id: "bottomQuartile", label: "Bottom quartile percentile (15–30)", min: 15, max: 30 },
];

/** Playbook p.2 step 7 and p.1 rules 03 and 04. One edit a quarter. None during a drawdown. */
export function RulebookView() {
  const desk = useDesk();
  const book = desk.state.rulebook;
  const lock = ruleEditsLocked(desk.derived.marks.bookValue, desk.derived.nextPeak);
  const quarters = elapsedQuarters(desk.state.settings.startDate, desk.today);
  const verdict = metaRuleVerdict(desk.derived.performance.convictionReturn, desk.derived.performance.qqqReturn, quarters);
  const [parameter, setParameter] = useState<EditableParameter>("trimFraction");
  const [next, setNext] = useState(String(book.thresholds.trimFraction));
  const [evidence, setEvidence] = useState("");
  const [message, setMessage] = useState<string | null>(lock.locked ? lock.reason : null);
  const [cycleEvidence, setCycleEvidence] = useState("");

  return (
    <section className="sheet">
      <header className="sheet-head">
        <p className="kicker">Rulebook {book.version}</p>
        <h2>One change a quarter</h2>
        <p className="lede">
          Adopted {prettyDate(book.adoptedOn)}. Cycle {book.cycle}. The engine reads these thresholds on the next run. The 15% cap, the 20% overweight line, and the 30% circuit breaker do not bend. Rule edits lock when the marked book is down 10% or more from its peak, and when the mark is incomplete. A smaller dip does not lock them: locking on any print under the high would freeze the rulebook almost every day.
        </p>
      </header>
      <dl className="stats">
        <div><dt>Trim</dt><dd>{book.thresholds.trimFraction}</dd></div>
        <div><dt>Greed</dt><dd>{book.thresholds.greedAboveSma}</dd></div>
        <div><dt>Fear</dt><dd>{book.thresholds.fearBelowHigh}</dd></div>
        <div><dt>Top / bottom</dt><dd>{book.thresholds.topDecile} / {book.thresholds.bottomQuartile}</dd></div>
      </dl>
      {lock.locked ? <p className="warn">{lock.reason}</p> : <p className="funding">This quarter is {quarterKey(desk.today)}. A second edit this quarter is refused.</p>}
      <form
        className="setup"
        onSubmit={(event) => {
          event.preventDefault();
          const reason = desk.changeRule({ parameter, next: Number(next), evidence });
          setMessage(reason ?? "Saved. The next engine run reads this threshold. The version on this page is the one the engine will use.");
        }}
      >
        <label>
          Parameter
          <select
            value={parameter}
            onChange={(event) => {
              const id = event.target.value as EditableParameter;
              setParameter(id);
              setNext(String(book.thresholds[id]));
            }}
          >
            {FIELDS.map((field) => (
              <option key={field.id} value={field.id}>{field.label}</option>
            ))}
          </select>
        </label>
        <label>
          New value
          <input inputMode="decimal" value={next} onChange={(event) => setNext(event.target.value)} />
        </label>
        <label>
          Evidence
          <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={lock.locked}>Propose the change</button>
      </form>
      {message ? <p className="funding">{message}</p> : null}

      <h3>Meta-rule · p.1 rule 04</h3>
      <p>{verdict.reason}</p>
      {verdict.shrink ? (
        <form
          className="setup"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = desk.cycleRulebook(cycleEvidence);
            setMessage(reason ?? "The sleeve is flagged to shrink into the core stock basket. Record the sells, then deploy that cash in equal weight across the core names. Do not buy an index. The rulebook cycled a major version. That cycle is not a threshold edit.");
          }}
        >
          <label>
            Evidence for shrinking the sleeve
            <textarea value={cycleEvidence} onChange={(event) => setCycleEvidence(event.target.value)} />
          </label>
          <button type="submit" className="primary">Shrink the sleeve and cycle the rulebook</button>
        </form>
      ) : null}

      <h3>Changelog</h3>
      {book.changelog.length === 0 ? <p className="empty">No rule has been changed. This is v1.0, trim 20%.</p> : null}
      <ul>
        {book.changelog.map((change) => (
          <li key={change.id}>
            {prettyDate(change.date)} · {change.fromVersion} → {change.toVersion} · {change.parameter} {change.previous} → {change.next}. {change.evidence}
          </li>
        ))}
      </ul>
    </section>
  );
}
