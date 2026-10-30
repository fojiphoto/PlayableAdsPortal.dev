import { useEffect, useState, type FormEvent } from "react";
import { login, signup, setToken, forgotPassword, checkResetToken, resetPassword } from "../api";
import type { AuthUser } from "../types";

type Mode = "login" | "signup" | "forgot" | "reset";

const input =
  "mb-3 w-full rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400";

export function AuthScreen({
  onAuth,
  onBack,
  resetToken,
  onResetDone,
}: {
  onAuth: (u: AuthUser) => void;
  onBack?: () => void;
  /** present when the user arrived via a password-reset email link (?reset=…) */
  resetToken?: string;
  onResetDone?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  // validate the reset link before showing the form
  useEffect(() => {
    if (!resetToken) return;
    checkResetToken(resetToken)
      .then((r) => setTokenValid(r.valid))
      .catch(() => setTokenValid(false));
  }, [resetToken]);

  function switchMode(m: Mode) {
    setMode(m);
    setErr(null);
    setInfo(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      if (mode === "forgot") {
        await forgotPassword(email);
        setInfo("If an account exists for that email, we've sent a reset link. Check your inbox (and spam).");
      } else if (mode === "reset") {
        await resetPassword(resetToken!, password);
        setInfo("Password updated — you can sign in now.");
        setPassword("");
        onResetDone?.();
        setMode("login");
      } else {
        const { token, user } =
          mode === "login" ? await login(email, password, code || undefined) : await signup(email, password);
        setToken(token);
        onAuth(user);
      }
    } catch (e) {
      const c = (e as { code?: string }).code;
      if (c === "2fa-required") {
        setNeedCode(true);
        setErr("Enter the 6-digit code from your authenticator app.");
      } else if (c === "2fa-invalid") {
        setErr("Invalid code — try again.");
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : mode === "forgot" ? "Reset your password" : "Choose a new password";
  const subtitle =
    mode === "forgot"
      ? "Enter your email and we'll send you a reset link."
      : mode === "reset"
        ? "Pick a new password for your account."
        : "Access the packager studio";

  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/logo.png" alt="Factorial" className="h-8 w-8 rounded-lg object-contain" />
          <span className="text-lg font-semibold text-slate-100">Factorial AdLab</span>
        </div>
        {onBack && (
          <button onClick={onBack} className="mb-4 block w-full text-center text-sm text-slate-400 hover:text-amber-400">
            ← Back to home
          </button>
        )}

        <form onSubmit={submit} className="rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-6">
          <h1 className="mb-1 text-xl font-semibold text-slate-100">{title}</h1>
          <p className="mb-5 text-sm text-slate-400">{subtitle}</p>

          {mode === "reset" && tokenValid === false && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              This reset link is invalid or has expired.{" "}
              <button type="button" onClick={() => switchMode("forgot")} className="text-amber-400 hover:underline">
                Request a new one
              </button>
            </div>
          )}

          {mode !== "reset" && (
            <>
              <label className={label}>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@studio.com" className={input} />
            </>
          )}

          {mode !== "forgot" && (mode !== "reset" || tokenValid !== false) && (
            <>
              <label className={label}>{mode === "reset" ? "New password" : "Password"}</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={input + " mb-4"}
              />
            </>
          )}

          {mode === "login" && needCode && (
            <>
              <label className={label}>Authenticator code</label>
              <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" className={input + " mb-4"} />
            </>
          )}

          {err && <div className="mb-3 text-sm text-red-400">{err}</div>}
          {info && <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{info}</div>}

          {!(mode === "reset" && tokenValid === false) && (
            <button
              type="submit"
              disabled={busy || (mode === "reset" && tokenValid === null)}
              className="w-full rounded-lg bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-500 disabled:opacity-40"
            >
              {busy ? "…" : mode === "login" ? "Sign in" : mode === "signup" ? "Sign up" : mode === "forgot" ? "Send reset link" : "Set new password"}
            </button>
          )}

          <div className="mt-4 flex flex-col items-center gap-1 text-center text-sm text-slate-400">
            {mode === "login" && (
              <>
                <span>
                  New here?{" "}
                  <button type="button" onClick={() => switchMode("signup")} className="text-amber-400 hover:underline">
                    Create an account
                  </button>
                </span>
                <button type="button" onClick={() => switchMode("forgot")} className="text-slate-400 hover:text-amber-400 hover:underline">
                  Forgot password?
                </button>
              </>
            )}
            {mode === "signup" && (
              <span>
                Have an account?{" "}
                <button type="button" onClick={() => switchMode("login")} className="text-amber-400 hover:underline">
                  Sign in
                </button>
              </span>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <button type="button" onClick={() => switchMode("login")} className="text-amber-400 hover:underline">
                ← Back to sign in
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
