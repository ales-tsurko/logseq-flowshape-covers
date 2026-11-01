import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, renderCover, parametersFor, seedFor, fingerprint, isOwnedCover, coverTitle, listPatterns } from '../src/engine';
import { createCoverAsset } from '../src/assets';
import { shouldScan } from '../src/events';
import { snapshotKey } from '../src/snapshot';

const uuid = '86990ebb-85e4-5ff0-96fe-fc95cc9b7a05';
const pal = { paper: '#1a1a1a', ink: '#d0d0d0', accent: '#9aa6ad' };
test('fallback snapshot ignores ordering and detects tag and Cover reference changes', () => {
  assert.equal(snapshotKey([[1, 10], [2, 20]]), snapshotKey([[2, 20], [1, 10]]));
  assert.notEqual(snapshotKey([[1, 10]]), snapshotKey([[1, 10], [2, 0]]));
  assert.notEqual(snapshotKey([[1, 10]]), snapshotKey([[1, 20]]));
});
test('DB change events with empty txData still trigger a scan', () => {
  assert.equal(shouldScan({ txData: [] }), true);
  assert.equal(shouldScan({}), true);
  assert.equal(shouldScan({ txData: [[1, 'block/tags', 2]] }), true);
  assert.equal(shouldScan({ txData: [[1, 'block/title', 'ordinary text']] }), false);
});
test('UUID-based covers remain stable and different UUIDs have different geometry', () => {
  const a = renderCover(uuid, DEFAULT_CONFIG, pal);
  assert.equal(a, renderCover(uuid, DEFAULT_CONFIG, pal));
  assert.notEqual(a, renderCover('b8466ada-3750-462f-a4c5-8ea70fbb91eb', DEFAULT_CONFIG, pal));
  assert.equal(seedFor(uuid), seedFor(uuid.toUpperCase()));
  assert.notEqual(seedFor(uuid), seedFor(uuid, 1));
});
test('theme changes update colors without changing the geometry', () => {
  const light = { paper: '#f5f4f0', ink: '#222222', accent: '#506070' };
  const a = renderCover(uuid, DEFAULT_CONFIG, pal);
  const b = renderCover(uuid, DEFAULT_CONFIG, light);
  assert.notEqual(fingerprint(uuid, DEFAULT_CONFIG, pal), fingerprint(uuid, DEFAULT_CONFIG, light));
  assert.equal(a.replace(/#[0-9a-f]{6}/g, '#COLOR'), b.replace(/#[0-9a-f]{6}/g, '#COLOR'));
});
test('parameters and seed offset invalidate the cached cover', () => {
  const changed = { ...DEFAULT_CONFIG, seedOffset: 1 };
  assert.notEqual(fingerprint(uuid, DEFAULT_CONFIG, pal), fingerprint(uuid, changed, pal));
  const fixed = { ...DEFAULT_CONFIG, parameterVariation: 0 };
  const params = { ...fixed, parameters: { truchet: { variant: 1 } } };
  assert.notEqual(renderCover(uuid, fixed, pal), renderCover(uuid, params, pal));
  assert.notEqual(fingerprint(uuid, DEFAULT_CONFIG, pal), fingerprint(uuid, { ...DEFAULT_CONFIG, parameterVariation: 0.75 }, pal));
});
test('parameter variation gives seedless patterns stable, distinct shapes without rotation', () => {
  const other = 'b8466ada-3750-462f-a4c5-8ea70fbb91eb';
  const config = { ...DEFAULT_CONFIG, pattern: 'bands', variation: 0, parameterVariation: 0 };
  assert.equal(renderCover(uuid, config, pal), renderCover(other, config, pal));
  config.parameterVariation = 0.5;
  const before = structuredClone(config);
  const svg = renderCover(uuid, config, pal);
  assert.equal(svg, renderCover(uuid, config, pal));
  assert.equal(svg, renderCover(uuid.toUpperCase(), config, pal));
  assert.notEqual(svg, renderCover(other, config, pal));
  assert.notDeepEqual(parametersFor(uuid, config), parametersFor(uuid, { ...config, seedOffset: 1 }));
  assert.deepEqual(config, before);
});
test('parameter variation preserves cosmetic and hidden controls across all algorithms', () => {
  for (const def of listPatterns()) {
    const fixed = Object.fromEntries(def.params.filter(p => p.hidden || ['strokeWidth', 'opacity', 'size'].includes(p.key))
      .map(p => [p.key, p.min]));
    const config = { ...DEFAULT_CONFIG, pattern: def.id, parameterVariation: 1, parameters: { [def.id]: fixed } };
    const params = parametersFor(uuid, config);
    for (const [key, value] of Object.entries(fixed)) assert.equal(params[key], value, `${def.id}.${key}`);
    for (const p of def.params) {
      assert.ok(Number.isFinite(params[p.key]), `${def.id}.${p.key}`);
      assert.ok(params[p.key]! >= p.min && params[p.key]! <= p.max, `${def.id}.${p.key}`);
      if (p.kind !== 'float') assert.equal(params[p.key], Math.round(params[p.key]!), `${def.id}.${p.key}`);
    }
  }
});
test('manual covers and other projects’ covers are never considered owned', () => {
  assert.equal(isOwnedCover('My cover', uuid), false);
  assert.equal(isOwnedCover(coverTitle(uuid, 'abc'), uuid), true);
  assert.equal(isOwnedCover(coverTitle('another-id', 'abc'), uuid), false);
});
test('all 40 algorithms produce finite, self-contained SVGs', { timeout: 60000 }, () => {
  assert.equal(listPatterns().length, 40);
  for (const def of listPatterns()) for (const parameterVariation of [0, 0.5, 1]) {
    const svg = renderCover(uuid, { ...DEFAULT_CONFIG, pattern: def.id, parameterVariation }, pal);
    assert.match(svg, /^<svg/);
    assert.match(svg, /width="480"/);
    assert.match(svg, /height="640"/);
    assert.doesNotMatch(svg, /NaN|Infinity|<script|https?:\/\/(?!www\.w3\.org)/, def.id);
  }
});
test('asset creation uses graph asset storage and qualified native property names', async () => {
  const calls: Array<[string, ...any[]]> = [];
  const api = {
    App: { writeAssetsdirFile: async (...args: any[]) => { calls.push(['write', ...args]); return '/assets/test.svg'; } },
    Editor: {
      newBlockUUID: async () => 'b8466ada-3750-462f-a4c5-8ea70fbb91eb',
      insertBlock: async (...args: any[]) => { calls.push(['insert', ...args]); return { id: 123 }; },
      addBlockTag: async (...args: any[]) => { calls.push(['tag', ...args]); },
    },
  };
  const asset = await createCoverAsset(api, 'asset-tag', uuid, 'abc', '<svg/>', async () => {});
  assert.equal(asset.id, 123);
  assert.equal(calls[0]![1], 'b8466ada-3750-462f-a4c5-8ea70fbb91eb.svg');
  const metadata = calls[1]![3].properties;
  assert.equal(metadata['logseq.property.asset/type'], 'svg');
  assert.equal(metadata['logseq.property.asset/size'], 6);
  assert.match(metadata['logseq.property.asset/checksum'], /^[a-f0-9]{64}$/);
  assert.equal(calls[2]![0], 'tag');
});
test('graph switch prevents any asset write', async () => {
  await assert.rejects(createCoverAsset({}, '', uuid, 'abc', '<svg/>', async () => { throw new Error('Graph changed'); }), /Graph changed/);
});
