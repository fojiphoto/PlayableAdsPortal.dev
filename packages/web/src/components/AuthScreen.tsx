import { useState, type FormEvent } from "react";
import { login, signup, setToken } from "../api";
import type { AuthUser } from "../types";

export function AuthScreen({ onAuth, onBack }: { onAuth: (u: AuthUser) => void; onBack?: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { token, user } = await (mode === "login" ? login(email, password) : signup(email, password));
      setToken(token);
      onAuth(user);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/logo.png" alt="Factorial" className="h-8 w-8 rounded-lg object-contain" />
          <span className="text-lg font-semibold text-slate-100">Factorial AdLab</span>
        </div>
        {onBack && (
          <button onClick={onBack} className="mb-4 block w-full text-center text-sm text-slate-500 hover:text-amber-400">
            ← Back to home
          </button>
        )}

        <form onSubmit={submit} className="rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-6">
          <h1 className="mb-1 text-xl font-semibold text-slate-100">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <p className="mb-5 text-sm text-slate-500">Access the packager studio</p>

          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            className="mb-3 w-full rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
          />
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mb-4 w-full rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
          />

          {err && <div className="mb-3 text-sm text-red-400">{err}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}
          </button>

          <div className="mt-4 text-center text-sm text-slate-500">
            {mode === "login" ? "New here?" : "Have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setErr(null);
              }}
              className="text-amber-400 hover:underline"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
