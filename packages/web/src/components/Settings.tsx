import { PluginSection } from "./PluginSection";
import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { changePassword, twofaBegin, twofaConfirm, twofaDisable, twofaStatus } from "../api";
import { getOrg, renameOrg, inviteMember, revokeInvite, setMemberRole, removeMember, leaveWorkspace, transferOwnership, setRequire2fa } from "../api";
import type { AuthUser, OrgDetail, OrgRole, PlanStatus } from "../types";
import { Icon } from "./icons";
import { Msg, PageHead } from "./pageKit";

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
      onWorkspaceChanged?.(); // a workspace that requires 2FA unlocks now
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
      onWorkspaceChanged?.();
    } catch (err) {
      setTfaMsg((err as Error).message);
    } finally {
      setTfaBusy(false);
    }
  }

  const usedPct = status && status.limit ? Math.min(100, Math.round((status.used / status.limit) * 100)) : 0;

  return (
    <div>
      <PageHead title="Settings" sub="Your account, security, workspace and team, and the Unity plugin." />

      <div className="pg-settings">
        {/* account */}
        <section className="pg-card">
          <h2 className="pg-h">Your account</h2>
          <dl className="pg-kv">
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Email verified</dt>
              <dd>{user.emailVerified ? <span className="pg-tag ok">Verified</span> : <span className="pg-tag warn">Not yet</span>}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>
                <span className="pg-tag gold">{status?.planName ?? "—"}</span>
              </dd>
            </div>
            {user.isAdmin && (
              <div>
                <dt>Platform role</dt>
                <dd>
                  <span className="pg-tag brand">Admin</span>
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* export usage */}
        {status && (
          <section className="pg-card">
            <div className="pg-card-head">
              <h2 className="pg-h">Export usage</h2>
              <span className="pg-count">{status.limit == null ? "Unlimited" : "Last 30 days"}</span>
            </div>
            <div className="pg-usage">
              <div className="pg-usage-row">
                <span>
                  <b>{status.used}</b> {status.limit == null ? "exports" : `of ${status.limit} exports`}
                </span>
                <span>{status.planName} plan</span>
              </div>
              {status.limit != null && (
                <div className="pg-bar" role="progressbar" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Exports used">
                  <i style={{ width: `${usedPct}%` }} />
                </div>
              )}
            </div>
          </section>
        )}

        {/* 2FA */}
        <section className="pg-card">
          <div className="pg-card-head">
            <h2 className="pg-h">Two-factor authentication</h2>
            {enabled !== null && <span className={`pg-tag ${enabled ? "ok" : ""}`}>{enabled ? "On" : "Off"}</span>}
          </div>
          <p className="pg-p">
            {enabled === null
              ? "…"
              : enabled
                ? "On. Signing in asks for a code from your authenticator app."
                : "Protect sign-in with a time-based code (TOTP) from an authenticator app."}
          </p>

          {tfaMsg && <Msg kind="err">{tfaMsg}</Msg>}

          {enabled === false && !setup && (
            <button onClick={startTfa} disabled={tfaBusy} className="pg-btn pg-btn-primary">
              <Icon.Shield />
              {tfaBusy ? "…" : "Turn on 2FA"}
            </button>
          )}

          {setup && (
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
              <img src={setup.qr} alt="2FA QR code" className="rounded-[10px] border border-line bg-paper p-1" width={160} height={160} />
              <div className="flex min-w-0 flex-col gap-3">
                <p className="pg-p" style={{ margin: 0 }}>
                  Scan the QR in your authenticator app, or enter this key:
                </p>
                <code className="pg-codeblock">{setup.secret}</code>
                <label className="pg-field">
                  <span className="pg-label">Enter the 6-digit code</span>
                  <div className="flex flex-wrap gap-2">
                    <input className="pg-input mono max-w-[140px]" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="000000" />
                    <button onClick={confirmTfa} disabled={tfaBusy} className="pg-btn pg-btn-primary">
                      Verify &amp; turn on
                    </button>
                  </div>
                </label>
              </div>
            </div>
          )}

          {enabled === true && (
            <label className="pg-field">
              <span className="pg-label">Enter a current code to turn it off</span>
              <div className="flex flex-wrap gap-2">
                <input className="pg-input mono max-w-[140px]" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="000000" />
                <button onClick={disableTfa} disabled={tfaBusy} className="pg-btn pg-btn-danger">
                  Turn off 2FA
                </button>
              </div>
            </label>
          )}
        </section>

        {/* password */}
        <section className="pg-card">
          <h2 className="pg-h">Change password</h2>
          <form onSubmit={submitPw} className="grid gap-3.5">
            <label className="pg-field">
              <span className="pg-label">Current password</span>
              <input type="password" className="pg-input" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" />
            </label>
            <label className="pg-field">
              <span className="pg-label">New password</span>
              <input type="password" className="pg-input" value={nw} onChange={(e) => setNw(e.target.value)} required minLength={6} autoComplete="new-password" />
            </label>
            {pwMsg && <Msg kind={pwMsg.ok ? "success" : "err"}>{pwMsg.text}</Msg>}
            <div>
              <button type="submit" disabled={pwBusy} className="pg-btn pg-btn-primary">
                {pwBusy ? "Saving…" : "Update password"}
              </button>
            </div>
          </form>
        </section>

        <WorkspaceSection key={String(user.twoFactor)} me={user} onChanged={onWorkspaceChanged} />
        <PluginSection />
      </div>
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

  if (!org)
    return (
      <section className="pg-card">
        <h2 className="pg-h">Workspace &amp; team</h2>
        {err ? <Msg kind="err">{err}</Msg> : <p className="pg-p" style={{ margin: 0 }}>Loading workspace…</p>}
      </section>
    );
  const isOwner = org.role === "owner";
  const isAdmin = isOwner || org.role === "admin";
  const canEditRow = (m: { id: string; role: OrgRole }) => isAdmin && m.role !== "owner" && (isOwner || m.role !== "admin");

  return (
    <>
      <section className="pg-card">
        <div className="pg-card-head">
          <h2 className="pg-h">Workspace &amp; team</h2>
          <div className="flex items-center gap-3 text-[13px]">
            {isAdmin && (
              <button onClick={() => void rename()} className="pg-link">
                Rename
              </button>
            )}
            {!isOwner && (
              <button onClick={() => void leave()} disabled={busy} className="pg-link danger">
                Leave
              </button>
            )}
          </div>
        </div>
        <dl className="pg-kv mb-4">
          <div>
            <dt>Workspace</dt>
            <dd>{org.name}</dd>
          </div>
          <div>
            <dt>Your role</dt>
            <dd>
              <span className={`pg-tag ${isAdmin ? "brand" : ""}`} title={ROLE_HELP[org.role]}>
                {org.role}
              </span>
            </dd>
          </div>
          <div>
            <dt>Billed to</dt>
            <dd>{org.owner.email ?? "—"}</dd>
          </div>
        </dl>
        <p className="pg-hint" style={{ margin: "0 0 16px" }}>
          Apps, plan, domain verification and the export quota belong to the workspace. Roles: viewer → member → admin → owner.
        </p>

        <div className="pg-tablewrap mb-4">
          <table className="pg-table">
            <thead>
              <tr>
                <th>Member</th>
                {isAdmin && <th>2FA</th>}
                <th>Role</th>
                <th className="r" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {org.members.map((m) => (
                <tr key={m.id}>
                  <td className="wrap" style={{ overflowWrap: "anywhere" }}>
                    {m.email}
                    {m.id === me.id && <span className="dim"> (you)</span>}
                  </td>
                  {isAdmin && (
                    <td>
                      <span
                        className={`pg-tag ${m.twoFactor ? "ok" : org.require2fa ? "err" : ""}`}
                        title={m.twoFactor ? "Two-factor authentication is on" : "No two-factor authentication"}
                      >
                        {m.twoFactor ? "On" : "Off"}
                      </span>
                    </td>
                  )}
                  <td>
                    {canEditRow(m) ? (
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => void run(() => setMemberRole(m.id, e.target.value as OrgRole))}
                        className="pg-input sm w-auto"
                        title={ROLE_HELP[m.role]}
                      >
                        <option value="viewer">viewer</option>
                        <option value="member">member</option>
                        {isOwner && <option value="admin">admin</option>}
                      </select>
                    ) : (
                      <span className={`pg-tag ${m.role === "owner" || m.role === "admin" ? "brand" : ""}`} title={ROLE_HELP[m.role]}>
                        {m.role}
                      </span>
                    )}
                  </td>
                  <td className="r">
                    <span className="inline-flex gap-3">
                      {isOwner && m.role !== "owner" && (
                        <button onClick={() => void transfer(m.id, m.email)} disabled={busy} className="pg-link muted">
                          Make owner
                        </button>
                      )}
                      {canEditRow(m) && (
                        <button onClick={() => void run(() => removeMember(m.id))} disabled={busy} className="pg-link danger">
                          Remove
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isAdmin && org.invites.length > 0 && (
          <div className="mb-4">
            <div className="pg-label mb-2">Pending invites</div>
            <div className="grid gap-1.5">
              {org.invites.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dashed border-line-strong px-3 py-2 text-[13.5px]">
                  <span className="min-w-0 text-text" style={{ overflowWrap: "anywhere" }}>
                    {i.email} <span className="text-text-3">· {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                  </span>
                  <button onClick={() => void run(() => revokeInvite(i.id))} disabled={busy} className="pg-link danger text-[13px]">
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {err && <Msg kind="err">{err}</Msg>}

        {isAdmin ? (
          <form onSubmit={invite}>
            <div className="pg-label mb-2">Invite a teammate</div>
            <div className="flex flex-wrap gap-2">
              <input className="pg-input min-w-[200px] flex-1" type="email" placeholder="teammate@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className="pg-input w-auto" title={ROLE_HELP[role]}>
                <option value="viewer">viewer</option>
                <option value="member">member</option>
                {isOwner && <option value="admin">admin</option>}
              </select>
              <button type="submit" disabled={busy} className="pg-btn pg-btn-primary">
                <Icon.Mail />
                {busy ? "…" : "Send invite"}
              </button>
            </div>
            <p className="pg-hint">They get an email link; no account needed in advance. Invites expire after 7 days.</p>
          </form>
        ) : (
          <p className="pg-hint" style={{ margin: 0 }}>
            Only admins can manage team members. Ask the owner ({org.owner.email ?? "workspace owner"}) to invite people.
          </p>
        )}
      </section>

      {/* workspace two-factor policy */}
      <section className="pg-card">
        <div className="pg-card-head">
          <h2 className="pg-h">Workspace two-factor policy</h2>
          <span className={`pg-tag ${org.require2fa ? "brand" : ""}`}>{org.require2fa ? "Required" : "Optional"}</span>
        </div>
        <label className="pg-checkrow">
          <input
            type="checkbox"
            className="pg-check"
            checked={!!org.require2fa}
            disabled={!isAdmin || busy || !me.twoFactor}
            onChange={(e) => void run(() => setRequire2fa(e.target.checked))}
          />
          <span>
            Require two-factor authentication for every member
            <span className="mt-0.5 block text-[13px] leading-normal text-text-3">
              {!isAdmin
                ? "Admins decide this."
                : !me.twoFactor
                  ? "Turn on two-factor authentication for your own account (above) to change this."
                  : org.require2fa
                    ? `${org.members.filter((m) => !m.twoFactor).length} member(s) without 2FA can sign in but can't use this workspace until they turn it on.`
                    : "Members without 2FA get an email and can't use the workspace until they turn it on."}
            </span>
          </span>
        </label>
      </section>
    </>
  );
}
