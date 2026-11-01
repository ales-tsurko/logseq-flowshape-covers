import type { SvgNode } from '../core/svg';
import { el } from '../core/svg';
import { RESERVED } from '../core/reserved';

export type Family = 'points' | 'curves' | 'fields' | 'tilings' | 'growth' | 'isometric';

export interface ParamDef {
  key: string;
  kind: 'int' | 'float' | 'bool' | 'enum';
  min: number;
  max: number;
  step: number;
  default: number;
  label: string; // i18n key
  /** enum only: option labels (i18n keys); value is the index. */
  options?: string[];
  /** Not shown in the playground controls (engine-owned params like `phase`). */
  hidden?: boolean;
  /**
   * This param only reaches the drawing when `key`'s current value is one of
   * `values`; under any other value `generate` never reads it. The playground
   * dims and disables the row instead of offering a control that does nothing.
   *
   * `key` must name an enum or bool param of the same pattern. The claim is
   * not documentation — `tests/patterns/all.test.ts` renders each excluded
   * gate value and fails if the param turns out to have an effect there, so
   * the annotation cannot quietly drift away from the generator.
   */
  dependsOn?: { key: string; values: number[] };
}

export type Params = Record<string, number>;
export interface Size { w: number; h: number }

export interface PatternDef {
  id: string;
  family: Family;
  phase: 1 | 2;
  heavy: boolean;
  params: ParamDef[];
  /** Show the seed control; set when generate actually consumes the seed. */
  usesSeed?: boolean;
  /** Animation metadata (Part 4). `continuous` lists param keys whose visual
   *  effect varies continuously — safe for per-frame audio modulation.
   *  `usesPhase` opts into the injected `phase` param for intrinsic motion. */
  anim?: { continuous?: string[]; usesPhase?: boolean };
  /** Pure and deterministic: same inputs ⇒ identical tree. Colors as role tokens. */
  generate(params: Params, seed: number, size: Size): SvgNode;
}

/** Injected into every pattern: scales the artwork within the frame. */
export const SIZE_PARAM: ParamDef = {
  key: 'size', kind: 'float', min: 0.2, max: 1.6, step: 0.01, default: 1, label: 'common.size',
};

/** Injected for `anim.usesPhase` patterns: engine-owned time axis in [0,1). */
export const PHASE_PARAM: ParamDef = {
  key: 'phase', kind: 'float', min: 0, max: 1, step: 0.0001, default: 0, label: 'common.phase', hidden: true,
};

const registry = new Map<string, PatternDef>();

export function definePattern(def: PatternDef): PatternDef {
  if (registry.has(def.id)) throw new Error(`duplicate pattern id: ${def.id}`);
  for (const p of def.params) {
    if (RESERVED.has(p.key)) throw new Error(`param key '${p.key}' is reserved (pattern ${def.id})`);
    // SIZE_PARAM/PHASE_PARAM are injected params, not RESERVED app-shell URL
    // keys — the two concepts are mutually exclusive by construction (see
    // src/core/reserved.ts). A pattern still can't declare its own
    // conflicting entry, so that's guarded here instead.
    if (p.key === SIZE_PARAM.key || p.key === PHASE_PARAM.key) {
      throw new Error(`param key '${p.key}' is reserved (pattern ${def.id})`);
    }
  }
  for (const p of def.params) {
    if (!p.dependsOn) continue;
    const gate = def.params.find((g) => g.key === p.dependsOn!.key);
    if (!gate || (gate.kind !== 'enum' && gate.kind !== 'bool')) {
      throw new Error(`dependsOn key '${p.dependsOn.key}' is not an enum/bool param (pattern ${def.id}.${p.key})`);
    }
    if (p.dependsOn.values.length === 0) {
      throw new Error(`dependsOn on '${p.key}' lists no values (pattern ${def.id})`);
    }
    for (const v of p.dependsOn.values) {
      if (v < gate.min || v > gate.max) {
        throw new Error(`dependsOn value ${v} is outside '${gate.key}' range (pattern ${def.id}.${p.key})`);
      }
    }
  }
  if (def.anim?.continuous) {
    for (const key of def.anim.continuous) {
      const pd = def.params.find((p) => p.key === key) ?? (key === SIZE_PARAM.key ? SIZE_PARAM : undefined);
      if (!pd || (pd.kind !== 'float' && pd.kind !== 'int')) {
        throw new Error(`anim.continuous key '${key}' is not a numeric param (pattern ${def.id})`);
      }
    }
  }
  // Build a new params array with fresh copies of the injected params:
  // pushing the shared SIZE_PARAM/PHASE_PARAM objects themselves would let
  // every pattern's entry alias the same object, so mutating one (e.g.
  // clampParams touching it) would mutate all of them. Also avoids
  // mutating the caller's array.
  const extra: ParamDef[] = [{ ...SIZE_PARAM }];
  if (def.anim?.usesPhase) extra.push({ ...PHASE_PARAM });
  const withSize: PatternDef = { ...def, params: [...def.params, ...extra] };
  registry.set(withSize.id, withSize);
  return withSize;
}

export function getPattern(id: string): PatternDef | undefined {
  return registry.get(id);
}

export function listPatterns(): PatternDef[] {
  return [...registry.values()];
}

export function defaultParams(def: PatternDef): Params {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/** Clamp arbitrary (URL-supplied) values into the param's legal range. */
export function clampParams(def: PatternDef, raw: Params): Params {
  const out: Params = {};
  for (const p of def.params) {
    let v = raw[p.key];
    if (v === undefined || Number.isNaN(v)) v = p.default;
    v = Math.min(p.max, Math.max(p.min, v));
    if (p.kind === 'int') v = Math.round(v);
    if (p.kind === 'bool') v = v >= 0.5 ? 1 : 0;
    if (p.kind === 'enum') v = Math.round(Math.min(p.max, Math.max(p.min, v)));
    out[p.key] = v;
  }
  return out;
}

/** The only sanctioned way to run a pattern: clamps raw (URL/worker) params first. */
export function generateSafe(
  def: PatternDef,
  raw: Params,
  seed: number,
  size: Size,
): SvgNode {
  const clamped = clampParams(def, { ...defaultParams(def), ...raw });
  const { size: s = 1, ...rest } = clamped;
  const node = def.generate(rest, seed, size);
  const paperRect = el('rect', { x: 0, y: 0, width: size.w, height: size.h, fill: 'paper' });
  if (s === 1) {
    return { ...node, children: [paperRect, ...node.children] };
  }
  const cx = size.w / 2, cy = size.h / 2;
  return {
    ...node,
    children: [
      paperRect,
      el('g', { transform: `translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})` }, node.children),
    ],
  };
}
