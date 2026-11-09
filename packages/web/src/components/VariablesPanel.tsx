import { useEffect, useState } from "react";
import { updateCreative } from "../api";
import type { VariableDef, VariableValues } from "../types";
import { Icon } from "./icons";

/**
 * Dashboard-tunable custom variables for one creative: fields the game declared with
 * `[AdLabField]` (typed, with ranges) plus free-form key/values any HTML5 playable can read
 * through `PF.getVar(name, fallback)`. Saved values are injected into the next export.
 */
export function VariablesPanel({
  creativeId,
  schema,
  values,
  readOnly,
  onSaved,
}: {
  creativeId: string;
  schema: VariableDef[];
  values: VariableValues;
  readOnly?: boolean;
  onSaved: (v: VariableValues) => void;
}) {
  const [draft, setDraft] = useState<VariableValues>(values);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => setDraft(values), [values]);

  const schemaKeys = new Set(schema.map((d) => d.key));
  const freeKeys = Object.keys(draft).filter((k) => !schemaKeys.has(k)).sort();
  const dirty = JSON.stringify(draft) !== JSON.stringify(values);
  const sections = [...new Set(schema.map((d) => d.section || ""))];

  function set(key: string, v: number | string | boolean) {
    setDraft((d) => ({ ...d, [key]: v }));
  }
  function remove(key: string) {
    setDraft((d) => {
      const n = { ...d };
      delete n[key];
      return n;
    });
  }
  function addFree() {
    const k = newKey.trim();
    if (!/^[A-Za-z_][\w.\-]{0,63}$/.test(k)) {
      setErr("Key: letters, digits, _ . - (start with a letter)");
      return;
    }
    const raw = newVal.trim();
    const v: number | string | boolean = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    set(k, v);
    setNewKey("");
    setNewVal("");
    setErr(null);
  }
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // removed free-form keys are sent as null so the server drops them
      const patch: Record<string, number | string | boolean | null> = { ...draft };
      for (const k of Object.keys(values)) if (!(k in draft)) patch[k] = null;
      const r = await updateCreative(creativeId, { variables: patch });
      onSaved(r.variables ?? {});
      setSavedAt(Date.now());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (schema.length === 0 && freeKeys.length === 0 && readOnly) return null;

  return (
    <div className="sh-card">
      <div className="sh-card-h">
        <span className="sh-card-t">Variables</span>
        {savedAt && !dirty && <span style={{ fontSize: 11.5, color: "var(--signal)", fontWeight: 500 }}>Saved · re-export to apply</span>}
      </div>

      {schema.length === 0 && freeKeys.length === 0 && (
        <p className="sh-note" style={{ marginBottom: 10 }}>
          No variables declared. In Unity mark fields with <code>[AdLabField]</code>; HTML5 playables read <code>PF.getVar("key", fallback)</code>.
        </p>
      )}

      {sections.map((sec) => (
        <div key={sec || "_"} style={{ marginBottom: 8 }}>
          {sec && <div className="sh-var-sec">{sec}</div>}
          <div style={{ display: "grid", gap: 6 }}>
            {schema
              .filter((d) => (d.section || "") === sec)
              .map((d) => (
                <VarRow key={d.key} def={d} value={draft[d.key] ?? d.default} readOnly={!!readOnly} onChange={(v) => set(d.key, v)} />
              ))}
          </div>
        </div>
      ))}

      {freeKeys.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          {freeKeys.map((k) => (
            <div key={k} className="sh-var-row">
              <span className="sh-var-k" title={k}>
                {k}
              </span>
              <input
                className={inputCls}
                disabled={readOnly}
                value={String(draft[k])}
                aria-label={k}
                onChange={(e) => {
                  const raw = e.target.value;
                  set(k, raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw);
                }}
              />
              {!readOnly && (
                <button type="button" onClick={() => remove(k)} className="sh-icon-btn" title="Remove" aria-label={`Remove ${k}`}>
                  <Icon.X />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          <div className="sh-var-row" style={{ marginTop: 6 }}>
            <input className={inputCls} style={{ width: 112, flex: "none" }} placeholder="new.key" aria-label="New variable key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            <input
              className={inputCls}
              placeholder="value"
              aria-label="New variable value"
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFree()}
            />
            <button type="button" onClick={addFree} className="sh-icon-btn" title="Add variable" aria-label="Add variable">
              <Icon.Plus />
            </button>
          </div>
          {err && <div className="sh-modal-err">{err}</div>}
          <button type="button" onClick={() => void save()} disabled={busy || !dirty} className="sh-btn sh-btn-ghost sh-btn-sm sh-btn-block" style={{ marginTop: 12 }}>
            {busy ? "Saving…" : dirty ? "Save variables" : "Saved"}
          </button>
        </>
      )}
    </div>
  );
}

function VarRow({ def, value, readOnly, onChange }: { def: VariableDef; value: number | string | boolean; readOnly: boolean; onChange: (v: number | string | boolean) => void }) {
  const label = def.displayName || def.key.split(".").pop() || def.key;
  const numeric = def.type === "number" || def.type === "int";
  return (
    <div className="sh-var-row">
      <span className="sh-var-k" title={def.key}>
        {label}
      </span>
      {def.type === "bool" ? (
        <input type="checkbox" disabled={readOnly} checked={!!value} onChange={(e) => onChange(e.target.checked)} className="sh-check" aria-label={label} />
      ) : numeric && def.min !== undefined && def.max !== undefined ? (
        <>
          <input
            type="range"
            disabled={readOnly}
            min={def.min}
            max={def.max}
            step={def.step ?? (def.type === "int" ? 1 : (def.max - def.min) / 100)}
            value={Number(value)}
            onChange={(e) => onChange(def.type === "int" ? Math.round(Number(e.target.value)) : Number(e.target.value))}
            className="sh-range"
            aria-label={label}
          />
          <span style={{ width: 44, flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>{Number(value)}</span>
        </>
      ) : (
        <input
          className={inputCls}
          disabled={readOnly}
          type={numeric ? "number" : "text"}
          step={numeric ? def.step ?? (def.type === "int" ? 1 : "any") : undefined}
          min={def.min}
          max={def.max}
          value={String(value)}
          aria-label={label}
          onChange={(e) => onChange(numeric ? Number(e.target.value) : e.target.value)}
        />
      )}
    </div>
  );
}

const inputCls = "sh-input sm min-w-0 flex-1";
