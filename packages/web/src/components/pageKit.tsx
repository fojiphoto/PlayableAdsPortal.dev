import type { ReactNode } from "react";
import { Icon } from "./icons";
import "../pages.css";

/** Small building blocks shared by the inner dashboard pages (styles in pages.css). */

export function PageHead({ title, sub, icon, actions }: { title: ReactNode; sub?: ReactNode; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pg-head">
      <div>
        <h1 className="pg-title">
          {icon}
          {title}
        </h1>
        {sub && <p className="pg-sub">{sub}</p>}
      </div>
      {actions && <div className="pg-head-actions">{actions}</div>}
    </div>
  );
}

/** One message line (error, neutral, warning or success). */
export function Msg({ kind, children }: { kind: "err" | "ok" | "warn" | "success"; children: ReactNode }) {
  const I = kind === "err" || kind === "warn" ? Icon.Alert : Icon.CheckCircle;
  return (
    <div className={`pg-msg ${kind}`} role={kind === "err" ? "alert" : "status"}>
      <I />
      <span>{children}</span>
    </div>
  );
}

export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <div className="pg-loading" role="status">
      <span className="pg-spin" aria-hidden="true" />
      {children}
    </div>
  );
}
