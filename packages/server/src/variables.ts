/**
 * Dashboard-tunable custom variables (parity gap #11 — the competitor's `[PlayableForgeField]`).
 *
 * A creative carries a *schema* (fields the game declared with `[AdLabField]`, uploaded by the
 * Unity plugin with the compile job) and *values* (what the dashboard set). Values are injected
 * into the runtime shim as `PF.vars` at export time; the Unity runtime applies them to the
 * annotated fields at scene load, so a value change + re-export changes the game without a rebuild.
 * HTML5 playables read `PF.getVar(name, fallback)`; for them the schema may be empty and values
 * free-form.
 */
import type { VariableValues } from "@forge/packager";

export type VarType = "number" | "int" | "bool" | "string";
export interface VariableDef {
  /** stable id, e.g. "TapCubeGame.tapsToWin" */
  key: string;
  displayName?: string;
  section?: string;
  order?: number;
  type: VarType;
  min?: number;
  max?: number;
  step?: number;
  default: number | string | boolean;
}

const KEY = /^[A-Za-z_][\w.\-]{0,63}$/;
const MAX_SCHEMA = 100;
const MAX_VALUES = 200;
const MAX_STRING = 500;
const TYPES: VarType[] = ["number", "int", "bool", "string"];

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Coerce one value to a declared type, clamping numbers to [min, max] and snapping ints. */
export function coerceOne(v: unknown, def: Pick<VariableDef, "type" | "min" | "max">): number | string | boolean | undefined {
  switch (def.type) {
    case "bool":
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") return /^(true|1|yes|on)$/i.test(v.trim());
      return undefined;
    case "string":
      if (v === null || v === undefined) return undefined;
      return String(v).slice(0, MAX_STRING);
    case "int":
    case "number": {
      let n = num(v);
      if (n === undefined) return undefined;
      if (def.min !== undefined) n = Math.max(def.min, n);
      if (def.max !== undefined) n = Math.min(def.max, n);
      return def.type === "int" ? Math.round(n) : n;
    }
  }
}

/** Validate a schema uploaded by the plugin (or edited in the dashboard). Throws on malformed input. */
export function normalizeSchema(raw: unknown): VariableDef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("variableSchema must be an array");
  if (raw.length > MAX_SCHEMA) throw new Error(`variableSchema: at most ${MAX_SCHEMA} fields`);
  const out: VariableDef[] = [];
  const seen = new Set<string>();
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== "object") throw new Error("variableSchema: each entry must be an object");
    const key = String(item.key ?? "");
    if (!KEY.test(key)) throw new Error(`variableSchema: bad key "${key}"`);
    if (seen.has(key)) throw new Error(`variableSchema: duplicate key "${key}"`);
    seen.add(key);
    const type = String(item.type ?? "number") as VarType;
    if (!TYPES.includes(type)) throw new Error(`variableSchema: bad type "${type}" for ${key}`);
    const def: VariableDef = { key, type, default: type === "bool" ? false : type === "string" ? "" : 0 };
    if (item.displayName) def.displayName = String(item.displayName).slice(0, 80);
    if (item.section) def.section = String(item.section).slice(0, 80);
    const order = num(item.order);
    if (order !== undefined) def.order = order;
    if (type === "number" || type === "int") {
      const min = num(item.min);
      const max = num(item.max);
      const step = num(item.step);
      // the plugin sends float.MinValue/MaxValue for "unbounded" — treat ±1e30 and beyond as none
      if (min !== undefined && Math.abs(min) < 1e30) def.min = min;
      if (max !== undefined && Math.abs(max) < 1e30) def.max = max;
      if (step !== undefined && step > 0) def.step = step;
      if (def.min !== undefined && def.max !== undefined && def.min > def.max) [def.min, def.max] = [def.max, def.min];
    }
    const d = coerceOne(item.default, def);
    if (d !== undefined) def.default = d;
    out.push(def);
  }
  return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key));
}

export function defaultsOf(schema: VariableDef[]): VariableValues {
  const v: VariableValues = {};
  for (const d of schema) v[d.key] = d.default;
  return v;
}

/**
 * Merge a dashboard edit into stored values: schema keys are coerced to their type and clamped;
 * unknown keys are accepted free-form (number / string / bool); `null` removes a free-form key.
 */
export function mergeValues(raw: unknown, schema: VariableDef[], base: VariableValues = {}): VariableValues {
  if (raw === undefined || raw === null) return { ...base };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("variables must be an object of key → value");
  const byKey = new Map(schema.map((d) => [d.key, d]));
  const out: VariableValues = { ...base };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY.test(key)) throw new Error(`variables: bad key "${key}"`);
    const def = byKey.get(key);
    if (def) {
      const c = coerceOne(value, def);
      if (c === undefined) throw new Error(`variables: "${key}" expects ${def.type}`);
      out[key] = c;
      continue;
    }
    if (value === null) {
      delete out[key];
      continue;
    }
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else throw new Error(`variables: "${key}" must be a number, string or boolean`);
  }
  if (Object.keys(out).length > MAX_VALUES) throw new Error(`variables: at most ${MAX_VALUES} keys`);
  return out;
}
