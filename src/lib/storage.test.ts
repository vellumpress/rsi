import { describe, expect, it } from "vitest";
import { defaultThresholds } from "./rulebook";
import { defaultState, importState, normalizeState, readDesk, serializeState } from "./storage";

function memory(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    data,
    getItem(key: string) {
      return key in data ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe("persistence", () => {
  it("round-trips a desk and rejects a file that is not one", () => {
    const state = defaultState("2026-10-02");
    state.theses = [];
    const again = normalizeState(JSON.parse(serializeState(state)), "2026-10-02");
    expect(again.version).toBe(2);
    expect(again.settings).toEqual(state.settings);
    expect(again.rulebook.thresholds.trimFraction).toBe(0.2);
    expect(() => normalizeState([])).toThrow(/RSI file/);
    expect(() => normalizeState({ version: 9, settings: state.settings })).toThrow(/unsupported/);
  });

  it("migrates an alpha-desk v1 payload and keeps a backup", () => {
    const legacy = {
      version: 1,
      settings: { capital: 100_000, startDate: "2026-10-02", themeCount: 3, coreTicker: "SPY" },
      theses: [
        {
          id: "soft",
          ticker: "IGV",
          milestones: [],
          theme: "Software",
        },
      ],
      trades: [],
      reviews: {},
      briefs: [],
      benchmarkAnchor: {},
    };
    const store = memory({ "alpha-desk.v1": JSON.stringify(legacy) });
    const desk = readDesk(store, "2026-10-02");
    expect(desk.version).toBe(2);
    expect(desk.theses[0].stage).toBe("thesis");
    expect(desk.rulebook.version).toBe("1.0");
    expect(store.data["rsi.backup"]).toContain("\"version\":1");
    expect(store.data["rsi.v2"]).toContain("\"version\":2");
  });

  it("backs up the live desk before an import and refuses unsafe money", () => {
    const current = defaultState("2026-10-02");
    const store = memory({ "rsi.v2": serializeState(current) });
    const incoming = defaultState("2026-01-01");
    incoming.settings.capital = 50_000;
    const next = importState(serializeState(incoming), store, "2026-10-02");
    expect(next.settings.capital).toBe(50_000);
    expect(JSON.parse(store.data["rsi.backup"]).settings.capital).toBe(100_000);
    expect(store.getItem("rsi.v2")).toContain("50000");

    const bent = defaultState("2026-10-02");
    bent.rulebook.thresholds.positionCap = 0.5;
    bent.rulebook.thresholds.trimFraction = 0.25;
    const sanitized = normalizeState(JSON.parse(serializeState(bent)));
    expect(sanitized.rulebook.thresholds.positionCap).toBe(defaultThresholds().positionCap);
    expect(sanitized.rulebook.thresholds.trimFraction).toBe(0.25);

    const bad = defaultState("2026-10-02");
    bad.settings.capital = -1;
    expect(() => normalizeState(JSON.parse(JSON.stringify(bad)))).toThrow(/capital/i);
  });
});
