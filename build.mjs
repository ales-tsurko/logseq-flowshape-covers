import { build } from 'esbuild';
import { access, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
await access('external/flowshape/src/patterns/index.ts').catch(() => {
  throw new Error('Flowshape is missing. Run: git submodule update --init --recursive');
});
await mkdir('dist', { recursive: true });
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 10);
async function bundle(name, entry, options = {}) {
  const result = await build({ entryPoints: [entry], outfile: `${name}.js`, bundle: true, format: 'iife', target: 'chrome120', minify: true, legalComments: 'eof', write: false, ...options });
  const output = result.outputFiles[0].contents;
  const file = `${name}-${digest(output)}.js`;
  await writeFile(`dist/${file}`, output);
  return file;
}
const sdk = await bundle('sdk', require.resolve('@logseq/libs'));
const worker = await bundle('worker', 'src/worker.ts');
const main = await bundle('main', 'src/main.ts', { define: { WORKER_FILE: JSON.stringify(worker) } });
const css = await readFile('src/settings.css');
const styles = `settings-${digest(css)}.css`;
await writeFile(`dist/${styles}`, css);
await writeFile('dist/index.html', `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${styles}"></head><body><div id="app"></div><script src="${sdk}"></script><script src="${main}"></script></body></html>`);
const current = new Set([sdk, worker, main, styles]);
for (const file of await readdir('dist')) {
  if (!current.has(file) && /^(main|sdk|worker|settings)(?:-[a-f0-9]+)?\.(?:js|css)$/.test(file)) await unlink(`dist/${file}`);
}
