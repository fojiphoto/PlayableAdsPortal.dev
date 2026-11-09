import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "./icons";

/** Centered dialog on a dimmed veil. Clicking the veil or pressing Escape closes it. */
export function Modal({ title, sub, onClose, children }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sh-modal-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sh-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sh-modal-head">
          <h2>{title}</h2>
          <button type="button" className="sh-modal-x" onClick={onClose} aria-label="Close">
            <Icon.X />
          </button>
        </div>
        {sub && <p className="sh-modal-sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export type Platform = "ios" | "android" | "both";

const PLATFORMS: { id: Platform; label: string; icon: ReactNode }[] = [
  { id: "ios", label: "iOS", icon: <Icon.Apple /> },
  { id: "android", label: "Android", icon: <Icon.Android /> },
  {
    id: "both",
    label: "Both",
    icon: (
      <>
        <Icon.Apple />
        <Icon.Android />
      </>
    ),
  },
];

/** "New app": a required name and the store platform(s) it ships on. */
export function NewAppDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, platform: Platform) => Promise<void> }) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<Platform>("both");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onCreate(name.trim(), platform);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New app" sub="Name the game and pick where it ships. Concepts and builds go inside it." onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <label className="sh-field">
          <span>App name</span>
          <input className="sh-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Puzzle Quest" autoFocus required maxLength={200} />
        </label>
        <div className="sh-field" role="radiogroup" aria-label="Platform">
          <span className="sh-field-label">Platform</span>
          <div className="sh-seg">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={platform === p.id}
                className={`sh-seg-opt${platform === p.id ? " on" : ""}`}
                onClick={() => setPlatform(p.id)}
              >
                {p.icon}
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {err && <p className="sh-modal-err">{err}</p>}
        <div className="sh-modal-foot">
          <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="sh-btn sh-btn-primary" disabled={busy || !name.trim()}>
            {busy ? <span className="sh-spin" /> : "Create app"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A one-field dialog: new concept, new workspace, rename. */
export function NameDialog({
  title,
  sub,
  label,
  initial = "",
  placeholder,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  sub?: ReactNode;
  label: string;
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  onClose: () => void;
  /** resolve to close; throw to show the error */
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);
  const unchanged = !!initial && name.trim() === initial.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    if (unchanged) return onClose();
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(name.trim());
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} sub={sub} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <label className="sh-field">
          <span>{label}</span>
          <input ref={box} className="sh-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} required maxLength={200} />
        </label>
        {err && <p className="sh-modal-err">{err}</p>}
        <div className="sh-modal-foot">
          <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="sh-btn sh-btn-primary" disabled={busy || !name.trim()}>
            {busy ? <span className="sh-spin" /> : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
