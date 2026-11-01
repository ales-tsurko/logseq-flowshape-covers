declare const logseq: any;
declare const WORKER_FILE: string;
import { DEFAULT_CONFIG, listPatterns, getPattern, fingerprint, isOwnedCover, coverTitle, type CoverConfig, type Palette } from './engine';
import { createCoverAsset } from './assets';
import { shouldScan } from './events';
import { snapshotKey } from './snapshot';

const api: any = logseq;
const props = ['--ls-primary-background-color', '--ls-secondary-background-color', '--ls-primary-text-color', '--ls-secondary-text-color', '--ls-active-primary-color', '--ls-link-text-color', '--ls-border-color', '--ls-quaternary-background-color'];
let palette: Palette = { paper: '#1a1a1a', ink: '#d0d0d0', accent: '#9aa6ad' };
let stats = 'Ready';
let running = false;
let queued = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let draft: CoverConfig = structuredClone(DEFAULT_CONFIG);
let previewUrl = '';
let previewVersion = 0;
let worker: Worker | undefined;
let polling = false;
let watched: { graphKey: string; coverIdent: string; ids: string; signature: string; palette: string; inheritance: string } | undefined;
let nextJob = 0;
const failed = new Set<string>();
const jobs = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
const cleanups: Array<() => void> = [];
const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const qualified = (ident: unknown) => String(ident).replace(/^:/, '');
const graphName = (name: string) => name.replace(/^logseq_db_/, '');
function config(): CoverConfig {
  const saved = api.settings?.config || {};
  return { ...DEFAULT_CONFIG, ...saved, parameters: saved.parameters || {} };
}
function enabledGraph(name: string) {
  return api.settings?.enabled !== false && String(api.settings?.graphs ?? 'kbase').split(',').map((s: string) => graphName(s.trim())).includes(graphName(name));
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
    await updateTheme();
    if (JSON.stringify(palette) !== watched.palette) { schedule(0); return; }
    const parents = await query('[:find ?child ?parent :where [?child :logseq.property.class/extends ?parent]]');
    if (snapshotKey(parents as Array<[number, number]>) !== watched.inheritance) { schedule(0); return; }
    const rows = await query(`[:find ?e ?cover :where [?e :block/tags ?t] [(contains? #{${watched.ids}} ?t)] [(get-else $ ?e :${watched.coverIdent} 0) ?cover] (not [?e :logseq.property/deleted-at])]`);
    const signature = snapshotKey(rows as Array<[number, number]>);
    if (signature !== watched.signature) schedule(0);
  } catch (error) {
    console.warn('[Flowshape Covers] Snapshot check', error);
  } finally { polling = false; }
}
async function run(onlyUuid?: string) {
  if (running) { queued = true; return; }
  const graph = await api.App.getCurrentGraph();
  if (!graph || (!onlyUuid && !enabledGraph(graph.name))) return;
  running = true; queued = false;
  const graphKey = graph.url || graph.path || graph.name;
  const checkGraph = async () => {
    const now = await api.App.getCurrentGraph();
    if (disposed || (now?.url || now?.path || now?.name) !== graphKey) throw new Error('Graph changed, generation stopped');
  };
  let added = 0, updated = 0, kept = 0, errors = 0;
  let stage = 'Read theme colors';
  try {
    await updateTheme();
    const generationPalette = { ...palette };
    const cfg = config();
    stage = 'Read Cover schema';
    const coverProperties = await query('[:find ?p ?ident ?uuid ?type :where [?p :block/title "Cover"] [?p :db/ident ?ident] [?p :block/uuid ?uuid] [?p :logseq.property/type ?type]]');
    const cover = coverProperties.find(row => qualified(row[3]) === 'asset');
    if (!cover) throw new Error('Add a Cover property of type Asset to this graph first');
    const [coverId, rawCoverIdent] = cover;
    const coverIdent = qualified(rawCoverIdent);
    stage = 'Read project and idea tags';
    const tagRows = await query('[:find ?id ?uuid ?title :where [?id :block/tags :logseq.class/Tag] [?id :block/uuid ?uuid] [?id :block/title ?title]]');
    const tags = tagRows.filter(row => ['project', 'idea'].includes(String(row[2]).toLowerCase()));
    if (!tags.length) throw new Error('No project or idea tag found');
    const assetTags = await query('[:find ?id ?uuid :where [?id :db/ident :logseq.class/Asset] [?id :block/uuid ?uuid]]');
    if (!assetTags.length) throw new Error('The graph’s built-in Asset tag could not be found');
    const assetTagUuid = String(assetTags[0][1]);
    const tagIds = new Set<number>(tags.map(row => row[0]));
    const inheritance = await query('[:find ?child ?parent :where [?child :logseq.property.class/extends ?parent]]');
    for (let changed = true; changed;) {
      changed = false;
      for (const [child, parent] of inheritance) if (tagIds.has(parent) && !tagIds.has(child)) { tagIds.add(child); changed = true; }
    }
    const ids = [...tagIds].join(' ');
    stage = 'Find tagged projects and ideas';
    const allTargets = await query(`[:find ?e ?uuid ?title :where [?e :block/tags ?t] [(contains? #{${ids}} ?t)] [?e :block/uuid ?uuid] [?e :block/title ?title] (not [?e :logseq.property/deleted-at])]`);
    const targets = onlyUuid ? allTargets.filter(row => String(row[1]) === onlyUuid) : allTargets;
    const coverRows = await query(`[:find ?e ?asset ?uuid ?title :where [?e :${coverIdent} ?asset] [?asset :block/uuid ?uuid] [?asset :block/title ?title]]`);
    const covers = new Map(coverRows.map(row => [row[0], row.slice(1)]));
    const galleryViews = await query('[:find ?uuid ?owner :where [?v :logseq.property.view/feature-type :class-objects] [?v :logseq.property/view-for ?owner] [?v :block/uuid ?uuid] [?v :logseq.property.view/type ?type] [?type :block/title "Gallery View"] (not [?v :logseq.property.view/gallery-asset-property])]');
    for (const [uuid, owner] of galleryViews) if (tagIds.has(owner)) {
      await checkGraph(); await api.Editor.upsertBlockProperty(String(uuid), 'logseq.property.view/gallery-asset-property', coverId, { entityId: true });
    }
    setStatus(`Checking ${targets.length} projects and ideas…`);
    for (const [id, rawUuid] of targets) {
      stage = 'Generate and register cover';
      await checkGraph();
      const uuid = String(rawUuid);
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
        await api.Editor.upsertBlockProperty(uuid, coverIdent, asset.id, { entityId: true });
        covers.set(id, [asset.id, asset.uuid, title]);
        if (old) updated++; else added++;
      } catch (error) {
        failed.add(failureKey); errors++;
        console.error('[Flowshape Covers]', uuid, error);
        throw error;
      }
    }
    watched = { graphKey, coverIdent, ids, signature: snapshotKey(allTargets.map(row => [row[0], covers.get(row[0])?.[0] || 0])), palette: JSON.stringify(generationPalette), inheritance: snapshotKey(inheritance as Array<[number, number]>) };
    setStatus(`${added} added · ${updated} updated · ${kept} kept${errors ? ` · ${errors} failed (see console)` : ''}`);
  } catch (error) {
    const message = errorMessage(error);
    throw new Error(`${stage}: ${message}`);
  } finally {
    running = false;
    if (queued && !disposed) schedule();
  }
}

