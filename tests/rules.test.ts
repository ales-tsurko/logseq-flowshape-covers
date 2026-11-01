import test from 'node:test';
import assert from 'node:assert/strict';
import { newRule, normalizeRules, rulesForGraph, migrateLegacyRules, resolveRules, matchRule, type TagInfo } from '../src/rules';
import { DEFAULT_CONFIG, fingerprint } from '../src/engine';
import { snapshotKey } from '../src/snapshot';
import { PageHeaders } from '../src/headers';

const tags: TagInfo[] = [
  { id: 1, uuid: '00000000-0000-4000-8000-000000000001', name: 'project' },
  { id: 2, uuid: '00000000-0000-4000-8000-000000000002', name: 'idea' },
  { id: 3, uuid: '00000000-0000-4000-8000-000000000003', name: 'music' },
];
test('fresh installs and explicit empty settings never opt in project or idea', () => {
  assert.deepEqual(normalizeRules(undefined), []);
  assert.deepEqual(migrateLegacyRules({}, 'kbase', tags), []);
  assert.equal(migrateLegacyRules({ rules: [], config: DEFAULT_CONFIG, graphs: 'kbase' }, 'kbase', tags), null);
  assert.equal(matchRule([1, 2], resolveRules([], tags, [])), undefined);
});
test('migration preserves the selected algorithm as separate UUID-based rules', () => {
  const config = { ...DEFAULT_CONFIG, pattern: 'delaunay', parameters: { delaunay: { points: 440 } } };
  const rules = migrateLegacyRules({ config, graphs: 'kbase' }, 'logseq_db_kbase', tags)!;
  assert.deepEqual(rules.map(r => r.tagName), ['project', 'idea']);
  assert.ok(rules.every(r => r.config.pattern === 'delaunay' && !r.header.enabled));
  rules[0]!.config.parameters.delaunay!.points = 800;
  assert.equal(rules[1]!.config.parameters.delaunay!.points, 440);
});
test('only opted-in tags match and graph settings are isolated', () => {
  const rule = newRule('kbase', tags[2]!);
  const matches = resolveRules(rulesForGraph([rule], 'logseq_db_kbase'), tags, []);
  assert.equal(matchRule([1, 2], matches), undefined);
  assert.equal(matchRule([3], matches), rule);
  assert.deepEqual(rulesForGraph([rule], 'another graph'), []);
  assert.equal(matchRule([3], resolveRules([rule], tags.map(t => ({ ...t, name: 'renamed' })), [])), rule);
});
test('direct matches override inherited settings and ties use rule order', () => {
  const parent = { ...newRule('kbase', tags[0]!), descendants: true };
  const child = newRule('kbase', tags[2]!);
  child.config.pattern = 'phyllotaxis';
  const matches = resolveRules([parent, child], tags, [[3, 1]]);
  assert.equal(matchRule([3], matches), child);
  assert.equal(matchRule([1, 3], matches), parent);
  assert.equal(matchRule([3, 1], matches), parent);
  child.enabled = false;
  assert.equal(matchRule([3], resolveRules([parent, child], tags, [[3, 1]])), undefined);
});
test('inheritance is opt-in, cycle-safe and nearest configured ancestor wins', () => {
  const parent = newRule('kbase', tags[0]!);
  assert.equal(matchRule([3], resolveRules([parent], tags, [[3, 1]])), undefined);
  parent.descendants = true;
  assert.equal(matchRule([3], resolveRules([parent], tags, [[3, 1], [1, 3]])), parent);
  const nearer = { ...newRule('kbase', tags[1]!), descendants: true };
  assert.equal(matchRule([3], resolveRules([parent, nearer], tags, [[2, 1], [3, 2]])), nearer);
});
test('header settings are per rule and never change an image fingerprint', () => {
  const rule = newRule('kbase', tags[0]!);
  const colors = { paper: '#000000', ink: '#ffffff', accent: '#aaaaaa' };
  const before = fingerprint(tags[0]!.uuid, rule.config, colors);
  rule.header = { enabled: true, height: 320 };
  assert.equal(fingerprint(tags[0]!.uuid, rule.config, colors), before);
  const normalized = normalizeRules([{ ...rule, header: { enabled: true, height: 99999 } }]);
  assert.equal(normalized[0]!.header.height, 800);
});
test('fallback notices switching between configured tags even with the same Cover', () => {
  assert.notEqual(snapshotKey([[10, 1, 100]]), snapshotKey([[10, 2, 100]]));
  assert.equal(snapshotKey([[10, 2, 100], [10, 1, 100]]), snapshotKey([[10, 1, 100], [10, 2, 100]]));
});
test('page header reuses the Cover asset and removes itself when disabled or on another page', async () => {
  const calls: any[] = [];
  let page = tags[0]!.uuid;
  const api = {
    App: { getCurrentGraph: async () => ({ name: 'kbase' }), makeAssetUrl: async (path: string) => `assets://graph${path}` },
    Editor: { getCurrentPage: async () => ({ uuid: page }) },
    UI: { queryElementById: async () => false, queryElementRect: async () => ({ width: 900 }) },
    provideUI: (ui: any) => calls.push(ui),
  };
  const rule = newRule('kbase', tags[0]!); rule.header = { enabled: true, height: 240 };
  const headers = new PageHeaders(api);
  headers.setContext('kbase', new Map([[page, { rule, cover: { uuid: tags[2]!.uuid, type: 'svg' } }]]));
  await headers.refresh();
  assert.equal(calls.at(-1).style.height, '240px');
  assert.match(calls.at(-1).template, new RegExp(`${tags[2]!.uuid}.svg`));
  headers.setContext('kbase', new Map([[page, { rule, cover: { uuid: tags[2]!.uuid, type: 'pdf' } }]]));
  await headers.refresh();
  assert.equal(calls.at(-1).template, null);
  headers.setContext('kbase', new Map([[page, { rule, cover: { uuid: tags[2]!.uuid, type: 'svg' } }]]));
  await headers.refresh();
  page = tags[1]!.uuid;
  await headers.refresh();
  assert.equal(calls.at(-1).template, null);
  page = tags[0]!.uuid; rule.header.enabled = false;
  await headers.refresh();
  assert.equal(calls.filter(c => c.template).length, 2);
});
test('a delayed asset URL cannot restore a header after navigation', async () => {
  const calls: any[] = [];
  let resolveUrl!: (url: string) => void;
  let requested!: () => void;
  const waiting = new Promise<void>(resolve => { requested = resolve; });
  const rule = newRule('kbase', tags[0]!); rule.header.enabled = true;
  const api = {
    App: { getCurrentGraph: async () => ({ name: 'kbase' }), makeAssetUrl: () => { requested(); return new Promise<string>(resolve => { resolveUrl = resolve; }); } },
    Editor: { getCurrentPage: async () => ({ uuid: tags[0]!.uuid }) },
    UI: { queryElementById: async () => false, queryElementRect: async () => ({ width: 900 }) },
    provideUI: (ui: any) => calls.push(ui),
  };
  const headers = new PageHeaders(api);
  headers.setContext('kbase', new Map([[tags[0]!.uuid, { rule, cover: { uuid: tags[2]!.uuid, type: 'svg' } }]]));
  const pending = headers.refresh(); await waiting;
  headers.clear(); resolveUrl('assets://old.svg'); await pending;
  assert.ok(calls.every(c => !c.template));
});
