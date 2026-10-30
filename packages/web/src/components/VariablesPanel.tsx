import { useEffect, useState } from "react";
import { updateCreative } from "../api";
import type { VariableDef, VariableValues } from "../types";

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
    <div className="mt-4 rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Variables</h3>
        {savedAt && !dirty && <span className="text-[11px] text-[#a3d977]">saved · re-export to apply</span>}
      </div>

      {schema.length === 0 && freeKeys.length === 0 && (
        <p className="mb-2 text-xs text-slate-500">
          No variables declared. In Unity mark fields with <code className="text-slate-300">[AdLabField]</code>; HTML5 playables read{" "}
          <code className="text-slate-300">PF.getVar("key", fallback)</code>.
        </p>
      )}

      {sections.map((sec) => (
        <div key={sec || "_"} className="mb-2">
          {sec && <div className="mb-1 text-[11px] font-medium text-amber-300/80">{sec}</div>}
          <div className="grid gap-1.5">
            {schema
              .filter((d) => (d.section || "") === sec)
              .map((d) => (
                <VarRow key={d.key} def={d} value={draft[d.key] ?? d.default} readOnly={!!readOnly} onChange={(v) => set(d.key, v)} />
              ))}
          </div>
        </div>
      ))}

      {freeKeys.length > 0 && (
        <div className="mb-2 grid gap-1.5">
          {freeKeys.map((k) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className="w-36 shrink-0 truncate text-slate-300" title={k}>
                {k}
              </span>
              <input
                className={inputCls}
                disabled={readOnly}
                value={String(draft[k])}
                onChange={(e) => {
                  const raw = e.target.value;
                  set(k, raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw);
                }}
              />
              {!readOnly && (
                <button onClick={() => remove(k)} className="text-xs text-red-400 hover:underline" title="Remove">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          <div className="mt-2 flex items-center gap-2">
            <input className={`${inputCls} w-36`} placeholder="new.key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            <input className={inputCls} placeholder="value" value={newVal} onChange={(e) => setNewVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFree()} />
            <button onClick={addFree} className="rounded-md bg-[#123f2d] px-2.5 py-1.5 text-sm text-slate-200 hover:bg-[#1a5a40]">
              +
            </button>
          </div>
          {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
          <button
            onClick={() => void save()}
            disabled={busy || !dirty}
            className="mt-3 w-full rounded-lg border border-amber-500/60 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
          >
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
    <div className="flex items-center gap-2 text-sm">
      <span className="w-36 shrink-0 truncate text-slate-300" title={def.key}>
        {label}
      </span>
      {def.type === "bool" ? (
        <input type="checkbox" disabled={readOnly} checked={!!value} onChange={(e) => onChange(e.target.checked)} className="accent-amber-500" />
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
            className="flex-1 accent-amber-500"
          />
          <span className="w-14 shrink-0 text-right tabular-nums text-slate-200">{Number(value)}</span>
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
          onChange={(e) => onChange(numeric ? Number(e.target.value) : e.target.value)}
        />
      )}
    </div>
  );
}

const inputCls = "min-w-0 flex-1 rounded-md border border-[#1f6b4a] bg-[#0a3a28] px-2 py-1 text-sm text-slate-100 outline-none focus:border-amber-500 disabled:opacity-60";
