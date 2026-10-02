import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { absorbFeedback, classifyFeedback, constraintsFromFeedback, persistFeedback, type UserFeedback } from "./lib/boss";
import { deriveDesk, briefSignature } from "./lib/brief";
import { loadFeedback, saveFeedback } from "./lib/feedbackStore";
import { quarterKey, todayISO } from "./lib/dates";
import { exampleThesis } from "./lib/example";
import { uid } from "./lib/id";
import { describeSnapshot, fetchLiveQuotes, loadPublishedSnapshot, loadSnapshot, mergeBooks } from "./lib/prices";
import { applyMetaRuleCycle, proposeRuleChange } from "./lib/rulebook";
import { safeAllocate } from "./lib/allocation";
import { defaultState, importState, loadState, saveState, serializeState } from "./lib/storage";
import type { BriefAction, DeskState, Postmortem, PriceBook, Scorecard, Settings, Thesis, Trade, TrancheTag } from "./types";

export type Tab = "brief" | "check" | "loop" | "capital" | "theses" | "ledger" | "rulebook" | "history" | "engine";

export interface TradeDraft {
  date: string;
  ticker: string;
  side: "buy" | "sell";
  dollars: string;
  price: string;
  sleeve: "core" | "conviction";
  thesisId: string;
  tranche: "" | "1" | "2" | "3" | "fear";
  note: string;
  fromEngine?: boolean;
  exitReason?: "trim" | "kill" | "meta-rule" | "sentiment";
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

interface DeskApi {
  state: DeskState;
  derived: ReturnType<typeof deriveDesk>;
  prices: PriceBook | null;
  priceNote: string;
  today: string;
  tab: Tab;
  setTab: (tab: Tab) => void;
  refreshing: boolean;
  refreshPrices: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  saveThesis: (thesis: Thesis) => void;
  addExampleThesis: () => void;
  archiveThesis: (id: string) => void;
  deleteThesis: (id: string) => void;
  addTrade: (trade: Omit<Trade, "id">) => string;
  deleteTrade: (id: string) => void;
  undoId: string | null;
  undoTrade: () => void;
  ackReview: (action: BriefAction) => void;
  saveScorecard: (card: Scorecard) => void;
  savePostmortem: (note: Postmortem) => void;
  changeRule: (input: { parameter: string; next: number; evidence: string }) => string | null;
  cycleRulebook: (evidence: string) => string | null;
  feedback: UserFeedback[];
  recordFeedback: (text: string) => { tag: UserFeedback["tag"]; message: string };
  draft: TradeDraft | null;
  stageTrade: (draft: TradeDraft) => void;
  clearDraft: () => void;
  exportJson: () => void;
  importJson: (raw: string) => string | null;
  reset: () => void;
  notificationPermission: NotificationPermission | "unsupported";
  enableNotifications: () => Promise<void>;
  canInstall: boolean;
  promptInstall: () => Promise<void>;
}

const DeskContext = createContext<DeskApi | null>(null);

function upsertBrief(briefs: DeskState["briefs"], brief: DeskState["briefs"][number]) {
  const index = briefs.findIndex((item) => item.date === brief.date);
  if (index === -1) return { briefs: [...briefs, brief], changed: true };
  if (briefSignature(briefs[index]) === briefSignature(brief)) return { briefs, changed: false };
  const next = briefs.slice();
  next[index] = brief;
  return { briefs: next, changed: true };
}

function tickersFor(state: DeskState): string[] {
  return ["SPY", "QQQ", ...state.settings.coreTickers, ...state.theses.map((thesis) => thesis.ticker), ...state.trades.map((trade) => trade.ticker)];
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DeskState>(() => loadState());
  const [prices, setPrices] = useState<PriceBook | null>(null);
  const [priceNote, setPriceNote] = useState("Loading the market snapshot…");
  const [today, setToday] = useState(() => todayISO());
  const [tab, setTabState] = useState<Tab>("brief");
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<TradeDraft | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [installEvent, setInstallEvent] = useState<InstallPrompt | null>(null);

  const [feedback, setFeedback] = useState<UserFeedback[]>(() => loadFeedback(browserMemory()));
  const constraints = useMemo(() => constraintsFromFeedback(feedback), [feedback]);
  const derived = useMemo(() => deriveDesk(state, prices, today, undefined, constraints), [state, prices, today, constraints]);

  useEffect(() => {
    try {
      saveState(state);
    } catch {
      setPriceNote("This browser refused to store the desk. Export a backup before you leave.");
    }
  }, [state]);

  useEffect(() => {
    let cancel = false;
    loadSnapshot()
      .then((book) => {
        if (cancel) return;
        setPrices(book);
        setPriceNote(describeSnapshot(book));
      })
      .catch((error: unknown) => {
        if (cancel) return;
        setPriceNote(error instanceof Error ? error.message : "The price snapshot could not be loaded.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const tick = () => setToday(todayISO());
    const id = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  useEffect(() => {
    setState((current) => {
      const briefs = upsertBrief(current.briefs, derived.brief);
      const anchorSame = JSON.stringify(current.benchmarkAnchor) === JSON.stringify(derived.nextAnchor);
      if (!briefs.changed && current.peakBook === derived.nextPeak && anchorSame) return current;
      return {
        ...current,
        briefs: briefs.briefs,
        peakBook: derived.nextPeak,
        benchmarkAnchor: derived.nextAnchor,
      };
    });
  }, [derived]);

  useEffect(() => {
    if (notificationPermission !== "granted" || state.notificationDate === today) return;
    const actionable = [...derived.brief.schedule, ...derived.brief.engine, ...derived.brief.reminders].filter((action) => action.side !== "hold");
    if (actionable.length === 0) return;
    const lead = actionable[0];
    const body = `${lead.ticker}: ${lead.title}. ${actionable.length} item${actionable.length === 1 ? "" : "s"} in today's brief.`;
    try {
      new Notification("RSI", { body, lang: "en" });
      setState((current) => ({ ...current, notificationDate: today }));
    } catch {
      /* The page may not be allowed to construct a notification. */
    }
  }, [derived, notificationPermission, state.notificationDate, today]);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const api: DeskApi = {
    state,
    derived,
    prices,
    priceNote,
    today,
    tab,
    setTab: (next) => {
      setTabState(next);
      history.replaceState(null, "", `#${next}`);
    },
    refreshing,
    refreshPrices: async () => {
      setRefreshing(true);
      setPriceNote("Asking Yahoo for a live quote…");
      try {
        const live = await fetchLiveQuotes(tickersFor(state));
        const priced = Object.values(live.book.quotes).filter((quote) => quote.price != null).length;
        setPrices((current) => mergeBooks(current, live.book));
        if (priced === 0) {
          const published = live.blocked ? await loadPublishedSnapshot() : null;
          if (published && Object.values(published.quotes).some((quote) => quote.price != null)) {
            setPrices((current) => mergeBooks(current, published));
            setPriceNote(`The browser blocked a live Yahoo refresh (no CORS header). Loaded the published snapshot instead. ${describeSnapshot(published)}`);
          } else {
            setPriceNote(
              live.blocked
                ? "The browser blocked a live Yahoo refresh (no CORS header). The desk is still using the committed snapshot. No price was invented."
                : "Live refresh returned no prices. The committed snapshot is unchanged. No price was invented.",
            );
          }
        } else {
          setPriceNote(`Live refresh priced ${priced} symbol${priced === 1 ? "" : "s"}. ${describeSnapshot(mergeBooks(prices, live.book))}`);
        }
      } finally {
        setRefreshing(false);
      }
    },
    updateSettings: (patch) => {
      setState((current) => {
        const settings = { ...current.settings, ...patch };
        if (!safeAllocate(settings.capital, settings.themeCount).ok) return current;
        return {
          ...current,
          settings,
          peakBook: current.trades.length === 0 ? settings.capital : current.peakBook,
        };
      });
    },
    saveThesis: (thesis) => {
      setState((current) => {
        const index = current.theses.findIndex((item) => item.id === thesis.id);
        const theses = current.theses.slice();
        if (index === -1) theses.push(thesis);
        else theses[index] = thesis;
        return { ...current, theses };
      });
    },
    addExampleThesis: () => {
      const thesis = exampleThesis(today);
      setState((current) => ({ ...current, theses: [...current.theses, thesis] }));
      setTabState("theses");
    },
    archiveThesis: (id) => {
      setState((current) => ({
        ...current,
        theses: current.theses.map((thesis) => (thesis.id === id ? { ...thesis, archived: true } : thesis)),
      }));
    },
    deleteThesis: (id) => {
      setState((current) => ({ ...current, theses: current.theses.filter((thesis) => thesis.id !== id) }));
    },
    addTrade: (trade) => {
      const id = uid();
      setUndoId(id);
      setState((current) => ({ ...current, trades: [...current.trades, { ...trade, id }] }));
      return id;
    },
    deleteTrade: (id) => {
      setUndoId((current) => (current === id ? null : current));
      setState((current) => ({ ...current, trades: current.trades.filter((trade) => trade.id !== id) }));
    },
    undoId,
    undoTrade: () => {
      if (!undoId) return;
      const id = undoId;
      setUndoId(null);
      setState((current) => ({ ...current, trades: current.trades.filter((trade) => trade.id !== id) }));
    },
    saveScorecard: (card) => {
      setState((current) => ({
        ...current,
        scorecards: [...current.scorecards.filter((item) => item.month !== card.month), card],
        reviews: { ...current.reviews, scorecardThrough: card.month },
      }));
    },
    savePostmortem: (note) => {
      setState((current) => ({
        ...current,
        postmortems: [...current.postmortems.filter((item) => item.quarterDate !== note.quarterDate), note],
        reviews: { ...current.reviews, postmortemThrough: note.quarterDate },
      }));
    },
    changeRule: ({ parameter, next, evidence }) => {
      const result = proposeRuleChange(state.rulebook, {
        id: uid(),
        date: today,
        quarterKey: quarterKey(today),
        parameter,
        next,
        evidence,
        bookValue: derived.marks.bookValue,
        peak: derived.nextPeak,
      });
      if (!result.ok) return result.reason;
      setState((current) => ({ ...current, rulebook: result.rulebook }));
      return null;
    },
    cycleRulebook: (evidence) => {
      if (evidence.trim().length < 20) return "Rule 04 needs a sentence of evidence before the rulebook cycles.";
      setState((current) => ({
        ...current,
        rulebook: applyMetaRuleCycle(current.rulebook, {
          id: uid(),
          date: today,
          quarterKey: quarterKey(today),
          evidence,
        }),
        reviews: { ...current.reviews, metaRuleThrough: today },
      }));
      return null;
    },
    feedback,
    recordFeedback: (text) => {
      const item = classifyFeedback(text, today, uid());
      const next = persistFeedback(feedback, item);
      setFeedback(next);
      saveFeedback(browserMemory(), next);
      const absorbed = absorbFeedback(state.rulebook, item);
      return { tag: item.tag, message: absorbed.message };
    },
    ackReview: (action) => {
      const key = action.id.split(":")[1] ?? null;
      setState((current) => {
        const reviews = { ...current.reviews };
        if (action.rule === "SCORECARD") reviews.scorecardThrough = key;
        if (action.rule === "POSTMORTEM") reviews.postmortemThrough = key;
        if (action.rule === "REBALANCE") reviews.rebalanceThrough = key;
        if (action.rule === "METARULE") reviews.metaRuleThrough = key;
        return { ...current, reviews };
      });
    },
    draft,
    stageTrade: (next) => {
      setDraft(next);
      setTabState("ledger");
      history.replaceState(null, "", "#ledger");
    },
    clearDraft: () => setDraft(null),
    exportJson: () => {
      const blob = new Blob([serializeState(state)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rsi-${today}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    importJson: (raw) => {
      try {
        const store = typeof localStorage === "undefined" ? null : localStorage;
        setState(importState(raw, store, today));
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "That file could not be read.";
      }
    },
    reset: () => {
      setState(defaultState(today));
      setDraft(null);
    },
    notificationPermission,
    enableNotifications: async () => {
      if (typeof Notification === "undefined") {
        setNotificationPermission("unsupported");
        return;
      }
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    },
    canInstall: installEvent != null,
    promptInstall: async () => {
      if (!installEvent) return;
      await installEvent.prompt();
      setInstallEvent(null);
    },
  };

  return <DeskContext.Provider value={api}>{children}</DeskContext.Provider>;
}

function browserMemory(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function useDesk(): DeskApi {
  const value = useContext(DeskContext);
  if (!value) throw new Error("useDesk must be used inside DeskProvider");
  return value;
}

export type { TrancheTag };
