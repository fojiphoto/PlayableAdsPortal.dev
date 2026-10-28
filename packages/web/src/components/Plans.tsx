import { useEffect, useState } from "react";
import { listPlans, checkout, billingPortal } from "../api";
import type { Plan, PlanStatus } from "../types";

export function Plans({ status, onChanged }: { status: PlanStatus | null; onChanged: (s: PlanStatus) => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listPlans()
      .then(setPlans)
      .catch((e) => setErr((e as Error).message));
  }, []);

  async function pick(id: string) {
    if (id === status?.plan) return;
    setBusy(id);
    setErr(null);
    try {
      const res = await checkout(id);
      if (res.contact) {
        window.location.href = "mailto:contact@factorialstudio.com?subject=Factorial%20AdLab%20Enterprise";
      } else if (res.url) {
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

  return (
    <div className="fx" style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div className="fx-eyebrow">Plans</div>
      <h2 className="disp" style={{ fontSize: "1.8rem", color: "#fff", marginBottom: 18 }}>
        Pick your plan
      </h2>

      {status && (
        <div
          style={{
            background: "rgba(255,255,255,.05)",
            border: "2px solid rgba(163,217,119,.18)",
            borderRadius: 18,
            padding: "16px 20px",
            marginBottom: 22,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: ".92rem" }}>
            <span style={{ color: "var(--muted)" }}>
              Current plan:{" "}
              <b style={{ color: "var(--gold)", fontWeight: 700 }}>{status.planName}</b>
            </span>
            <span style={{ color: "var(--muted)" }}>
              {status.limit == null
                ? `${status.used} exports · unlimited`
                : `${status.used} / ${status.limit} exports · last 30 days`}
            </span>
          </div>
          {status.limit != null && (
            <div style={{ marginTop: 12, height: 8, borderRadius: 999, background: "rgba(0,0,0,.25)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${usedPct}%`, background: usedPct > 85 ? "#ff8a7a" : "var(--leaf2)" }} />
            </div>
          )}
        </div>
      )}

      {err && <div style={{ color: "#ff8a7a", marginBottom: 14, fontSize: ".9rem" }}>{err}</div>}

      <div className="fx-pricing">
        {plans.map((p) => {
          const current = p.id === status?.plan;
          return (
            <div key={p.id} className={`fx-plan${p.popular ? " pop" : ""}`}>
              {p.popular && <span className="fx-pop-tag">Most popular</span>}
              <h3>{p.name}</h3>
              <div className="price">{typeof p.price === "number" ? `$${p.price}` : "Custom"}</div>
              <div className="per">{p.price === 0 ? "forever" : p.price == null ? "volume & SLA" : "/ month"}</div>
              <ul>
                {p.features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <button
                className={`btn ${p.popular ? "btn-gold" : "btn-ghost"}`}
                disabled={busy === p.id || current}
                onClick={() => pick(p.id)}
                style={current ? { opacity: 0.55 } : undefined}
              >
                {current ? "Current plan" : busy === p.id ? "…" : p.id === "enterprise" ? "Contact sales" : `Switch to ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {status && status.plan !== "free" && status.plan !== "enterprise" && (
        <div style={{ marginTop: 18 }}>
          <button className="btn btn-ghost" disabled={busy === "__portal"} onClick={manageBilling}>
            {busy === "__portal" ? "…" : "Manage billing"}
          </button>
        </div>
      )}

      <p style={{ marginTop: 18, fontSize: ".8rem", color: "var(--muted)" }}>
        Upgrades go through secure Stripe Checkout. Manage or cancel anytime from the billing portal.
      </p>
    </div>
  );
}