function nice(label: string) { return label.replace(/^.*\./, '').replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()); }
async function preview() {
  const version = ++previewVersion;
  try {
    const page = await api.Editor.getCurrentPage();
    const svg = await generate(String(page?.uuid || page?.['block/uuid'] || 'b8466ada-3750-462f-a4c5-8ea70fbb91eb'), draft);
    if (version !== previewVersion || !document.getElementById('preview')) return;
    URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    ($('preview') as HTMLImageElement).src = previewUrl;
  } catch (error) { if (version === previewVersion) setStatus(String(error)); }
}
function renderParams() {
  const def = getPattern(draft.pattern)!;
  const saved = draft.parameters[def.id] || {};
  $('params').innerHTML = def.params.filter(p => !p.hidden).map(p => {
    const value = saved[p.key] ?? p.default;
    const id = `param-${p.key}`;
    const control = p.kind === 'enum'
      ? `<select id="${id}">${p.options?.map((label, index) => `<option value="${index}" ${index === value ? 'selected' : ''}>${escape(nice(label))}</option>`).join('')}</select>`
      : `<input id="${id}" type="${p.kind === 'bool' ? 'checkbox' : 'number'}" min="${p.min}" max="${p.max}" step="${p.step}" value="${value}" ${p.kind === 'bool' && value ? 'checked' : ''}>`;
    return `<div class="row"><label for="${id}">${escape(nice(p.label))}</label>${control}</div>`;
  }).join('');
  for (const p of def.params.filter(p => !p.hidden)) {
    const el = input(`param-${p.key}`);
    el.onchange = () => {
      const value = p.kind === 'bool' ? Number(el.checked) : Number(el.value);
      if (!Number.isFinite(value)) return;
      draft.parameters[def.id] = { ...draft.parameters[def.id], [p.key]: Math.max(p.min, Math.min(p.max, value)) };
      updateDependencies(); void preview();
    };
  }
  updateDependencies();
  function updateDependencies() {
    for (const p of def.params) if (p.dependsOn && !p.hidden) {
      const gate = def.params.find(row => row.key === p.dependsOn!.key)!;
      input(`param-${p.key}`).disabled = !p.dependsOn.values.includes(draft.parameters[def.id]?.[gate.key] ?? gate.default);
    }
  }
}
async function openSettings() {
  await updateTheme(); draft = structuredClone(config());
  const graph = await api.App.getCurrentGraph();
  $('app').innerHTML = `<header><h2>Flowshape covers</h2><button id="close" aria-label="Close">✕</button></header><main><section class="controls"><div class="row"><label for="enabled">Enabled in ${escape(graphName(graph?.name || 'this graph'))}</label><input type="checkbox" id="enabled" ${enabledGraph(graph?.name) ? 'checked' : ''}></div><div class="row"><label for="pattern">Algorithm</label><select id="pattern">${listPatterns().sort((a, b) => a.id.localeCompare(b.id)).map(p => `<option value="${p.id}" ${p.id === draft.pattern ? 'selected' : ''}>${nice(p.id)}${p.heavy ? ' · heavier' : ''}</option>`).join('')}</select></div><div class="row"><label for="seed">Seed offset</label><input type="number" id="seed" step="1" value="${draft.seedOffset}"></div><div class="row"><label for="variation">Composition variation</label><input type="number" id="variation" min="0" max="1" step="0.05" value="${draft.variation}"></div><p class="hint">Each UUID has a stable seed. Existing manual covers are preserved. Colors follow the active theme.</p><div class="section">Algorithm parameters</div><div id="params"></div><button id="reset" style="margin-top:12px">Reset algorithm parameters</button></section><aside class="preview"><img id="preview" alt="Cover preview"><p class="hint">Preview uses the current page’s UUID. Saved settings apply to all generated covers in enabled graphs.</p></aside></main><footer><span id="status">${escape(stats)}</span><button id="fill">Check missing covers</button><button id="save" class="primary">Apply settings</button></footer>`;
  $('close').onclick = () => api.hideMainUI();
  $('pattern').onchange = () => { draft.pattern = input('pattern').value; renderParams(); void preview(); };
  $('seed').onchange = () => { draft.seedOffset = Math.trunc(Number(input('seed').value) || 0); void preview(); };
  $('variation').onchange = () => { draft.variation = Math.max(0, Math.min(1, Number(input('variation').value) || 0)); void preview(); };
  $('reset').onclick = () => { delete draft.parameters[draft.pattern]; renderParams(); void preview(); };
  $('fill').onclick = () => { failed.clear(); schedule(0); };
  $('save').onclick = () => {
    const graphs = new Set(String(api.settings?.graphs ?? 'kbase').split(',').map((s: string) => graphName(s.trim())).filter(Boolean));
    if (input('enabled').checked) graphs.add(graphName(graph.name)); else graphs.delete(graphName(graph.name));
    api.updateSettings({ config: structuredClone(draft), enabled: true, graphs: [...graphs].join(',') });
    failed.clear(); setStatus('Settings saved. Updating generated covers…'); schedule(0);
  };
  renderParams(); api.showMainUI({ autoFocus: true }); void preview();
}

