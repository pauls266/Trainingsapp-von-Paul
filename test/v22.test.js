const test = require('node:test');
const assert = require('node:assert/strict');
const { core, DAY } = require('./helpers.js');
const { makeActivity } = require('./fit-encoder.js');
require('../exercises.js'); // wie im Browser: globale Übungsnamen bereitstellen
global.EXERCISE_NAMES = require('../exercises.js').EXERCISE_NAMES;

const P = { lthr: 170, maxHR: 190, restHR: 50, sex: 'm' };
const run = (daysAgo, o = {}) => {
  const d = new Date(Date.now() - daysAgo * DAY); d.setHours(7, 0, 0, 0);
  return core.buildActivity(core.parseFit(makeActivity({ start: d.getTime(), step: 5, seconds: 3000, speed: 10/3, hr: 148, ...o })));
};

test('VO2max aus Tempo und Puls (Daniels + Swain)', () => {
  // 200 m/min -> VO2 36,0; 70 % HFR (148 bpm) -> 3,5 + 32,5/0,7 ≈ 49,9
  const v = core.vo2maxRun(run(1), P);
  assert.ok(Math.abs(v - 49.9) < 0.3, 'VO2max ' + v);
  // höherer Puls bei gleichem Tempo -> niedrigere VO2max
  assert.ok(core.vo2maxRun(run(1, { hr: 162 }), P) < v);
});

test('VO2max: keine Schätzung bei zu kurzen, unruhigen oder pulslosen Läufen', () => {
  assert.equal(core.vo2maxRun(run(1, { seconds: 900 }), P), null);
  assert.equal(core.vo2maxRun(run(1, { hr: () => null }), P), null);
  assert.equal(core.vo2maxRun(run(1, { speed: t => (Math.floor(t / 30) % 2 ? 2.5 : 4.2) }), P), null);
  assert.equal(core.vo2maxRun(run(1, { sport: 2 }), P), null);
  // steiler Anstieg wird ausgefiltert
  assert.equal(core.vo2maxRun(run(1, { alt: (t, d) => 100 + d * 0.08 }), P), null);
});

test('VO2max-Trend vergleicht die letzten 4 Wochen mit den 4 davor', () => {
  const acts = [];
  for (let i = 30; i < 56; i += 4) acts.push(run(i, { hr: 155 }));
  for (let i = 1; i < 28; i += 4) acts.push(run(i, { hr: 148 }));
  const t = core.vo2Trend(acts, P);
  assert.ok(t.cur > t.prev);
  assert.ok(t.delta > 1);
  assert.equal(t.list.length, acts.length);
});

function ctx(acts, S = {}){
  const der = {}; for (const a of acts) der[a.id] = core.derive(a, P);
  return { acts, der, series: core.loadSeries(acts, der), S, W: core.newWellness(), vo2: core.vo2Trend(acts, P) };
}

test('Trainingszustand: produktiv bei steigender VO2max', () => {
  const acts = [];
  for (let i = 1; i < 60; i += 2) acts.push(run(i, { hr: i < 28 ? 146 : 156 }));
  const s = core.trainingStatus(ctx(acts, { runsPerWeek: 4 }));
  assert.equal(s.key, 'productive', s.label + ' ' + s.text);
  assert.ok(s.better.some(b => /VO2max/.test(b.t)));
});

test('Trainingszustand: Überlastung bei plötzlich hoher Belastung', () => {
  const acts = [];
  for (let i = 10; i < 60; i += 3) acts.push(run(i, { seconds: 1800 }));
  for (let i = 0; i < 7; i++) acts.push(run(i, { seconds: 7200, hr: 172 }));
  const s = core.trainingStatus(ctx(acts));
  assert.equal(s.key, 'over');
  assert.equal(s.tone, 'bad');
});

test('Trainingszustand: zu wenig Daten', () => {
  assert.equal(core.trainingStatus(ctx([run(2)])).key, 'none');
});

