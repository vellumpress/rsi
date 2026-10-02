import { useEffect, useState, type ReactNode } from "react";
import { PRIVATE_DESK } from "../lib/access";
import { forgetLegacySecrets, getSupabase, supabaseConfig } from "../lib/supabase";

type Phase = "loading" | "config" | "signed-out" | "private" | "desk";

export interface AuthSession {
  email: string;
  userId: string | null;
  signOut: () => Promise<void>;
}

export function AuthGate({ children }: { children: (session: AuthSession) => ReactNode }) {
  const demo = import.meta.env.VITE_RSI_DEMO === "1";
  const preview = demo ? new URLSearchParams(window.location.search).get("screen") : null;
  const [phase, setPhase] = useState<Phase>(demo ? (preview === "desk" ? "desk" : preview === "private" ? "private" : "signed-out") : "loading");
  const [email, setEmail] = useState(demo && preview === "desk" ? "miketankh@gmail.com" : "");
  const [userId, setUserId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    forgetLegacySecrets(typeof localStorage === "undefined" ? null : localStorage);
    if (demo) return;
    const supabase = getSupabase();
    if (!supabase || !supabaseConfig()) {
      setPhase("config");
      return;
    }
    let cancel = false;
    const look = async (user: { email?: string | null; id?: string } | null | undefined) => {
      const userEmail = user?.email ?? undefined;
      if (!userEmail) {
        if (!cancel) {
          setUserId(null);
          setPhase("signed-out");
        }
        return;
      }
      const { data, error } = await supabase.from("allowlist").select("email").limit(1);
      if (cancel) return;
      if (error) {
        setNote("Sign in again. The session could not be checked.");
        setUserId(null);
        await supabase.auth.signOut();
        setPhase("signed-out");
        return;
      }
      setEmail(userEmail);
      setUserId(user?.id ?? null);
      setPhase(data && data.length > 0 ? "desk" : "private");
    };
    void supabase.auth.getSession().then(({ data }) => look(data.session?.user));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void look(session?.user);
    });
    return () => {
      cancel = true;
      subscription.subscription.unsubscribe();
    };
  }, [demo]);

  const signOut = async () => {
    if (!demo) await getSupabase()?.auth.signOut();
    setEmail("");
    setUserId(null);
    setPhase("signed-out");
  };

  const submit = async (event: { preventDefault(): void }, mode: "sign-in" | "sign-up") => {
    event.preventDefault();
    if (demo) {
      setNote(mode === "sign-up" ? "Preview only. A real signup is checked against the allowlist." : "Preview only. Sign-in uses a saved Supabase session.");
      return;
    }
    if (password.length < 8) {
      setNote("Use at least 8 characters.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    setNote(null);
    const address = email.trim();
    const result = mode === "sign-up"
      ? await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href },
        })
      : await supabase.auth.signInWithPassword({ email: address, password });
    setBusy(false);
    if (result.error) {
      const message = result.error.message || "";
      setNote(/private|not allowed|signup/i.test(message) ? PRIVATE_DESK : message);
      return;
    }
    if (mode === "sign-up" && !result.data.session) {
      setNote("Check your email to confirm the account, then sign in. The session stays on this device after that.");
    }
  };

  if (phase === "loading") {
    return <p className="lede">Checking the saved sign-in.</p>;
  }
  if (phase === "config") {
    return (
      <section className="panel auth-card">
        <h2>Sign in</h2>
        <p>This desk needs its Supabase anon key before anyone can sign in. The xAI key stays on the server.</p>
      </section>
    );
  }
  if (phase === "private") {
    return (
      <section className="panel auth-card" role="alert">
        <h2>{PRIVATE_DESK}</h2>
        <p>This account is not on the list. Nothing on the desk will run, and Grok is not called.</p>
        <button type="button" onClick={() => void signOut()}>Sign out</button>
      </section>
    );
  }
  if (phase === "signed-out") {
    return (
      <section className="panel auth-card">
        <p className="kicker">Sign in</p>
        <h2>RSI</h2>
        <p className="lede">Email and password. The session stays on this device, and Grok uses it. There is no passcode and no place to paste an API key.</p>
        <p className="disclaimer" role="note"><strong>Not financial advice.</strong> RSI does not place a trade.</p>
        <form
          className="setup"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label>
            Email
            <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {note ? <p className="warn">{note}</p> : null}
          <div className="row-actions">
            <button type="button" className="primary" disabled={busy} onClick={(event) => void submit(event, "sign-in")}>Sign in</button>
            <button type="button" disabled={busy} onClick={(event) => void submit(event, "sign-up")}>Create account</button>
          </div>
        </form>
      </section>
    );
  }

  return <>{children({ email, userId, signOut })}</>;
}
