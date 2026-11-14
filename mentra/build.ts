/**
 * Build Glance for MentraOS: two bundles, as the Mentra App expects.
 *   dist/background/index.js  JSContext entry, IIFE (no DOM, no module resolver)
 *   dist/ui/index.html        settings WebView
 * Run from the repository root: `bun run mentra/build.ts`.
 */
import { readFile, rm } from 'fs/promises';
import { findUnsupportedBackgroundApis } from '@mentra/miniapp-cli/build-helpers';

const root = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const repo = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Same check as `backgroundRuntimeGuardPlugin` from @mentra/miniapp-cli, applied to every
 * repository file in the background bundle (the shared core included). File names are passed
 * with forward slashes: the upstream plugin passes Windows paths with backslashes, which the
 * TypeScript compiler host it creates cannot find.
 */
const backgroundGuard = {
  name: 'glance-background-runtime-guard',
  setup(build: { onLoad: Function }) {
    build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path }: { path: string }) => {
      const file = path.replace(/\\/g, '/');
      if (!file.startsWith(repo) || file.includes('/node_modules/')) return undefined;
      const contents = await readFile(path, 'utf8');
      const findings = findUnsupportedBackgroundApis(contents, file);
      if (findings.length > 0) {
        const details = findings.map((f) => `  ${file}:${f.line}:${f.column} ${f.api}: ${f.replacement}`).join('\n');
        throw new Error(`Unsupported API in the Mentra background runtime:\n${details}`);
      }
      return { contents, loader: file.endsWith('.js') ? 'js' : 'ts' };
    });
  },
};
const dist = `${root}dist`;
await rm(dist, { recursive: true, force: true });

const background = await Bun.build({
  entrypoints: [`${root}src/background/index.ts`],
  outdir: `${dist}/background`,
  target: 'browser',
  format: 'iife',
  plugins: [backgroundGuard],
  minify: false,
});
if (!background.success) {
  console.error('Background build failed:');
  for (const log of background.logs) console.error(log);
  process.exit(1);
}

const ui = await Bun.build({
  entrypoints: [`${root}src/ui/index.html`],
  outdir: `${dist}/ui`,
  target: 'browser',
  minify: true,
});
if (!ui.success) {
  console.error('UI build failed:');
  for (const log of ui.logs) console.error(log);
  process.exit(1);
}
console.log('built mentra/dist');
