import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { changePassword, twofaBegin, twofaConfirm, twofaDisable, twofaStatus } from "../api";
import { getOrg, renameOrg, inviteMember, revokeInvite, setMemberRole, removeMember, leaveWorkspace, transferOwnership } from "../api";
import type { AuthUser, OrgDetail, OrgRole, PlanStatus } from "../types";

const input =
  "w-full rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";
const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400";

export function Settings({ user, status, onWorkspaceChanged }: { user: AuthUser; status: PlanStatus | null; onWorkspaceChanged?: () => void }) {
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

      <WorkspaceSection me={user} onChanged={onWorkspaceChanged} />
    </div>
  );
}

const ROLE_HELP: Record<OrgRole, string> = {
  viewer: "preview & download",
  member: "+ upload, capture, compile, export",
  admin: "+ delete, members, domain, preloader",
  owner: "+ billing, ownership",
};

function WorkspaceSection({ me, onChanged }: { me: AuthUser; onChanged?: () => void }) {
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getOrg().then(setOrg).catch((e) => setErr((e as Error).message));
  }, []);

  async function run(action: () => Promise<OrgDetail>) {
    setBusy(true);
    setErr(null);
    try {
      setOrg(await action());
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    await run(() => inviteMember(email.trim(), role));
    setEmail("");
  }
  async function rename() {
    if (!org) return;
    const name = window.prompt("Workspace name", org.name)?.trim();
    if (!name || name === org.name) return;
    await run(() => renameOrg(name));
    onChanged?.();
  }
  async function leave() {
    if (!window.confirm("Leave this workspace? You will lose access to its apps.")) return;
    setBusy(true);
    try {
      await leaveWorkspace();
      onChanged?.();
      setOrg(await getOrg());
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function transfer(userId: string, toEmail: string) {
    if (!window.confirm(`Transfer ownership of "${org?.name}" to ${toEmail}? You become an admin.`)) return;
    await run(() => transferOwnership(userId));
    onChanged?.();
  }

  if (!org) return <section className={`${panel} mt-5 text-sm text-slate-400`}>{err ?? "Loading workspace…"}</section>;
  const isOwner = org.role === "owner";
  const isAdmin = isOwner || org.role === "admin";
  const canEditRow = (m: { id: string; role: OrgRole }) => isAdmin && m.role !== "owner" && (isOwner || m.role !== "admin");

  return (
    <section className={`${panel} mt-5`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">
          Workspace · <span className="text-slate-100 normal-case tracking-normal">{org.name}</span>
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-400">
            you are <b className="text-slate-200">{org.role}</b>
          </span>
          {isAdmin && (
            <button onClick={() => void rename()} className="text-amber-400 hover:underline">
              Rename
            </button>
          )}
          {!isOwner && (
            <button onClick={() => void leave()} disabled={busy} className="text-red-400 hover:underline disabled:opacity-40">
              Leave
            </button>
          )}
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-400">
        Apps, plan, domain verification and the export quota belong to the workspace; the owner ({org.owner.email}) is billed. Roles: viewer →
        member → admin → owner.
      </p>

      <div className="mb-3 grid gap-1">
        {org.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1b5540] bg-[#06281c] px-3 py-2 text-sm">
            <span className="text-slate-100">
              {m.email}
              {m.id === me.id && <span className="text-xs text-slate-500"> (you)</span>}
            </span>
            <span className="flex items-center gap-2 text-xs">
              {canEditRow(m) ? (
                <select
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => void run(() => setMemberRole(m.id, e.target.value as OrgRole))}
                  className="rounded border border-[#1f6b4a] bg-[#0a3a28] px-1.5 py-0.5 text-slate-200"
                  title={ROLE_HELP[m.role]}
                >
                  <option value="viewer">viewer</option>
                  <option value="member">member</option>
                  {isOwner && <option value="admin">admin</option>}
                </select>
              ) : (
                <span className="text-slate-400" title={ROLE_HELP[m.role]}>
                  {m.role}
                </span>
              )}
              {isOwner && m.role !== "owner" && (
                <button onClick={() => void transfer(m.id, m.email)} disabled={busy} className="text-slate-400 hover:text-amber-300 hover:underline disabled:opacity-40">
                  make owner
                </button>
              )}
              {canEditRow(m) && (
                <button onClick={() => void run(() => removeMember(m.id))} disabled={busy} className="text-red-400 hover:underline disabled:opacity-40">
                  Remove
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {isAdmin && org.invites.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Pending invites</div>
          <div className="grid gap-1">
            {org.invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-dashed border-[#1b5540] px-3 py-1.5 text-sm text-slate-300">
                <span>
                  {i.email} <span className="text-xs text-slate-500">· {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                </span>
                <button onClick={() => void run(() => revokeInvite(i.id))} disabled={busy} className="text-xs text-red-400 hover:underline disabled:opacity-40">
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <div className="mb-2 text-sm text-red-400">{err}</div>}

      {isAdmin && (
        <form onSubmit={invite} className="flex flex-wrap gap-2">
          <input className={`${input} min-w-[200px] flex-1`} type="email" placeholder="teammate@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className={`${input} w-auto`} title={ROLE_HELP[role]}>
            <option value="viewer">viewer</option>
            <option value="member">member</option>
            {isOwner && <option value="admin">admin</option>}
          </select>
          <button type="submit" disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
            {busy ? "…" : "Send invite"}
          </button>
          <p className="w-full text-xs text-slate-500">They get an email link; no account needed in advance. Invites expire after 7 days.</p>
        </form>
      )}
    </section>
  );
}
