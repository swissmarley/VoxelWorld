// Headless smoke test: boots the game, checks the world, drives manually, then lets the
// autopilot play the whole loop (steal → speed → crash → wreck → steal again) and asserts
// it all happened without page errors. Exit code 1 on failure.
import { mkdirSync, statSync } from 'node:fs';
import { openGame } from './browser.mjs';

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const t0 = Date.now();
const game = await openGame({ width: 1280, height: 720, query: 'seed=7', log: () => {} });

// world
const stats = await game.stats();
check('city built', stats.lanes > 100 && stats.colliders > 500 && stats.props > 300, `lanes=${stats.lanes} colliders=${stats.colliders} props=${stats.props}`);
check('cars populated', stats.vehicles > 100 && stats.vehicles < 600, `vehicles=${stats.vehicles}`);
check('build time sane', stats.buildMs < 8000, `${stats.buildMs} ms`);

// title → play, manual controls
await game.hw('__hotwire.start(); __hotwire.step(1.0)');
let st = await game.state();
check('starts on foot with a car in reach', st.player.state === 'walk' && st.reachable === 'Marlin', `state=${st.player.state} reachable=${st.reachable}`);
await game.hw('__hotwire.enterNearestCar(); __hotwire.step(1.0)');
st = await game.state();
check('can steal the car', st.player.state === 'car' && st.car && st.car.name === 'Marlin', `state=${st.player.state}`);
await game.hw('__hotwire.setInput({forward:1}); __hotwire.step(4)');
st = await game.state();
check('throttle accelerates to speed', st.car && st.car.kmh > 60, `${Math.round(st.car?.kmh ?? 0)} km/h`);
await game.hw('__hotwire.setInput({back:1}); __hotwire.step(1.4); __hotwire.setInput({}); __hotwire.step(0.8)');
st = await game.state();
check('brakes stop the car', st.car && st.car.kmh < 12, `${Math.round(st.car?.kmh ?? 0)} km/h`);
await game.hw('__hotwire.setInput({}); __hotwire.step(1.5); __hotwire.exitCar(); __hotwire.step(0.5)');
st = await game.state();
check('can get out', st.player.state === 'walk' && !st.car);

// the loop, unattended
await game.hw('__hotwire.demo(true)');
let s2;
for (let i = 0; i < 12; i++) { await game.step(10); s2 = await game.stats(); if (s2.wrecks >= 2 && s2.stolen >= 3) break; }
const st2 = await game.state();
check('autopilot steals multiple cars', s2.stolen >= 3, `stolen=${s2.stolen}`);
check('crashes happen', s2.crashes >= 8, `crashes=${s2.crashes}`);
check('props get smashed', s2.smashed >= 1, `smashed=${s2.smashed}`);
check('cars get wrecked', s2.wrecks >= 1, `wrecks=${s2.wrecks}`);
check('reaches high speed', s2.topKmh >= 70, `${Math.round(s2.topKmh)} km/h`);
check('traffic keeps flowing', st2.ai.n >= 30 && st2.ai.moving >= st2.ai.n * 0.4, `ai=${JSON.stringify(st2.ai)}`);
check('traffic is not a demolition derby', st2.aiCrashes <= 25, `ai-on-ai crashes=${st2.aiCrashes} in ${Math.round(st2.simTime)}s`);
check('player state valid', ['walk', 'car', 'entering', 'knocked'].includes(st2.player.state), st2.player.state);
check('player inside the world', Math.abs(st2.player.x) < 400 && Math.abs(st2.player.z) < 400, `${Math.round(st2.player.x)},${Math.round(st2.player.z)}`);

// render sanity
mkdirSync('screenshots/_work', { recursive: true });
await game.shot('screenshots/_work/smoke.png');
const size = statSync('screenshots/_work/smoke.png').size;
check('renders a non-blank frame', size > 60000, `${size} bytes`);
const draws = await game.stats();
check('draw calls bounded', draws.draws > 20 && draws.draws < 1500, `draws=${draws.draws} tris=${draws.triangles}`);
check('no page errors', game.errors.length === 0, game.errors.join(' | ').slice(0, 200));
await game.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed.length ? 1 : 0);
