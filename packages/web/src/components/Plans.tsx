import { useEffect, useRef, useState } from "react";
import { listPlans, checkout, billingPortal, cancelSubscription, resumeSubscription, syncBilling, getNetworks } from "../api";
import type { Network, Plan, PlanStatus } from "../types";
import { ContactDialog } from "./ContactDialog";
import { Icon } from "./icons";
import { Msg, PageHead } from "./pageKit";

/** Where the landing page parks a plan picked before sign-in (see App's PENDING_PLAN_KEY). */
const PENDING_PLAN_KEY = "adlab.pendingPlan";
const PAID = ["starter", "studio"];

/** Takes (and clears) a plan the visitor picked on the landing page before signing in. */
function takePendingPlan(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_PLAN_KEY);
    if (v !== null) sessionStorage.removeItem(PENDING_PLAN_KEY);
    return v && PAID.includes(v) ? v : null;
  } catch {
    return null; // storage blocked
  }
}

export function Plans({ status, onChanged, email }: { status: PlanStatus | null; onChanged: (s: PlanStatus) => void; email?: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [contact, setContact] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pendingTaken = useRef(false);

  useEffect(() => {
    listPlans()
      .then(setPlans)
      .catch((e) => setErr((e as Error).message));
    getNetworks()
      .then(setNetworks)
      .catch(() => {});
  }, []);

  async function pick(id: string) {
    if (id === status?.plan) return;
    setBusy(id);
    setErr(null);
    try {
      const res = await checkout(id);
      if (res.contact) {
        setContact(true);
      } else if (res.url) {
        setRedirecting(true);
        window.location.href = res.url; // → Stripe Checkout / billing portal
      } else if (res.status) {
        onChanged(res.status); // dev mode: switched instantly
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // a plan picked on the landing page before sign-in: start its checkout once, the same way the button does
  useEffect(() => {
    if (pendingTaken.current) return;
    pendingTaken.current = true;
    const pending = takePendingPlan();
    if (pending) void pick(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function subAction(kind: "cancel" | "resume" | "sync") {
    if (kind === "cancel" && !window.confirm("Cancel your subscription? You keep access until the end of the current billing period.")) return;
    setBusy("__" + kind);
    setErr(null);
    try {
      const s = kind === "cancel" ? await cancelSubscription() : kind === "resume" ? await resumeSubscription() : await syncBilling();
      onChanged(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  async function manageBilling() {
    setBusy("__portal");
    setErr(null);
    try {
      const { url } = await billingPortal();
      window.location.href = url;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const usedPct = status && status.limit ? Math.min(100, Math.round((status.used / status.limit) * 100)) : 0;
  const checkingOut = redirecting || (busy !== null && PAID.includes(busy));
  const allows = (p: Plan, id: string) => p.networks === "all" || p.networks.includes(id);
  // features accumulate up the tiers ("everything in Starter, plus…"); export and network lines have their own rows
  const featureRows: { label: string; from: number }[] = [];
  plans.forEach((p, i) =>
    p.features
      .filter((f) => !/export|network|card required/i.test(f) || /ordering/i.test(f))
      .forEach((f) => featureRows.push({ label: f, from: i })),
  );
  const yes = <Icon.Check aria-label="Included" />;
  const no = <span className="no" aria-label="Not included">—</span>;

  return (
    <div className="pg-pricing">
      {checkingOut && (
        <div className="pg-overlay" role="status" aria-live="polite">
          <div className="pg-overlay-card">
            <span className="pg-spin lg" aria-hidden="true" />
            <p>Redirecting to secure checkout…</p>
            <span className="pg-overlay-sub">Powered by Stripe</span>
          </div>
        </div>
      )}

      <PageHead title="Plans & pricing" sub="Pick the plan that fits. Billed monthly; change or cancel anytime." />

      {status && (
        <section className="pg-card mb-4" style={{ padding: "16px 20px" }}>
          <div className="pg-usage">
            <div className="pg-usage-row">
              <span>
                Current plan: <b>{status.planName}</b>
              </span>
              <span>{status.limit == null ? `${status.used} exports · unlimited` : `${status.used} / ${status.limit} exports · last 30 days`}</span>
            </div>
            {status.limit != null && (
              <div className="pg-bar" role="progressbar" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Exports used">
                <i style={{ width: `${usedPct}%` }} />
              </div>
            )}
          </div>
        </section>
      )}

      {err && <Msg kind="err">{err}</Msg>}

      <div className="tier-grid" style={{ marginTop: 10 }}>
        {plans.map((p) => {
          const current = p.id === status?.plan;
          return (
            <div key={p.id} className={`tier-card${p.popular ? " featured" : ""}`}>
              {p.popular && <div className="tier-badge">Most popular</div>}
              <div className="tier-name">{p.name}</div>
              <div className="tier-price">
                {p.price == null ? (
                  <span className="tier-custom">Custom</span>
                ) : p.price === 0 ? (
                  <span className="tier-custom">Free</span>
                ) : (
                  <>
                    <span className="tier-amount">${p.price}</span>
                    <span className="tier-per">/mo</span>
                  </>
                )}
              </div>
              <div className="tier-billed">{p.price == null ? "Priced for your volume" : p.price === 0 ? "Forever" : "Billed monthly"}</div>
              <p className="tier-tag">{p.blurb}</p>
              <button
                className={`tier-cta${p.popular ? " primary" : ""}${current ? " is-current" : ""}`}
                disabled={busy === p.id || current}
                onClick={() => void pick(p.id)}
              >
                {busy === p.id ? (
                  <span className="pg-spin" aria-label="Working" />
                ) : current ? (
                  <>
                    <Icon.Check /> Current plan
                  </>
                ) : p.id === "enterprise" ? (
                  "Contact sales"
                ) : (
                  `Switch to ${p.name}`
                )}
              </button>
              <ul className="tier-highlights">
                {p.features.map((f, i) => (
                  <li key={i}>
                    <Icon.Check /> {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {status && status.plan !== "free" && status.plan !== "enterprise" && (
        <section className="pg-card mt-5 flex flex-wrap items-center justify-between gap-3" style={{ padding: "16px 20px" }}>
          <div className="text-[14px] text-text-2">
            <b className="font-semibold text-text">Subscription</b>
            {status.hasSubscription ? (
              <>
                {" · "}
                {status.cancelAtPeriodEnd ? (
                  <span className="text-[#b91c1c]">cancels {status.renewsAt ? `on ${fmtDate(status.renewsAt)}` : "at period end"}; you keep access until then</span>
                ) : status.renewsAt ? (
                  <span>renews on {fmtDate(status.renewsAt)}</span>
                ) : (
                  <span>{status.status ?? "active"}</span>
                )}
                {status.status && status.status !== "active" && status.status !== "trialing" && (
                  <span className="text-[#b91c1c]"> · {status.status.replace(/_/g, " ")}</span>
                )}
              </>
            ) : (
              <> · no Stripe subscription on file</>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status.hasSubscription &&
              (status.cancelAtPeriodEnd ? (
                <button className="pg-btn pg-btn-primary pg-btn-sm" disabled={busy === "__resume"} onClick={() => void subAction("resume")}>
                  {busy === "__resume" ? "…" : "Resume subscription"}
                </button>
              ) : (
                <button className="pg-btn pg-btn-ghost pg-btn-sm" disabled={busy === "__cancel"} onClick={() => void subAction("cancel")}>
                  {busy === "__cancel" ? "…" : "Cancel subscription"}
                </button>
              ))}
            <button className="pg-btn pg-btn-ghost pg-btn-sm" disabled={busy === "__portal"} onClick={manageBilling}>
              {busy === "__portal" ? "…" : "Manage billing"}
            </button>
            {status.hasSubscription && (
              <button type="button" disabled={busy === "__sync"} onClick={() => void subAction("sync")} title="Re-read the subscription from Stripe" className="pg-link muted text-[13px]">
                {busy === "__sync" ? "Syncing…" : "Sync with Stripe"}
              </button>
            )}
          </div>
        </section>
      )}

      {plans.length > 0 && (
        <>
          <h2 className="compare-h">Compare plans</h2>
          <div className="compare-wrap">
            <table className="pg-compare">
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Feature</span>
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} className={`ctr${p.id === status?.plan ? " cur" : ""}`}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="grp">
                  <td colSpan={plans.length + 1}>Limits</td>
                </tr>
                <tr>
                  <td>Price</td>
                  {plans.map((p) => (
                    <td key={p.id} className="ctr">
                      {p.price == null ? "Custom" : p.price === 0 ? "$0" : `$${p.price}/mo`}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Exports per 30 days</td>
                  {plans.map((p) => (
                    <td key={p.id} className="ctr">
                      {p.exportsPer30d == null ? "Unlimited" : p.exportsPer30d}
                    </td>
                  ))}
                </tr>
                <tr className="grp">
                  <td colSpan={plans.length + 1}>Ad networks{networks.length ? ` · ${networks.length}` : ""}</td>
                </tr>
                {(networks.length ? networks : [{ id: "unityads", name: "Unity Ads" } as Network]).map((n) => (
                  <tr key={n.id}>
                    <td>{n.name}</td>
                    {plans.map((p) => (
                      <td key={p.id} className="ctr">
                        {allows(p, n.id) ? yes : no}
                      </td>
                    ))}
                  </tr>
                ))}
                {!networks.length && (
                  <tr>
                    <td>Every other network</td>
                    {plans.map((p) => (
                      <td key={p.id} className="ctr">
                        {p.networks === "all" ? yes : no}
                      </td>
                    ))}
                  </tr>
                )}
                {featureRows.length > 0 && (
                  <tr className="grp">
                    <td colSpan={plans.length + 1}>Features</td>
                  </tr>
                )}
                {featureRows.map((f) => (
                  <tr key={f.label}>
                    <td>{f.label}</td>
                    {plans.map((p, i) => (
                      <td key={p.id} className="ctr">
                        {i >= f.from ? yes : no}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {contact && <ContactDialog onClose={() => setContact(false)} defaultEmail={email} topic="Enterprise plan enquiry" />}
      <p className="pricing-note">Upgrades go through secure Stripe Checkout. Manage or cancel anytime from the billing portal.</p>
    </div>
  );
}
