const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers.js');
const { makeActivity, FitWriter, toFitTs } = require('./fit-encoder.js');

const START = Date.UTC(2026, 8, 6, 8, 0, 0);

test('GPS-Spur wird im 5-Sekunden-Raster gespeichert', () => {
  const a = core.buildActivity(core.parseFit(makeActivity({ start: START, seconds: 600, speed: 3, hr: 140,
    gps: (t, d) => [48.4 + d / 111000, 9.99] })));
  assert.equal(a.v, 2);
  assert.equal(a.stream.la.length, a.stream.t.length);
  assert.ok(Math.abs(a.stream.la[0] / 1e5 - 48.4) < 0.001);
  assert.ok(Math.abs(a.stream.lo[10] / 1e5 - 9.99) < 0.0001);
  assert.ok(a.stream.la[a.stream.la.length - 1] > a.stream.la[0], 'Strecke führt nach Norden');
});

test('Ohne GPS (Laufband) gibt es keine Spur', () => {
  const a = core.buildActivity(core.parseFit(makeActivity({ start: START, seconds: 600, speed: 3, hr: 140, subSport: 1 })));
  assert.equal(a.stream.la, undefined);
  assert.equal(a.name, 'Lauf (Laufband)');
});

test('Runden werden übernommen', () => {
  const laps = [0, 1, 2, 3].map(i => ({ t0: i * 300, dur: 300, dist: i % 2 ? 1300 : 1000, hr: i % 2 ? 165 : 140 }));
  const a = core.buildActivity(core.parseFit(makeActivity({ start: START, seconds: 1200, speed: 3.5, hr: 150, laps })));
  assert.equal(a.laps.length, 4);
  assert.deepEqual(a.laps.map(l => l.t0), [0, 300, 600, 900]);
  assert.equal(a.laps[1].dist, 1300);
  assert.equal(a.laps[1].hr, 165);
  assert.ok(Math.abs(a.laps[1].spd - 1300 / 300) < 0.01);
});

test('Krafttraining: Sätze, Gewicht, Kategorie; Pausen werden ausgelassen', () => {
  const sets = [
    { t0: 60, dur: 40, reps: 10, kg: 60, cat: 28, sub: 6 },
    { t0: 100, dur: 90, rest: true },
    { t0: 190, dur: 38, reps: 8, kg: 62.5, cat: 28, sub: 6 },
    { t0: 400, dur: 30, reps: 12, kg: null, cat: 22, sub: 0 }
  ];
  const a = core.buildActivity(core.parseFit(makeActivity({ start: START, seconds: 1800, speed: 0, hr: 110, sport: 10, subSport: 20, sets, profileName: 'Kraft' })));
  assert.equal(a.kind, 'strength');
  assert.equal(a.name, 'Krafttraining');
  assert.equal(a.profile, 'Kraft');
  assert.equal(a.sets.length, 3);
  assert.deepEqual(a.sets[0], { t0: 60, dur: 40, reps: 10, kg: 60, cat: 28, sub: 6 });
  assert.equal(a.sets[1].kg, 62.5);
  assert.equal(a.sets[2].kg, null);
  assert.equal(a.sets[2].cat, 22);
});

