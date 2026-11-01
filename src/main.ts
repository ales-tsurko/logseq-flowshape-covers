declare const logseq: any;
declare const WORKER_FILE: string;
import { fingerprint, isOwnedCover, coverTitle, type CoverConfig, type Palette } from './engine';
import { createCoverAsset } from './assets';
import { shouldScan } from './events';
import { snapshotKey } from './snapshot';
import { graphName, normalizeRules, rulesForGraph, migrateLegacyRules, resolveRules, matchRule, type TagInfo, type TagRule } from './rules';
import { PageHeaders, type HeaderTarget } from './headers';
import { showSettings } from './settings';

const api: any = logseq;
const props = ['--ls-primary-background-color', '--ls-secondary-background-color', '--ls-primary-text-color', '--ls-secondary-text-color', '--ls-active-primary-color', '--ls-link-text-color', '--ls-border-color', '--ls-quaternary-background-color'];
let palette: Palette = { paper: '#1a1a1a', ink: '#d0d0d0', accent: '#9aa6ad' };
let stats = 'Ready';
let running = false;
let queued = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let storedRules: TagRule[] = [];
let automaticEnabled = true;
let revision = 0;
let closeSettings: (() => void) | undefined;
const headers = new PageHeaders(api);
class Cancelled extends Error {}
let worker: Worker | undefined;
let polling = false;
let watched: { graphKey: string; coverIdent: string; ids: string; signature: string; palette: string; inheritance: string } | undefined;
let nextJob = 0;
const failed = new Set<string>();
const jobs = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
const cleanups: Array<() => void> = [];
const $ = (id: string) => document.getElementById(id)!;
const qualified = (ident: unknown) => String(ident).replace(/^:/, '');
function enabledGraph(name: string) {
  return automaticEnabled && rulesForGraph(storedRules, name).some(rule => rule.enabled);
}
async function loadTags(): Promise<TagInfo[]> {
  return (await query('[:find ?id ?uuid ?title :where [?id :block/tags :logseq.class/Tag] [?id :block/uuid ?uuid] [?id :block/title ?title] (not [?id :logseq.property/deleted-at])]'))
    .map(([id, uuid, name]) => ({ id, uuid: String(uuid), name: String(name) }));
}
async function refreshHeader() {
  if (disposed) return;
  try { await headers.refresh(); } catch (error) { console.warn('[Flowshape Covers] Page header', error); }
}
function setStatus(message: string) {
  stats = message;
  if (document.getElementById('status')) $('status').textContent = message;
  console.info('[Flowshape Covers]', message);
}
function generate(uuid: string, cfg: CoverConfig, colors = palette): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL(WORKER_FILE, location.href));
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id);
      if (!job) return;
      clearTimeout(job.timeout);
      jobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.svg);
    };
    worker.onerror = () => stopWorker('Pattern worker failed');
  }
  const id = ++nextJob;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => stopWorker('Pattern exceeded the 20 second generation limit. Reduce its parameters.'), 20000);
    jobs.set(id, { resolve, reject, timeout });
    worker!.postMessage({ id, uuid, config: cfg, palette: colors });
  });
}
function stopWorker(reason: string) {
  worker?.terminate(); worker = undefined;
  for (const job of jobs.values()) { clearTimeout(job.timeout); job.reject(new Error(reason)); }
  jobs.clear();
}
async function updateTheme() {
  const colors = await api.UI.resolveThemeCssPropsVals(props) || {};
  for (const [key, value] of Object.entries(colors)) if (typeof value === 'string') document.documentElement.style.setProperty(key, value);
  const color = (key: string, fallback: string) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = fallback;
    if (colors[key] && !String(colors[key]).includes('var(')) ctx.fillStyle = colors[key];
    return ctx.fillStyle as string;
  };
  palette = {
    paper: color(props[0]!, '#1a1a1a'),
    ink: color(props[2]!, '#d0d0d0'),
    accent: color(props[4]!, '#9aa6ad'),
  };
}
function schedule(delay = 700) {
  if (disposed) return;
  clearTimeout(timer);
  timer = setTimeout(() => void run().catch(report), delay);
}
function report(error: unknown) {
  if (error instanceof Cancelled) return;
  const message = errorMessage(error);
  setStatus(message);
  console.error('[Flowshape Covers]', error);
  void api.UI.showMsg(`Flowshape covers: ${message}`, 'error', { key: 'flowshape-error', timeout: 6000 });
}
function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return JSON.stringify(error);
}
async function query(text: string, ...inputs: unknown[]): Promise<any[]> { return (await api.DB.datascriptQuery(text, ...inputs)) || []; }
async function checkSnapshot() {
  if (running || polling || disposed) return;
  polling = true;
  try {
    const graph = await api.App.getCurrentGraph();
    if (!graph || !enabledGraph(graph.name)) return;
    const graphKey = graph.url || graph.path || graph.name;
    if (!watched || watched.graphKey !== graphKey) { schedule(0); return; }
    await refreshHeader();
    await updateTheme();
    if (JSON.stringify(palette) !== watched.palette) { schedule(0); return; }
    const parents = await query('[:find ?child ?parent :where [?child :logseq.property.class/extends ?parent]]');
    if (snapshotKey(parents) !== watched.inheritance) { schedule(0); return; }
    const rows = await query(`[:find ?e ?t ?cover :where [?e :block/tags ?t] [(contains? #{${watched.ids}} ?t)] [(get-else $ ?e :${watched.coverIdent} 0) ?cover] (not [?e :logseq.property/deleted-at])]`);
    const signature = snapshotKey(rows);
    if (signature !== watched.signature) schedule(0);
  } catch (error) {
    console.warn('[Flowshape Covers] Snapshot check', error);
  } finally { polling = false; }
}
async function run(onlyUuid?: string) {
  if (running) { queued = true; return; }
  const graph = await api.App.getCurrentGraph();
  if (!graph || !enabledGraph(graph.name)) { headers.clear(true); setStatus('No active tag rules. Add a tag in cover settings.'); return; }
  running = true; queued = false;
  const graphKey = graph.url || graph.path || graph.name;
  const rulesRevision = revision;
  const graphRules = structuredClone(rulesForGraph(storedRules, graph.name));
  const checkGraph = async () => {
    const now = await api.App.getCurrentGraph();
    if (disposed || rulesRevision !== revision || (now?.url || now?.path || now?.name) !== graphKey) throw new Cancelled('Generation superseded');
  };
  let added = 0, updated = 0, kept = 0, errors = 0;
  let stage = 'Read theme colors';
  try {
    await updateTheme();
    const generationPalette = { ...palette };
    stage = 'Read Cover schema';
    const coverProperties = await query('[:find ?p ?ident ?uuid ?type :where [?p :block/title "Cover"] [?p :db/ident ?ident] [?p :block/uuid ?uuid] [?p :logseq.property/type ?type]]');
    const cover = coverProperties.find(row => qualified(row[3]) === 'asset');
    if (!cover) throw new Error('Add a Cover property of type Asset to this graph first');
    const [coverId, rawCoverIdent] = cover;
    const coverIdent = qualified(rawCoverIdent);
    stage = 'Read configured tags';
    const tags = await loadTags();
    const inheritance = await query('[:find ?child ?parent :where [?child :logseq.property.class/extends ?parent]]');
    const matches = resolveRules(graphRules, tags, inheritance);
    if (!matches.size) { headers.clear(true); setStatus('Configured tags were not found in this graph.'); return; }
    const tagIds = new Set(matches.keys());
    const ids = [...tagIds].join(' ');
    const schemaRows = await query('[:find ?tag :in $ ?cover :where [?tag :logseq.property.class/properties ?cover]]', coverId);
    const withCover = new Set(schemaRows.map(row => row[0]));
    for (const rule of graphRules.filter(rule => rule.enabled)) {
      const tag = tags.find(tag => tag.uuid === rule.tagUuid);
      if (tag && !withCover.has(tag.id)) { await checkGraph(); await api.Editor.addTagProperty(tag.uuid, String(cover[2])); }
    }
    const assetTags = await query('[:find ?id ?uuid :where [?id :db/ident :logseq.class/Asset] [?id :block/uuid ?uuid]]');
    if (!assetTags.length) throw new Error('The graph’s built-in Asset tag could not be found');
    const assetTagUuid = String(assetTags[0][1]);
    stage = 'Find objects in configured tags';
    const rawTargets = await query(`[:find ?e ?uuid ?title ?t :where [?e :block/tags ?t] [(contains? #{${ids}} ?t)] [?e :block/uuid ?uuid] [?e :block/title ?title] (not [?e :logseq.property/deleted-at])]`);
    const nodes = new Map<number, { row: any[]; tags: number[] }>();
    for (const row of rawTargets) {
      if (!nodes.has(row[0])) nodes.set(row[0], { row: row.slice(0, 3), tags: [] });
      nodes.get(row[0])!.tags.push(row[3]);
    }
    const winningRules = new Map<number, TagRule>();
    const allTargets = [...nodes].flatMap(([id, node]) => {
      const rule = matchRule(node.tags, matches);
      if (!rule) return [];
      winningRules.set(id, rule);
      return [node.row];
    });
    const targets = onlyUuid ? allTargets.filter(row => String(row[1]) === onlyUuid) : allTargets;
    const coverRows = await query(`[:find ?e ?asset ?uuid ?title ?type :where [?e :${coverIdent} ?asset] [?asset :block/uuid ?uuid] [?asset :block/title ?title] [(get-else $ ?asset :logseq.property.asset/type "") ?type]]`);
    const covers = new Map(coverRows.map(row => [row[0], row.slice(1)]));
    const galleryViews = await query('[:find ?uuid ?owner :where [?v :logseq.property.view/feature-type :class-objects] [?v :logseq.property/view-for ?owner] [?v :block/uuid ?uuid] [?v :logseq.property.view/type ?type] [?type :block/title "Gallery View"] (not [?v :logseq.property.view/gallery-asset-property])]');
    for (const [uuid, owner] of galleryViews) if (matches.get(owner)?.rule.enabled) {
      await checkGraph(); await api.Editor.upsertBlockProperty(String(uuid), 'logseq.property.view/gallery-asset-property', coverId, { entityId: true });
    }
    setStatus(`Checking ${targets.length} objects in configured tags…`);
    for (const [id, rawUuid] of targets) {
      stage = 'Generate and register cover';
      await checkGraph();
      const uuid = String(rawUuid);
      const cfg = winningRules.get(id)!.config;
      const signature = fingerprint(uuid, cfg, generationPalette);
      const failureKey = `${graphKey}:${uuid}:${signature}`;
      if (failed.has(failureKey)) { errors++; continue; }
      try {
        const old = covers.get(id);
        if (old && !isOwnedCover(old[2], uuid)) { kept++; continue; }
        const title = coverTitle(uuid, signature);
        if (old?.[2] === title) { kept++; continue; }
        const cached = (await query('[:find ?id ?uuid :in $ ?title :where [?id :block/title ?title] [?id :block/tags :logseq.class/Asset] [?id :block/uuid ?uuid] (not [?id :logseq.property/deleted-at])]', title))[0];
        let asset = cached ? { id: cached[0], uuid: String(cached[1]) } : null;
        if (!asset) {
          const svg = await generate(uuid, cfg, generationPalette);
          asset = await createCoverAsset(api, assetTagUuid, uuid, signature, svg, checkGraph);
        }
        await checkGraph();
        // Re-read immediately before assignment, preserving an intervening manual change.
        const current = (await query(`[:find ?a :in $ ?e :where [?e :${coverIdent} ?a]]`, id))[0]?.[0];
        if (current !== old?.[0]) { kept++; continue; }
        const currentTags = (await query('[:find ?t :in $ ?e :where [?e :block/tags ?t]]', id)).map(row => row[0]);
        if (matchRule(currentTags, matches)?.tagUuid !== winningRules.get(id)!.tagUuid) { queued = true; continue; }
        await api.Editor.upsertBlockProperty(uuid, coverIdent, asset.id, { entityId: true });
        covers.set(id, [asset.id, asset.uuid, title, 'svg']);
        if (old) updated++; else added++;
      } catch (error) {
        if (error instanceof Cancelled) throw error;
        failed.add(failureKey); errors++;
        console.error('[Flowshape Covers]', uuid, error);
      }
    }
    watched = { graphKey, coverIdent, ids, signature: snapshotKey(rawTargets.map(row => [row[0], row[3], covers.get(row[0])?.[0] || 0])), palette: JSON.stringify(generationPalette), inheritance: snapshotKey(inheritance) };
    await checkGraph();
    headers.setContext(graphKey, new Map<string, HeaderTarget>(allTargets.map(([id, uuid]) => {
      const cover = covers.get(id);
      return [String(uuid), { rule: winningRules.get(id)!, cover: cover ? { uuid: String(cover[1]), type: qualified(cover[3]) } : undefined }];
    })));
    await refreshHeader();
    setStatus(`${added} added · ${updated} updated · ${kept} kept${errors ? ` · ${errors} failed (see console)` : ''}`);
  } catch (error) {
    if (error instanceof Cancelled) return;
    const message = errorMessage(error);
    throw new Error(`${stage}: ${message}`);
  } finally {
    running = false;
    if (queued && !disposed) schedule();
  }
}

