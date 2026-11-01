# Flowshape Covers for Logseq DB

A local desktop plugin that assigns deterministic, theme-colored SVG covers to
explicitly configured tags. New installations have **no configured tags** and do
not generate any covers until you add a rule. UUID-based seeds keep the geometry
stable when an item is renamed. Existing manual covers are preserved.

Open **Flowshape covers: Settings** in the command palette, or use the photo icon
in the toolbar. Choose a tag in the current graph and click **Add tag**. Select a
configured tag to edit its own algorithm, parameters, seed offset, composition
variation, and optional page header. There are 40 algorithms with a live preview.
Click **Apply settings** to save all rule changes for this graph.

Rules use tag UUIDs, so renaming a tag does not break its settings. Rules are
scoped to their graph. New rules match only their chosen tag. **Include inherited
tags** extends a rule to descendant tags. Direct matches take priority over
inherited matches, nearer ancestors take priority over farther ones, and ties
use rule order. Use the arrow buttons to change that order. An explicit disabled
rule can exclude a more specific tag from an inherited rule. Turning a rule off
or removing it stops generation and leaves existing Cover images intact.

Upgrading an existing installation migrates its previous project/idea settings
to two explicit rules, preserving the chosen algorithm and inheritance behavior.
This one-time compatibility migration does not apply to new installations or to
an explicitly empty rule list.

## Page headers

Each tag rule has a **Show page header** toggle and **Header height (px)** setting
(60–800 px). Headers start off. When enabled, pages matching that rule show their
existing Cover image above the title at the content width, cropped to the chosen
height. The header reuses the same asset, including manual image covers. Changing
its height does not generate another image. Turning it off removes the header.

Headers are displayed by the desktop plugin and are not inserted into page
content. They require the plugin to be running and do not appear on iOS. Cover
assets themselves can still sync and display on other devices.

## Generation

Generation listens for DB changes and checks a small tag/Cover reference snapshot
every five seconds to cover unreliable hook delivery in current DB builds.
Changing tags can select a different rule even when the Cover reference stays
the same. Unchanged references do not trigger generation. The graph must have a
Cover property of type Asset. The plugin adds that property to configured tag
schemas when needed.

Colors follow the active theme. Theme changes refresh generated images while
keeping their geometry stable. On a device without the plugin, the images keep
their last generated colors. The global **Automatic covers** switch pauses all
rules and hides plugin headers. Runtime generation uses no server, credentials,
or external network requests.

## Gallery appearance

`src/gallery.css` is installed in this graph's `logseq/custom.css`. It applies to
native gallery cards that have an image cover. Images fill the card, with metadata
overlaid at the bottom on an opaque background using Logseq theme variables.
Choose **Cover** as the gallery's cover property where necessary.

Logseq DB 2.0.2 can omit the internal `query-result` view type on query blocks,
which prevents covers from rendering even when Cover is selected. The native
plugin API cannot write this keyword value. For an affected query block, set it
once with Logseq's CLI, then reload Logseq:

```sh
logseq upsert block --graph GRAPH --uuid QUERY_BLOCK_UUID \
  --update-properties '{:logseq.property.view/feature-type :query-result}'
```

This repairs native view metadata without changing the query or CSS.

## Build and load

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

In Logseq Plugins, enable developer mode and use **Load unpacked plugin** to select
this directory. The plugin is designed for Logseq DB 2.0.2, revision `533ac43`.

## Asset integration

The plugin uses Logseq's exported `write_assetsdir_file` API through the SDK App
proxy, then its Editor APIs to create/tag an Asset and assign the existing,
qualified Cover property. `writeAssetsdirFile` is exported but is not declared in
the SDK types. This compatibility point should be checked after Logseq updates.
Page headers use the SDK UI provider anchored to the main page grid and Logseq’s
exported asset URL API. These compatibility points should also be checked after
Logseq updates. Immutable assets are reused by UUID, settings, and palette fingerprint. Changing
settings may leave previous generated variants available in Assets for reuse.

## Attribution

Vendored pattern generators and core geometry come from
[Flowshape](https://github.com/Jossifresben/flowshape), commit
`07d30a244e4b638a8356e03c9bd252c82a9c42b3`, by Jose "Jossi" Fresco Benaim, under
the [MIT license](vendor/flowshape/LICENSE). The original app is
[flowshape.art](https://flowshape.art).

The Logseq SDK is vendored from the installed app's revision `533ac43` (SDK
0.3.4). Its [AGPL license](vendor/logseq-sdk/LICENSE.md) is retained. The old
published npm SDK is not used. This combined local plugin is AGPL-3.0-or-later.
