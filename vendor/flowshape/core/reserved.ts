/** Query keys owned by the app shell; pattern params may not use them.
 *  Includes Part 3's poster keys already so patterns can never collide.
 *  'theme' is no longer a real app state field (the site is dark-only), but it
 *  stays reserved so stale `theme=` params from old shared links are silently
 *  ignored rather than misread as a pattern param. */
export const RESERVED = new Set([
  'v', 'seed', 'pal', 'bg', 'ink', 'acc', 'theme', 'lang',
  'layout', 'format', 'title', 'caption', 'cway', 'notext',
  'hue', 'hueSpread', 'chroma', 'paperL', 'accentShift',
  'cw', 'ch', 'cu',
  // 'mode' is deliberately NOT reserved — delaunay, fabric and moire already
  // ship a 'mode' param, and the animate route is path-based (#/a/<pattern>),
  // so nothing reads ?mode=.
  // 'phase' is also deliberately NOT reserved, for a different reason:
  // RESERVED means "an app-shell URL key a pattern may never claim as a
  // param." `size` and `phase` are the opposite kind of thing — universal
  // params the shell injects into every opted-in pattern, so their keys
  // legitimately live in the param namespace and appear in the URL as
  // params. Membership in RESERVED and injection as a param are mutually
  // exclusive by construction; that's why `size` was never in RESERVED
  // either. The collision guard for `phase` lives next to SIZE_PARAM's, in
  // definePattern's validation loop (src/patterns/registry.ts).
  'stage', 'apre', 'aint', 'acol',
  'aatk', 'arel', 'abass', 'amid', 'ahigh',
]);
