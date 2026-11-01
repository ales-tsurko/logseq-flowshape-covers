import { DEFAULT_CONFIG, getPattern, type CoverConfig } from './engine';

export interface TagInfo { id: number; uuid: string; name: string }
export interface TagRule {
  graph: string;
  tagUuid: string;
  tagName: string;
  enabled: boolean;
  descendants: boolean;
  config: CoverConfig;
  header: { enabled: boolean; height: number };
}
export interface RuleMatch { rule: TagRule; distance: number; priority: number }
export const graphName = (name: string) => name.replace(/^logseq_db_/, '');
const bounded = (value: unknown, fallback: number, low: number, high: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
};
export function normalizeConfig(value: Partial<CoverConfig> = {}): CoverConfig {
  value = value || {};
  return {
    pattern: getPattern(value.pattern || '') ? value.pattern! : DEFAULT_CONFIG.pattern,
    parameters: structuredClone(value.parameters || {}),
    seedOffset: Math.trunc(bounded(value.seedOffset, 0, -2147483648, 2147483647)),
    variation: bounded(value.variation, DEFAULT_CONFIG.variation, 0, 1),
    parameterVariation: bounded(value.parameterVariation, 0, 0, 1),
  };
}
export function newRule(graph: string, tag: TagInfo, config = DEFAULT_CONFIG): TagRule {
  return { graph: graphName(graph), tagUuid: tag.uuid, tagName: tag.name, enabled: true,
    descendants: false, config: normalizeConfig(config), header: { enabled: false, height: 200 } };
}
export function normalizeRules(value: unknown): TagRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(raw => {
    if (!raw || typeof raw.graph !== 'string' || typeof raw.tagUuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(raw.tagUuid)) return [];
    const key = `${graphName(raw.graph)}:${raw.tagUuid}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ graph: graphName(raw.graph), tagUuid: raw.tagUuid, tagName: String(raw.tagName || raw.tagUuid),
      enabled: raw.enabled !== false, descendants: raw.descendants === true, config: normalizeConfig(raw.config),
      header: { enabled: raw.header?.enabled === true, height: Math.round(bounded(raw.header?.height, 200, 60, 800)) } }];
  });
}
export function rulesForGraph(rules: TagRule[], graph: string): TagRule[] {
  return rules.filter(rule => rule.graph === graphName(graph));
}
export function migrateLegacyRules(settings: any, graph: string, tags: TagInfo[]): TagRule[] | null {
  if (Array.isArray(settings?.rules)) return null;
  const graphs = String(settings?.graphs || '').split(',').map((s: string) => graphName(s.trim()));
  if (!settings?.config || !graphs.includes(graphName(graph))) return [];
  // Migration only. Fresh installations never opt any tag in.
  return tags.filter(tag => ['project', 'idea'].includes(tag.name.toLowerCase()))
    .sort((a, b) => Number(b.name.toLowerCase() === 'project') - Number(a.name.toLowerCase() === 'project'))
    .map(tag => ({ ...newRule(graph, tag, settings.config), descendants: true }));
}
function before(a: RuleMatch, b: RuleMatch) { return a.distance < b.distance || (a.distance === b.distance && a.priority < b.priority); }
export function resolveRules(rules: TagRule[], tags: TagInfo[], parents: Array<[number, number]>): Map<number, RuleMatch> {
  const ids = new Map(tags.map(tag => [tag.uuid, tag.id]));
  const children = new Map<number, number[]>();
  for (const [child, parent] of parents) children.set(parent, [...(children.get(parent) || []), child]);
  const matches = new Map<number, RuleMatch>();
  rules.forEach((rule, priority) => {
    const root = ids.get(rule.tagUuid);
    if (root === undefined) return;
    const queue: Array<[number, number]> = [[root, 0]];
    const visited = new Set<number>();
    for (let i = 0; i < queue.length; i++) {
      const [id, distance] = queue[i]!;
      if (visited.has(id)) continue;
      visited.add(id);
      const candidate = { rule, distance, priority };
      if (!matches.has(id) || before(candidate, matches.get(id)!)) matches.set(id, candidate);
      if (rule.descendants) for (const child of children.get(id) || []) queue.push([child, distance + 1]);
    }
  });
  return matches;
}
export function matchRule(tagIds: number[], matches: Map<number, RuleMatch>): TagRule | undefined {
  let best: RuleMatch | undefined;
  for (const id of tagIds) {
    const candidate = matches.get(id);
    if (candidate && (!best || before(candidate, best))) best = candidate;
  }
  return best?.rule.enabled ? best.rule : undefined;
}
