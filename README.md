# Flowshape Covers for Logseq DB

A local desktop plugin that assigns deterministic, theme-colored SVG covers to
`#project` and `#idea`, including tags inheriting from them. A UUID hash is the
seed, so renaming an item keeps its geometry. Existing manual covers are preserved.

Open **Flowshape covers: Settings** in the command palette, or use the photo icon
in the toolbar. Choose one of 40 algorithms and adjust its parameters with a live
preview. **Apply settings** refreshes existing generated covers and fills missing
ones. The seed offset changes variations. Composition variation also distinguishes
mathematical algorithms that do not consume a random seed themselves.

Generation listens for DB changes and checks a small snapshot of tag/Cover
references every five seconds to cover unreliable hook delivery in current DB
builds. Unchanged references do not trigger generation. Add the existing Cover
property to both tag schemas when enabling another graph.

The plugin reads the active theme's background, foreground, and accent variables.
Changing the theme refreshes generated covers. Geometry stays stable. SVGs are
normal graph assets, so other devices can display them once the assets sync.
Automatic generation and theme recoloring require desktop Logseq with this plugin
running. A device without the plugin sees the last generated colors.

The native plugin settings select which graphs are enabled. The initial graph is
`kbase`. Algorithm settings are shared by enabled graphs. No server, service,
credentials, or network requests are used at runtime.

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
Immutable assets are reused by UUID, settings, and palette fingerprint. Changing
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
