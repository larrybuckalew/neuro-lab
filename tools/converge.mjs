// Headless check for NEURO.
//
//   node tools/converge.mjs
//
// Loads index.html's script into a fake window, runs the simulation without a
// renderer, and asserts that evolution actually gets a creature across the
// finish line — plus determinism, NaN-freedom, and enough throughput to render
// at 16x speed.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('no <script> block found');
  process.exit(1);
}

const sandbox = {
  console,
  performance: { now: () => Date.now() },
  requestAnimationFrame() { return 0; },
  setTimeout() { return 0; },
  __NEURO_HEADLESS__: true
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
try {
  vm.runInContext(m[1], context, { filename: 'index.html<script>' });
} catch (err) {
  console.error('FATAL: script threw while loading\n', err);
  process.exit(1);
}

const N = sandbox.__NEURO__;
if (!N) { console.error('FATAL: window.__NEURO__ missing'); process.exit(1); }

const { Sim, POP } = N;
let failures = 0;
const ok = s => console.log('  \x1b[32m ok \x1b[0m ' + s);
const fail = s => { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + s); };

const FINISH = N.FINISH_TILE * 32;

// advance exactly one generation (including the intermission/evolve step)
function nextGeneration(sim) {
  let guard = 0;
  while (!sim.genDone && guard++ < 5000) sim.step(1 / 60);
  const gen = sim.generation;
  guard = 0;
  while (sim.generation === gen && guard++ < 500) sim.step(1 / 60);
  return sim.generation;
}

console.log('\n=== convergence ===');
const sim = new Sim(20261109);
const t0 = Date.now();
let solvedAt = 0;
const marks = [];

for (let g = 1; g <= 200; g++) {
  nextGeneration(sim);
  if (!solvedAt && sim.solvedGen) solvedAt = sim.solvedGen;
  if (g % 20 === 0) {
    marks.push({ g, best: Math.round(sim.bestEver), avg: Math.round(sim.genAvg), fin: sim.finished || 0 });
    console.log(`  gen ${String(g).padStart(3)}  best ${String(Math.round(sim.bestEver)).padStart(5)} / ${FINISH}   avg ${String(Math.round(sim.genAvg)).padStart(5)}   finished ${sim.finished || 0}/${POP}`);
  }
  if (solvedAt && g >= solvedAt + 10) break;
}

const elapsed = Date.now() - t0;
console.log('');

// NaN sweep across the live population
let nans = 0;
for (const a of sim.pop) {
  if (![a.x, a.y, a.vx, a.vy, a.fitness].every(Number.isFinite)) nans++;
}
if (nans === 0) ok('no NaN/Infinity in agent state');
else fail(`${nans} agents have non-finite state`);

if (sim.bestEver >= FINISH) ok(`course solved at generation ${solvedAt} (best ${Math.round(sim.bestEver)} >= ${FINISH})`);
else fail(`never solved: best ${Math.round(sim.bestEver)} of ${FINISH} after 200 generations`);

if (solvedAt && solvedAt <= 40) ok(`solved in ${solvedAt} generations (fast enough to watch)`);
else if (solvedAt) fail(`solved but took ${solvedAt} generations — too slow to be watchable`);

// determinism: same seed must produce the same run
const a1 = new Sim(777);
const a2 = new Sim(777);
for (let i = 0; i < 25; i++) { nextGeneration(a1); nextGeneration(a2); }
if (Math.abs(a1.bestEver - a2.bestEver) < 0.001 && a1.generation === a2.generation) {
  ok('same seed reproduces the same run');
} else {
  fail(`non-deterministic: ${a1.bestEver} vs ${a2.bestEver}`);
}

// different seeds should not collapse to identical results
const b1 = new Sim(1);
const b2 = new Sim(999999);
for (let i = 0; i < 15; i++) { nextGeneration(b1); nextGeneration(b2); }
if (Math.abs(b1.bestEver - b2.bestEver) > 0.001) ok('different seeds give different runs');
else fail('two different seeds produced identical fitness');

// throughput: 16x speed runs 16 steps per rendered frame
const perfSim = new Sim(4242);
const t1 = Date.now();
let steps = 0;
while (Date.now() - t1 < 250 && steps < 100000) { perfSim.step(1 / 60); steps++; }
const sps = steps / ((Date.now() - t1) / 1000);
console.log(`\n  throughput: ${Math.round(sps)} sim steps/sec (${POP} agents each)`);
if (sps > 16 * 60) ok('fast enough for 16x rendering (needs > 960 steps/sec)');
else fail(`too slow for 16x: ${Math.round(sps)} steps/sec`);

console.log(`\n  200-gen run took ${elapsed}ms wall clock`);
console.log(`\n${failures === 0 ? '\x1b[32mALL CHECKS PASSED\x1b[0m' : `\x1b[31m${failures} FAILURE(S)\x1b[0m`}\n`);
process.exit(failures === 0 ? 0 : 1);