test('Krafttraining: Sätze pro Muskelgruppe und Entwicklung je Übung', () => {
  const mk = (daysAgo, kg) => core.buildActivity(core.parseFit(makeActivity({
    start: Date.now() - daysAgo * DAY, seconds: 1800, step: 5, speed: 0, hr: 110, sport: 10, subSport: 20,
    sets: [{ t0: 60, dur: 40, reps: 8, kg, cat: 28, sub: 6 }, { t0: 200, dur: 40, reps: 8, kg, cat: 28, sub: 6 }, { t0: 400, dur: 40, reps: 12, kg: null, cat: 22, sub: 0 }]
  })));
  const acts = [mk(20, 60), mk(10, 65), mk(2, 70)];
  const s = core.strengthSummary(acts);
  assert.equal(s.total, 3);
  const sq = s.exercises.find(e => e.cat === 28);
  assert.equal(sq.label, 'Kniebeuge');
  assert.equal(sq.name, 'Barbell Back Squat');
  assert.equal(sq.count, 3);
  assert.ok(sq.trend > 15, 'Trend ' + sq.trend);
  assert.equal(sq.hist[2].topKg, 70);
  assert.ok(Math.abs(sq.hist[2].best - 70 * (1 + 8 / 30)) < 0.1);
  assert.ok(Math.abs(s.setsWeek['Beine'] - 1.4) < 1e-9);
  assert.ok(Math.abs(s.setsWeek['Brust'] - 0.7) < 1e-9);
  assert.equal(s.weeks.length, 8);
});

test('Übungsnamen aus dem FIT SDK, auch für lückenhafte Tabellen', () => {
  assert.equal(core.exerciseName(28, 6), 'Barbell Back Squat');
  assert.equal(core.exerciseName(0, 1), 'Barbell Bench Press');
  assert.equal(core.exerciseName(28, 99999), null);
  assert.equal(core.catName(8), 'Kreuzheben');
  assert.equal(core.catName(12345), 'Unbekannte Übung');
});

// --- Wochenplan mit Kraft und festen Terminen
const history = (() => { const a = []; for (let i = 1; i <= 50; i++) if (i % 7 !== 0 && i % 7 !== 3) a.push(run(i, { seconds: i % 7 === 6 ? 6000 : 3000, hr: i % 7 === 2 ? 160 : 140 })); return a; })();
function plan(S){
  const Pp = core.estimateParams(history, S), der = {};
  for (const a of history) der[a.id] = core.derive(a, Pp);
  const vd = core.estimateVdot(history, S);
  return core.buildPlan({ S, acts: history, der, P: Pp, paces: vd ? core.trainingPaces(vd.vdot) : null, series: core.loadSeries(history, der), vd, rec: null, W: core.newWellness() });
}
const clean = p => assert.ok(!/undefined|NaN|Infinity/.test(JSON.stringify(p)));
const iso = ts => core.dayKey(ts);

test('Fußball montags: Qualität nie am Dienstag, Fußball als optionaler Termin', () => {
  const at = w => iso(Date.now() + w * 7 * DAY);
  for (const n of [3, 4, 5, 6]){
    const p = plan({ goal: 'm', runsPerWeek: n, teamDays: [0], raceDate: at(12) });
    clean(p);
    assert.equal(p.sessions[0].type, 'T');
    assert.equal(p.sessions[0].title, 'Fußball');
    assert.notEqual(p.sessions[1].type, 'Q', n + ' Läufe: Dienstag darf keine Qualität sein');
    const runs = p.sessions.filter(s => ['Q', 'E', 'L'].includes(s.type)).length;
    assert.ok(runs <= n);
    const q = p.sessions.filter(s => s.type === 'Q').map(s => s.day);
    for (let i = 1; i < q.length; i++) assert.ok(q[i] - q[i - 1] > 1, 'keine Qualität an zwei Tagen hintereinander');
  }
});

