import { getPattern, listPatterns, DEFAULT_CONFIG, type CoverConfig } from './engine';
import { newRule, rulesForGraph, type TagInfo, type TagRule } from './rules';

const $ = (id: string) => document.getElementById(id)!;
const field = (id: string) => $(id) as HTMLInputElement;
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const nice = (label: string) => label.replace(/^.*\./, '').replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

export interface SettingsOptions {
  api: any;
  graph: string;
  tags: TagInfo[];
  rules: TagRule[];
  enabled: boolean;
  status: string;
  render: (config: CoverConfig) => Promise<string>;
  save: (rules: TagRule[], enabled: boolean) => void;
  fill: () => void;
}
export function showSettings(opts: SettingsOptions) {
  const allRules = structuredClone(opts.rules);
  let local = rulesForGraph(allRules, opts.graph);
  let selected = local[0]?.tagUuid || '';
  let enabled = opts.enabled;
  let previewUrl = '';
  let version = 0;
  let closed = false;
  const selectedRule = () => local.find(rule => rule.tagUuid === selected);
  const cleanup = () => { closed = true; version++; URL.revokeObjectURL(previewUrl); };
  const label = (rule: TagRule) => opts.tags.find(tag => tag.uuid === rule.tagUuid)?.name || `${rule.tagName} (missing tag)`;
  const patterns = listPatterns().sort((a, b) => a.id.localeCompare(b.id));

  async function preview() {
    const rule = selectedRule();
    if (!rule) return;
    const request = ++version;
    try {
      const svg = await opts.render(structuredClone(rule.config));
      if (closed || request !== version) return;
      URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      ($('preview') as HTMLImageElement).src = previewUrl;
      ($('header-preview') as HTMLImageElement).src = previewUrl;
      $('header-preview-wrap').hidden = !rule.header.enabled;
      $('header-preview-wrap').style.height = `${Math.min(140, rule.header.height * 0.5)}px`;
    } catch (error) { if (!closed && request === version) $('status').textContent = String(error); }
  }
  function renderParams() {
    const rule = selectedRule()!;
    const config = rule.config;
    const def = getPattern(config.pattern)!;
    const saved = config.parameters[def.id] || {};
    $('params').innerHTML = def.params.filter(p => !p.hidden).map(p => {
      const value = saved[p.key] ?? p.default;
      const id = `param-${p.key}`;
      const control = p.kind === 'enum'
        ? `<select id="${id}">${p.options?.map((text, index) => `<option value="${index}" ${index === value ? 'selected' : ''}>${esc(nice(text))}</option>`).join('')}</select>`
        : `<input id="${id}" type="${p.kind === 'bool' ? 'checkbox' : 'number'}" min="${p.min}" max="${p.max}" step="${p.step}" value="${value}" ${p.kind === 'bool' && value ? 'checked' : ''}>`;
      return `<div class="row"><label for="${id}">${esc(nice(p.label))}</label>${control}</div>`;
    }).join('');
    const updateDependencies = () => {
      for (const p of def.params) if (p.dependsOn && !p.hidden) {
        const gate = def.params.find(row => row.key === p.dependsOn!.key)!;
        field(`param-${p.key}`).disabled = !p.dependsOn.values.includes(config.parameters[def.id]?.[gate.key] ?? gate.default);
      }
    };
    for (const p of def.params.filter(p => !p.hidden)) field(`param-${p.key}`).onchange = () => {
      const value = p.kind === 'bool' ? Number(field(`param-${p.key}`).checked) : Number(field(`param-${p.key}`).value);
      if (!Number.isFinite(value)) return;
      config.parameters[def.id] = { ...config.parameters[def.id], [p.key]: Math.max(p.min, Math.min(p.max, value)) };
      updateDependencies(); void preview();
    };
    updateDependencies();
  }
  function draw() {
    version++;
    const rule = selectedRule();
    const available = opts.tags.filter(tag => !local.some(rule => rule.tagUuid === tag.uuid)).sort((a, b) => a.name.localeCompare(b.name));
    const pos = local.findIndex(rule => rule.tagUuid === selected);
    $('app').innerHTML = `<header><h2>Flowshape covers</h2><button id="close" aria-label="Close">✕</button></header>
      <div class="tag-settings"><div class="row"><label for="enabled">Automatic covers</label><input type="checkbox" id="enabled" ${enabled ? 'checked' : ''}></div>
      <div class="tag-add"><select id="add-tag" aria-label="Tag to configure"><option value="">Choose a tag in ${esc(opts.graph)}…</option>${available.map(tag => `<option value="${esc(tag.uuid)}">#${esc(tag.name)}</option>`).join('')}</select><button id="add">Add tag</button></div>
      ${local.length ? `<div class="tag-select"><select id="tag-rule" aria-label="Configured tag">${local.map(rule => `<option value="${esc(rule.tagUuid)}" ${rule.tagUuid === selected ? 'selected' : ''}>#${esc(label(rule))}${rule.enabled ? '' : ' · off'}</option>`).join('')}</select><button id="up" aria-label="Move rule up" ${pos <= 0 ? 'disabled' : ''}>↑</button><button id="down" aria-label="Move rule down" ${pos >= local.length - 1 ? 'disabled' : ''}>↓</button><button id="remove">Remove tag</button></div>` : ''}
      <p class="hint">Only configured tags generate covers. Direct matches win, then rule order. Removing a rule keeps existing images.</p></div>
      ${rule ? `<main><section class="controls"><div class="section">#${esc(label(rule))}</div>
      <div class="row"><label for="rule-enabled">Generate covers</label><input type="checkbox" id="rule-enabled" ${rule.enabled ? 'checked' : ''}></div>
      <div class="row"><label for="descendants">Include inherited tags</label><input type="checkbox" id="descendants" ${rule.descendants ? 'checked' : ''}></div>
      <div class="row"><label for="pattern">Algorithm</label><select id="pattern">${patterns.map(p => `<option value="${p.id}" ${p.id === rule.config.pattern ? 'selected' : ''}>${nice(p.id)}${p.heavy ? ' · heavier' : ''}</option>`).join('')}</select></div>
      <div class="row"><label for="seed">Seed offset</label><input type="number" id="seed" step="1" value="${rule.config.seedOffset}"></div>
      <div class="row"><label for="parameter-variation">Parameter variation</label><input type="number" id="parameter-variation" min="0" max="1" step="0.05" value="${rule.config.parameterVariation}"></div>
      <div class="row"><label for="variation">Rotation variation</label><input type="number" id="variation" min="0" max="1" step="0.05" value="${rule.config.variation}"></div>
      <div class="section">Page header</div><div class="row"><label for="header-enabled">Show page header</label><input type="checkbox" id="header-enabled" ${rule.header.enabled ? 'checked' : ''}></div>
      <div class="row"><label for="header-height">Header height (px)</label><input type="number" id="header-height" min="60" max="800" step="10" value="${rule.header.height}" ${rule.header.enabled ? '' : 'disabled'}></div>
      <p class="hint">Uses the existing Cover image, cropped to the page width. Header visibility belongs to this tag rule.</p>
      <div class="section">Algorithm parameters</div><div id="params"></div><button id="reset" class="reset">Reset algorithm parameters</button></section>
      <aside class="preview"><img id="preview" alt="Cover preview"><div id="header-preview-wrap" class="header-preview" ${rule.header.enabled ? '' : 'hidden'}><img id="header-preview" alt="Page header preview"></div></aside></main>` : '<div class="empty">No tags configured. Add a tag to enable covers.</div>'}
      <footer><span id="status">${esc(opts.status)}</span><button id="fill">Check missing covers</button><button id="save" class="primary">Apply settings</button></footer>`;
    $('close').onclick = () => { cleanup(); opts.api.hideMainUI(); };
    $('enabled').onchange = () => { enabled = field('enabled').checked; };
    $('add').onclick = () => {
      const tag = opts.tags.find(tag => tag.uuid === field('add-tag').value);
      if (!tag) return;
      local.push(newRule(opts.graph, tag, DEFAULT_CONFIG)); selected = tag.uuid; draw();
    };
    $('fill').onclick = opts.fill;
    $('save').onclick = () => {
      for (const rule of local) rule.tagName = opts.tags.find(tag => tag.uuid === rule.tagUuid)?.name || rule.tagName;
      opts.save([...allRules.filter(rule => rule.graph !== opts.graph), ...local], enabled);
      $('status').textContent = 'Settings saved. Updating configured tags…';
    };
    if (!rule) return;
    $('tag-rule').onchange = () => { selected = field('tag-rule').value; draw(); };
    $('up').onclick = () => { [local[pos - 1], local[pos]] = [local[pos]!, local[pos - 1]!]; draw(); };
    $('down').onclick = () => { [local[pos], local[pos + 1]] = [local[pos + 1]!, local[pos]!]; draw(); };
    $('remove').onclick = () => { local = local.filter(rule => rule.tagUuid !== selected); selected = local[0]?.tagUuid || ''; draw(); };
    $('rule-enabled').onchange = () => { rule.enabled = field('rule-enabled').checked; };
    $('descendants').onchange = () => { rule.descendants = field('descendants').checked; };
    $('pattern').onchange = () => { rule.config.pattern = field('pattern').value; renderParams(); void preview(); };
    $('seed').onchange = () => { rule.config.seedOffset = Math.trunc(Number(field('seed').value) || 0); void preview(); };
    $('parameter-variation').onchange = () => { rule.config.parameterVariation = Math.max(0, Math.min(1, Number(field('parameter-variation').value) || 0)); field('parameter-variation').value = String(rule.config.parameterVariation); void preview(); };
    $('variation').onchange = () => { rule.config.variation = Math.max(0, Math.min(1, Number(field('variation').value) || 0)); void preview(); };
    $('header-enabled').onchange = () => { rule.header.enabled = field('header-enabled').checked; field('header-height').disabled = !rule.header.enabled; void preview(); };
    $('header-height').onchange = () => { rule.header.height = Math.round(Math.max(60, Math.min(800, Number(field('header-height').value) || 200))); field('header-height').value = String(rule.header.height); void preview(); };
    $('reset').onclick = () => { delete rule.config.parameters[rule.config.pattern]; renderParams(); void preview(); };
    renderParams(); void preview();
  }
  draw(); opts.api.showMainUI({ autoFocus: true });
  return cleanup;
}
