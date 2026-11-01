export type Role = 'ink' | 'paper' | 'accent';
export interface Palette { paper: string; ink: string; accent: string }

export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children: SvgNode[];
  /** Literal text content, escaped on serialize. Only `<text>`/`<tspan>` use it. */
  text?: string;
}

export function el(
  tag: string,
  attrs: Record<string, string | number> = {},
  children: SvgNode[] = [],
): SvgNode {
  return { tag, attrs, children };
}

/** A text-bearing element. `<text>` needs content between its tags, which the
 *  attrs-and-children node shape alone cannot express. */
export function elText(
  tag: string,
  attrs: Record<string, string | number> = {},
  text = '',
): SvgNode {
  return { tag, attrs, children: [], text };
}

const ROLE_ATTRS = new Set(['fill', 'stroke']);
const ROLES = new Set<string>(['ink', 'paper', 'accent']);

function fmt(v: string | number): string {
  if (typeof v === 'number') {
    const r = Math.round(v * 100) / 100;
    return String(r);
  }
  return v;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function serialize(node: SvgNode, pal: Palette): string {
  const attrs = { ...node.attrs };
  if (node.tag === 'svg' && attrs['xmlns'] === undefined) {
    attrs['xmlns'] = 'http://www.w3.org/2000/svg';
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    let out = fmt(v);
    if (ROLE_ATTRS.has(k) && ROLES.has(out)) out = pal[out as Role];
    parts.push(`${k}="${esc(out)}"`);
  }
  const open = `<${node.tag}${parts.length ? ' ' + parts.join(' ') : ''}`;
  // `text === undefined` means "no text content" and still self-closes; an
  // empty string means "an empty element", which a <text> node legitimately is.
  if (node.children.length === 0 && node.text === undefined) return `${open}/>`;
  const inner = node.text === undefined ? '' : esc(node.text);
  return `${open}>${inner}${node.children.map((c) => serialize(c, pal)).join('')}</${node.tag}>`;
}

/**
 * Bakes `ink`/`paper`/`accent` role tokens into literal colours.
 *
 * `serialize` resolves roles against one palette for the whole tree, which is
 * right for a bare pattern but wrong for a poster: the sheet chrome and the
 * artwork inside it deliberately use different palettes — inversion *is* that
 * difference. Resolving the artwork subtree first makes it palette-independent,
 * so it can be embedded anywhere without carrying its colours in a second
 * channel.
 */
export function resolveRoles(node: SvgNode, pal: Palette): SvgNode {
  const attrs: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(node.attrs)) {
    attrs[k] = ROLE_ATTRS.has(k) && typeof v === 'string' && ROLES.has(v) ? pal[v as Role] : v;
  }
  const out: SvgNode = { tag: node.tag, attrs, children: node.children.map((c) => resolveRoles(c, pal)) };
  if (node.text !== undefined) out.text = node.text;
  return out;
}