test('Mehrsport-Datei: jede Session wird eine eigene Aktivität', () => {
  const w = new FitWriter(), t0 = toFitTs(START);
  w.define(0, 0, [{ num: 0, type: 'enum' }]).data(0, { 0: 4 });
  w.define(1, 20, [{ num: 253, type: 'u32' }, { num: 3, type: 'u8' }, { num: 5, type: 'u32' }]);
  for (let t = 0; t <= 1200; t++) w.data(1, { 253: t0 + t, 3: t < 600 ? 130 : 160, 5: Math.round((t < 600 ? t * 7 : 4200 + (t - 600) * 3) * 100) });
  w.define(2, 18, [{ num: 253, type: 'u32' }, { num: 2, type: 'u32' }, { num: 5, type: 'enum' }, { num: 6, type: 'enum' }, { num: 7, type: 'u32' }, { num: 8, type: 'u32' }, { num: 9, type: 'u32' }]);
  w.data(2, { 253: t0 + 600, 2: t0, 5: 2, 6: 7, 7: 600000, 8: 600000, 9: 420000 });
  w.data(2, { 253: t0 + 610, 2: t0 + 600, 5: 3, 6: 0, 7: 10000, 8: 10000, 9: 0 });
  w.data(2, { 253: t0 + 1200, 2: t0 + 610, 5: 1, 6: 0, 7: 590000, 8: 590000, 9: 177000 });
  const acts = core.buildActivities(core.parseFit(w.build()));
  assert.equal(acts.length, 2, 'Wechselzone wird ausgelassen');
  assert.equal(acts[0].name, 'Radfahren (Rennrad)');
  assert.equal(acts[0].kind, 'bike');
  assert.equal(acts[1].isRun, true);
  assert.equal(acts[1].id, String(START + 610000));
  assert.equal(acts[0].avgHR === null || acts[0].stream.hr.every(h => h <= 130), true);
  assert.ok(acts[1].stream.hr.every(h => h >= 160 || h === 0));
  assert.equal(acts[0].multiOf, 2);
});

test('Fußball mit GPS: Sprints werden gezählt', () => {
  // 10 Sprints à 4 s mit 7 m/s, sonst 2 m/s
  const speed = t => (t % 120 >= 30 && t % 120 < 34 && t < 1200) ? 7 : 2;
  const a = core.buildActivity(core.parseFit(makeActivity({ start: START, seconds: 1500, speed, hr: 150, sport: 7, gps: (t, d) => [48.4 + d / 111000, 9.99] })));
  assert.equal(a.kind, 'team');
  assert.equal(a.name, 'Fußball');
  assert.equal(a.sprints, 10);
  assert.ok(Math.abs(a.topSpd - 7) < 0.01);
});

test('Sportarten-Zuordnung nach FIT-Profil', () => {
  assert.equal(core.sportKind(10, 20), 'strength');
  assert.equal(core.sportKind(10, 43), 'other');
  assert.equal(core.sportKind(7, 0), 'team');
  assert.equal(core.sportKind(17, 0), 'walk');
  assert.equal(core.sportName(10, 43, 'other'), 'Yoga');
  assert.equal(core.sportName(4, 15, 'other'), 'Crosstrainer');
  assert.equal(core.sportName(1, 3, 'run'), 'Lauf (Trail)');
  assert.equal(core.sportName(1, 2, 'run'), 'Lauf');
  assert.equal(core.sportName(25, 0, 'other'), 'Golf');
});

test('Alte Datensätze werden ergänzt', () => {
  const old = { id: '1', start: 1, sport: 10, subSport: 20, timer: 1800, dist: 0 };
  const n = core.normalizeAct({ ...old });
  assert.equal(n.kind, 'strength');
  assert.deepEqual(n.stream.t, []);
  const yoga = core.normalizeAct({ id: '2', start: 1, sport: 10, subSport: 43, name: 'Krafttraining', timer: 600, dist: 0 });
  assert.equal(yoga.name, 'Yoga');
  assert.equal(yoga.kind, 'other');
});

test('HFmax: Uhr-Einstellung hat Vorrang vor lockeren Läufen', () => {
  const a = core.buildActivity(core.parseFit(makeActivity({ start: Date.now() - 864e5, seconds: 1200, speed: 3, hr: 150, watch: { lthr: 170, maxHR: 192, rest: 48, sex: 'm' } })));
  const P = core.estimateParams([a], {});
  assert.equal(P.maxHR, 192);
  assert.equal(P.src.maxHR, 'Einstellung aus der Uhr');
});

test('Belastung über Anstrengung (RPE) für Krafttraining', () => {
  const a = core.normalizeAct({ id: 'm1', start: Date.now(), kind: 'strength', timer: 3600, sport: 10, subSport: 20 });
  const P = { lthr: 170, maxHR: 190, restHR: 50, sex: 'm' };
  const d = core.derive(a, P, { rpe: 7, k: 0.3 });
  assert.equal(d.src, 'rpe');
  assert.equal(d.trimp, 126);
  const e = core.derive(a, P, {});
  assert.equal(e.src, 'est');
  assert.equal(e.trimp, 60);
});
