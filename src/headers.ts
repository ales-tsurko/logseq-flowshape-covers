import type { TagRule } from './rules';

export interface PageCover { uuid: string; type: string }
export interface HeaderTarget { rule: TagRule; cover?: PageCover }
const key = 'page-header';
const id = `logseq-flowshape-covers--${key}`;
const path = '#main-content-container .cp__page-inner-wrap > .page-inner';
const escape = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

export class PageHeaders {
  private version = 0;
  private signature = '';
  private context?: { graphKey: string; targets: Map<string, HeaderTarget> };
  constructor(private api: any) {}
  setContext(graphKey: string, targets: Map<string, HeaderTarget>) { this.context = { graphKey, targets }; }
  clear(resetContext = false) {
    this.version++;
    this.signature = '';
    if (resetContext) this.context = undefined;
    this.api.provideUI({ key, path: 'body', template: null });
  }
  async refresh() {
    const version = ++this.version;
    const context = this.context;
    if (!context) return;
    const graph = await this.api.App.getCurrentGraph();
    const page = await this.api.Editor.getCurrentPage();
    if (version !== this.version) return;
    const uuid = String(page?.uuid || page?.['block/uuid'] || '');
    const target = context.targets.get(uuid);
    if ((graph?.url || graph?.path || graph?.name) !== context.graphKey || !target?.rule.header.enabled || !target.cover) {
      if (this.signature) this.clear();
      return;
    }
    const { cover, rule } = target;
    if (!/^[a-f0-9-]{36}$/i.test(cover.uuid) || !/^(svg|png|jpe?g|gif|webp|avif)$/i.test(cover.type)) {
      if (this.signature) this.clear();
      return;
    }
    const signature = JSON.stringify([context.graphKey, uuid, cover.uuid, cover.type, rule.header.height]);
    if (signature === this.signature && await this.api.UI.queryElementById(id)) return;
    if (!await this.api.UI.queryElementRect(path)) return;
    const url = await this.api.App.makeAssetUrl(`/assets/${cover.uuid}.${cover.type}`);
    if (version !== this.version || !url) return;
    this.api.provideUI({ key, path,
      attrs: { role: 'img', 'aria-label': 'Page cover', 'data-cover-uuid': cover.uuid },
      style: { gridRow: '1', width: '100%', minWidth: '0', height: `${rule.header.height}px`, overflow: 'hidden', borderRadius: 'var(--ls-border-radius-medium, 8px)', pointerEvents: 'none' },
      template: `<img src="${escape(String(url))}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:center">`,
    });
    this.signature = signature;
  }
}
