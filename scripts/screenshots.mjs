// Capture README screenshots from the Even Hub simulator.
//
// 1. npm run dev
// 2. npx @evenrealities/evenhub-simulator@0.9.5 --automation-port 9898 http://127.0.0.1:5173/
// 3. npm run screenshots   (the app must have just started, on the first page)
//
// Uses the simulator's automation API: POST /api/input, GET /api/screenshot/glasses (PNG).
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.SIMULATOR_URL ?? 'http://127.0.0.1:9898';
const outDir = new URL('../docs/screenshots/', import.meta.url);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function input(action) {
  const res = await fetch(`${base}/api/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`input ${action}: HTTP ${res.status} ${await res.text()}`);
  await sleep(700);
}

async function shot(name) {
  const res = await fetch(`${base}/api/screenshot/glasses`);
  if (!res.ok) throw new Error(`screenshot: HTTP ${res.status}`);
  const file = new URL(`${name}.png`, outDir);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`saved docs/screenshots/${name}.png`);
}

await mkdir(outDir, { recursive: true });
const ping = await fetch(`${base}/api/ping`).catch(() => null);
if (!ping?.ok) throw new Error(`simulator automation API not reachable at ${base}`);

await shot('1-next-action');
await input('down');
await shot('2-next-deadline');
await input('down');
await shot('3-inbox');
await input('down');
await shot('4-voice-note');
await input('long_press');
await sleep(2300);
await shot('5-voice-recording');
await input('long_press_release');
await sleep(1500);
await shot('6-voice-done');
await input('down');