async function openSettings() {
  closeSettings?.();
  await updateTheme();
  const graph = await api.App.getCurrentGraph();
  if (!graph) throw new Error('Open a graph to configure tag covers');
  const page = await api.Editor.getCurrentPage();
  const uuid = String(page?.uuid || page?.['block/uuid'] || 'b8466ada-3750-462f-a4c5-8ea70fbb91eb');
  closeSettings = showSettings({ api, graph: graphName(graph.name), tags: await loadTags(), rules: storedRules,
    enabled: automaticEnabled, status: stats, render: config => generate(uuid, config),
    save: (rules, enabled) => {
      automaticEnabled = enabled;
      storedRules = normalizeRules(rules); revision++; watched = undefined; failed.clear(); headers.clear(true);
      api.updateSettings({ rules: structuredClone(storedRules), rulesVersion: 1, enabled }); schedule(0);
    }, fill: () => { failed.clear(); schedule(0); },
  });
}

async function main() {
  automaticEnabled = api.settings?.enabled !== false;
  storedRules = normalizeRules(api.settings?.rules);
  const graph = await api.App.getCurrentGraph();
  if (graph && !Array.isArray(api.settings?.rules)) {
    storedRules = normalizeRules(migrateLegacyRules(api.settings, graph.name, await loadTags()) || []);
    api.updateSettings({ rules: structuredClone(storedRules), rulesVersion: 1 });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); closeSettings?.(); api.hideMainUI(); }
  });
  document.addEventListener('click', event => {
    if (event.target === document.body || event.target === document.documentElement) { closeSettings?.(); api.hideMainUI(); }
  });
  api.provideModel({ openSettings: () => void openSettings().catch(report) });
  api.useSettingsSchema([
    { key: 'enabled', type: 'boolean', default: true, title: 'Automatic covers', description: 'Generate covers only for explicitly configured tags. Manual covers are preserved.' },
    { key: 'configure', type: 'button', default: null, title: 'Tag cover rules', description: 'Choose tags, algorithms, and optional page headers.', buttonText: 'Open cover settings', buttonAction: 'openSettings' },
  ]);
  api.setMainUIInlineStyle({ position: 'fixed', inset: '0', zIndex: 1000, backgroundColor: 'rgba(0,0,0,.25)' });
  api.App.registerCommandPalette({ key: 'flowshape-cover-settings', label: 'Flowshape covers: Settings' }, () => void openSettings().catch(report));
  api.App.registerCommandPalette({ key: 'flowshape-cover-fill', label: 'Flowshape covers: Check missing covers' }, () => { failed.clear(); schedule(0); });
  api.App.registerCommandPalette({ key: 'flowshape-cover-current', label: 'Flowshape covers: Check current cover' }, async () => {
    const page = await api.Editor.getCurrentPage();
    const uuid = page?.uuid || page?.['block/uuid'];
    if (uuid) { failed.clear(); await run(String(uuid)).catch(report); }
  });
  api.App.registerUIItem('toolbar', { key: 'flowshape-covers', template: '<a class="button" data-on-click="openSettings" title="Flowshape cover settings"><i class="ti ti-photo"></i></a>' });
  cleanups.push(api.DB.onChanged((event: any) => { if (shouldScan(event)) schedule(); }));
  cleanups.push(api.App.onCurrentGraphChanged(() => { revision++; watched = undefined; failed.clear(); headers.clear(true); schedule(1000); }));
  cleanups.push(api.App.onRouteChanged(() => { headers.clear(); void refreshHeader(); }));
  cleanups.push(api.App.onPageHeadActionsSlotted(() => void refreshHeader()));
  cleanups.push(api.App.onThemeModeChanged(() => { schedule(900); }));
  cleanups.push(api.App.onThemeChanged(() => { schedule(1000); }));
  cleanups.push(api.onSettingsChanged((settings: any) => { automaticEnabled = settings.enabled !== false; storedRules = normalizeRules(settings.rules); revision++; watched = undefined; failed.clear(); headers.clear(true); schedule(); }));
  // Current DB builds can omit plugin change hooks. One small reference query
  // catches those events without rescanning or regenerating unchanged covers.
  const snapshotTimer = setInterval(() => void checkSnapshot(), 5000);
  api.beforeunload(() => {
    disposed = true; clearTimeout(timer); clearInterval(snapshotTimer); cleanups.forEach(off => off?.());
    closeSettings?.(); headers.clear(true); stopWorker('Plugin unloaded');
  });
  schedule(1200);
}
api.ready(main).catch(report);
