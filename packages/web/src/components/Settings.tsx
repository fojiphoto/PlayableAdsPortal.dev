import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { changePassword, twofaBegin, twofaConfirm, twofaDisable, twofaStatus } from "../api";
import type { AuthUser, PlanStatus } from "../types";

const input =
  "w-full rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";
const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500";

export function Settings({ user, status }: { user: AuthUser; status: PlanStatus | null }) {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [tfaMsg, setTfaMsg] = useState<string | null>(null);
  const [tfaBusy, setTfaBusy] = useState(false);

  useEffect(() => {
    twofaStatus().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
  }, []);

  async function submitPw(e: FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwMsg(null);
    try {
      await changePassword(cur, nw);
      setPwMsg({ ok: true, text: "Password updated." });
      setCur("");
      setNw("");
    } catch (err) {
      setPwMsg({ ok: false, text: (err as Error).message });
    } finally {
      setPwBusy(false);
    }
  }

  async function startTfa() {
    setTfaBusy(true);
    setTfaMsg(null);
    try {
      const r = await twofaBegin();
      const qr = await QRCode.toDataURL(r.otpauth, { margin: 1, width: 196 });
      setSetup({ secret: r.secret, qr });
    } catch (err) {
      setTfaMsg((err as Error).message);
    } finally {
      setTfaBusy(false);
    }
  }
  async function confirmTfa() {
    setTfaBusy(true);
    setTfaMsg(null);
    try {
      await twofaConfirm(code);
      setEnabled(true);
      setSetup(null);
      setCode("");
    } catch (err) {
      setTfaMsg((err as Error).message);
    } finally {
      setTfaBusy(false);
    }
  }
  async function disableTfa() {
    setTfaBusy(true);
    setTfaMsg(null);
    try {
      await twofaDisable(code);
      setEnabled(false);
      setCode("");
    } catch (err) {
      setTfaMsg((err as Error).message);
    } finally {
      setTfaBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold text-slate-100">Settings</h1>

      {/* profile */}
      <section className={`${panel} mb-5`}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-400">Profile</h2>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-slate-400">Email</span>
          <span className="text-slate-100">{user.email}</span>
        </div>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-slate-400">Plan</span>
          <span className="text-slate-100">{status?.planName ?? "—"}</span>
        </div>
      </section>

      {/* password */}
      <section className={`${panel} mb-5`}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-400">Change password</h2>
        <form onSubmit={submitPw} className="grid gap-3">
          <div>
            <label className={label}>Current password</label>
            <input type="password" className={input} value={cur} onChange={(e) => setCur(e.target.value)} required />
          </div>
          <div>
            <label className={label}>New password</label>
            <input type="password" className={input} value={nw} onChange={(e) => setNw(e.target.value)} required minLength={6} />
          </div>
          {pwMsg && <div className={`text-sm ${pwMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{pwMsg.text}</div>}
          <button
            type="submit"
            disabled={pwBusy}
            className="justify-self-start rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {pwBusy ? "Saving…" : "Update password"}
          </button>
        </form>
      </section>

      {/* 2FA */}
      <section className={panel}>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-amber-400">Two-factor authentication</h2>
        <p className="mb-3 text-sm text-slate-400">
          {enabled === null ? "…" : enabled ? "Enabled — a code from your authenticator app is required at sign-in." : "Add a time-based code (TOTP) from an authenticator app."}
        </p>

        {tfaMsg && <div className="mb-3 text-sm text-red-400">{tfaMsg}</div>}

        {enabled === false && !setup && (
          <button onClick={startTfa} disabled={tfaBusy} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
            {tfaBusy ? "…" : "Enable 2FA"}
          </button>
        )}

        {setup && (
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
            <img src={setup.qr} alt="2FA QR code" className="rounded-lg bg-white p-1" width={160} height={160} />
            <div>
              <p className="mb-1 text-xs text-slate-400">Scan the QR in your authenticator app, or enter this key:</p>
              <code className="mb-3 block break-all rounded bg-[#06281c] px-2 py-1 text-xs text-amber-300">{setup.secret}</code>
              <label className={label}>Enter the 6-digit code</label>
              <div className="flex gap-2">
                <input className={`${input} max-w-[140px]`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="000000" />
                <button onClick={confirmTfa} disabled={tfaBusy} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
                  Verify &amp; enable
                </button>
              </div>
            </div>
          </div>
        )}

        {enabled === true && (
          <div>
            <label className={label}>Enter a current code to disable</label>
            <div className="flex gap-2">
              <input className={`${input} max-w-[140px]`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="000000" />
              <button onClick={disableTfa} disabled={tfaBusy} className="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-40">
                Disable 2FA
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-slate-600">Team members &amp; workspace roles are coming next.</p>
    </div>
  );
}