async function main() {
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); api.hideMainUI(); }
  });
  document.addEventListener('click', event => {
    if (event.target === document.body || event.target === document.documentElement) api.hideMainUI();
  });
  api.provideModel({ openSettings: () => void openSettings().catch(report) });
  api.useSettingsSchema([
    { key: 'enabled', type: 'boolean', default: true, title: 'Automatic covers', description: 'Generate covers for project and idea tags, including inherited tags. Manual covers are preserved.' },
    { key: 'graphs', type: 'string', default: 'kbase', title: 'Graphs', description: 'Comma-separated graph names where cover generation is enabled.' },
    { key: 'configure', type: 'button', default: null, title: 'Algorithm and parameters', description: 'Configure the pattern with a live preview.', buttonText: 'Open cover settings', buttonAction: 'openSettings' },
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
  cleanups.push(api.App.onCurrentGraphChanged(() => { watched = undefined; failed.clear(); schedule(1000); }));
  cleanups.push(api.App.onThemeModeChanged(() => { schedule(900); void updateTheme().then(() => void preview()).catch(report); }));
  cleanups.push(api.App.onThemeChanged(() => { schedule(1000); }));
  api.onSettingsChanged(() => { failed.clear(); schedule(); });
  // Current DB builds can omit plugin change hooks. One small reference query
  // catches those events without rescanning or regenerating unchanged covers.
  const snapshotTimer = setInterval(() => void checkSnapshot(), 5000);
  api.beforeunload(() => {
    disposed = true; clearTimeout(timer); clearInterval(snapshotTimer); cleanups.forEach(off => off?.());
    stopWorker('Plugin unloaded'); URL.revokeObjectURL(previewUrl);
  });
  schedule(1200);
}
api.ready(main).catch(report);