test('Krafttraining wird eingeplant, nie vor dem langen Lauf mit Beinen', () => {
  const p0 = plan({ goal: 'hm', runsPerWeek: 4, strengthPerWeek: 2, teamDays: [0] });
  clean(p0);
  if (p0.fatigued || p0.recovery){ // bei Ermüdung höchstens eine leichte Einheit
    const ks = p0.sessions.flatMap(s => [s, ...(s.extra || [])]).filter(x => x.type === 'K');
    assert.equal(ks.length, 1); assert.equal(ks[0].focus, 'light');
  }
  // ausgeruhter Zustand: Belastung der letzten Tage herausnehmen
  const rested = history.filter(a => Date.now() - a.start > 4 * DAY);
  const Pp = core.estimateParams(rested, {}), der = {}; for (const a of rested) der[a.id] = core.derive(a, Pp);
  const S = { goal: 'hm', runsPerWeek: 4, strengthPerWeek: 2, teamDays: [0], raceDate: iso(Date.now() + 11 * 7 * DAY) }; // 11 Wochen: Aufbau, keine Entlastungswoche
  const p = core.buildPlan({ S, acts: rested, der, P: Pp, paces: null, series: core.loadSeries(rested, der), vd: null, rec: null, W: core.newWellness() });
  clean(p);
  assert.ok(!p.fatigued && !p.recovery, 'Testaufbau: nicht ermüdet');
  const kDays = p.sessions.filter(s => s.type === 'K' || (s.extra && s.extra.some(x => x.type === 'K'))).map(s => s.day);
  assert.equal(kDays.length, 2);
  for (let i = 1; i < kDays.length; i++) assert.ok(kDays[i] - kDays[i - 1] > 1, 'nicht an zwei Tagen hintereinander');
  const L = p.sessions.find(s => s.type === 'L').day;
  const before = p.sessions[L - 1];
  const k = before.type === 'K' ? before : (before.extra || [])[0];
  if (k) assert.equal(k.focus, 'core', 'vor dem langen Lauf nur Rumpf & Oberkörper');
  assert.ok(kDays.includes(5), 'Samstag: lockerer Lauf + Kraft');
  assert.ok(p.sessions[5].extra && p.sessions[5].type === 'E');
});

test('Wettkampfwoche ohne Krafttraining', () => {
  const race = new Date(); race.setDate(race.getDate() + ((6 - (race.getDay() + 6) % 7) + 7) % 7);
  const p = plan({ goal: 'hm', strengthPerWeek: 3, raceDate: iso(race.getTime()), teamDays: [0] });
  clean(p);
  assert.ok(!p.sessions.some(s => s.type === 'K' || s.extra));
});

test('5 Läufe + Fußball montags: zwei Qualitätseinheiten passen (z. B. Mi + Fr)', () => {
  const rested = history.filter(a => Date.now() - a.start > 4 * DAY);
  const Pp = core.estimateParams(rested, {}), der = {}; for (const a of rested) der[a.id] = core.derive(a, Pp);
  const S = { goal: 'hm', runsPerWeek: 5, teamDays: [0], raceDate: iso(Date.now() + 10 * 7 * DAY) }; // Aufbau, keine Entlastungswoche
  const p = core.buildPlan({ S, acts: rested, der, P: Pp, paces: null, series: core.loadSeries(rested, der), vd: null, rec: null, W: core.newWellness() });
  clean(p);
  assert.ok(!p.fatigued && !p.recovery && p.phase === 'Aufbau', 'Testaufbau');
  const q = p.sessions.filter(s => s.type === 'Q').map(s => s.day);
  assert.equal(q.length, 2, 'Qualitätstage: ' + q.join(','));
  assert.ok(!q.includes(1), 'nicht am Dienstag nach dem Fußball');
  assert.ok(q[1] - q[0] >= 2);
  const L = p.sessions.find(s => s.type === 'L').day;
  assert.ok(!q.includes(L - 1), 'nicht am Tag vor dem langen Lauf');
});
