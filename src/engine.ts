import '../external/flowshape/src/patterns/index';
import { getPattern, listPatterns, generateSafe, clampParams, type Params } from '../external/flowshape/src/patterns/registry';
import { randomParams } from '../external/flowshape/src/patterns/randomize';
import { mulberry32, deriveSeed } from '../external/flowshape/src/core/prng';
import { el, serialize, type Palette } from '../external/flowshape/src/core/svg';

export { listPatterns, getPattern };
export type { Palette };
export interface CoverConfig {
  pattern: string;
  parameters: Record<string, Params>;
  seedOffset: number;
  variation: number;
  parameterVariation: number;
}
export const DEFAULT_CONFIG: CoverConfig = { pattern: 'truchet', parameters: {}, seedOffset: 0, variation: 0.15, parameterVariation: 0.35 };
export function hash(text: string): number {
  let h = 2166136261;
  for (const byte of new TextEncoder().encode(text)) h = Math.imul(h ^ byte, 16777619);
  return h >>> 0;
}
export function seedFor(uuid: string, offset = 0): number { return hash(`${uuid.toLowerCase()}:${offset}`); }
function parameterVariation(config: CoverConfig): number {
  const value = config.parameterVariation ?? 0;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
export function parametersFor(uuid: string, config: CoverConfig): Params {
  const def = getPattern(config.pattern);
  if (!def) throw new Error(`Unknown pattern: ${config.pattern}`);
  const base = clampParams(def, config.parameters[def.id] || {});
  const amount = parameterVariation(config);
  if (!amount) return base;
  const seed = seedFor(uuid, config.seedOffset);
  const target = randomParams(def, mulberry32(deriveSeed(seed, `${def.id}:parameters`)), base);
  const choose = mulberry32(deriveSeed(seed, `${def.id}:choices`));
  const result = { ...base };
  for (const p of def.params) {
    if (target[p.key] === base[p.key]) continue;
    if (p.kind === 'enum' || p.kind === 'bool') {
      result[p.key] = choose() < amount ? target[p.key]! : base[p.key]!;
    } else {
      const value = base[p.key]! + (target[p.key]! - base[p.key]!) * amount;
      result[p.key] = Math.max(p.min, Math.min(p.max,
        Number((p.min + Math.round((value - p.min) / p.step) * p.step).toFixed(4))));
    }
  }
  return result;
}
export function fingerprint(uuid: string, config: CoverConfig, palette: Palette): string {
  const params = Object.entries(config.parameters[config.pattern] || {}).sort(([a], [b]) => a.localeCompare(b));
  const inputs: unknown[] = [1, uuid, config.pattern, params, config.seedOffset, config.variation, palette];
  const amount = parameterVariation(config);
  if (amount) inputs.push({ parameterVariation: amount });
  return hash(JSON.stringify(inputs)).toString(16);
}
export function renderCover(uuid: string, config: CoverConfig, palette: Palette): string {
  const def = getPattern(config.pattern);
  if (!def) throw new Error(`Unknown pattern: ${config.pattern}`);
  const seed = seedFor(uuid, config.seedOffset);
  const params = parametersFor(uuid, config);
  const size = { w: 480, h: 640 };
  const tree = generateSafe(def, params, seed, size);
  // Some mathematical patterns intentionally ignore their seed. Give their
  // composition a stable UUID-based rotation, too, so each item is distinct.
  const rotation = ((seed / 0x100000000) - 0.5) * 360 * Math.max(0, Math.min(1, config.variation));
  const [paper, ...art] = tree.children;
  tree.children = [paper!, el('g', { transform: `rotate(${rotation} 240 320)` }, art)];
  tree.attrs.width = size.w;
  tree.attrs.height = size.h;
  return serialize(tree, palette);
}

export function isOwnedCover(title: string | undefined, targetUuid: string): boolean {
  return Boolean(title?.startsWith(`Flowshape cover ${targetUuid} [`));
}
export function coverTitle(uuid: string, signature: string): string { return `Flowshape cover ${uuid} [${signature}]`; }
