const test = require('node:test');
const assert = require('node:assert/strict');
const { core, DAY } = require('./helpers.js');
const { makeActivity } = require('./fit-encoder.js');

const act = (daysAgo, o = {}) => {
  const d = new Date(Date.now() - daysAgo * DAY); d.setHours(7, 0, 0, 0);
  return core.buildActivity(core.parseFit(makeActivity({ start: d.getTime(), step: 5, seconds: 3000, speed: 3, hr: 140, ...o })));
};

test('HF-Zonen nach Friel', () => {
  assert.deepEqual(core.hrBounds(170), [145, 153, 162, 170]);
  const b = core.hrBounds(170);
  assert.equal(core.zoneOf(140, b), 0);
  assert.equal(core.zoneOf(145, b), 1);
  assert.equal(core.zoneOf(160, b), 2);
  assert.equal(core.zoneOf(165, b), 3);
  assert.equal(core.zoneOf(185, b), 4);
});

test('Parameter: Reihenfolge eigene Eingabe > Uhr > Schätzung', () => {
  const a = act(3, { watch: { lthr: 165, maxHR: 188, rest: 47, sex: 'm' }, hr: 172 });
  let P = core.estimateParams([a], { lthr: '170', maxHR: '195', restHR: '45' });
  assert.equal(P.lthr, 170); assert.equal(P.maxHR, 195); assert.equal(P.restHR, 45);
  assert.equal(P.src.lthr, 'eigene Eingabe');
  P = core.estimateParams([a], {});
  assert.equal(P.lthr, 165); assert.equal(P.restHR, 47);
  P = core.estimateParams([], {});
  assert.equal(P.maxHR, 190); assert.equal(P.lthr, 171); assert.equal(P.restHR, 55);
  P = core.estimateParams([], { age: '40' });
  assert.equal(P.maxHR, 180);
});

test('TRIMP und Zonenzeit; Schätzung ohne HF', () => {
  const P = { lthr: 170, maxHR: 190, restHR: 50, sex: 'm' };
  const d = core.derive(act(1, { hr: 140 }), P);
  assert.ok(d.trimp > 40 && d.trimp < 80, 'TRIMP ' + d.trimp);
  assert.equal(d.hrEst, false);
  assert.equal(d.zs.reduce((a, c) => a + c, 0), d.zs[0]);
  const f = core.derive(act(1, { hr: 140 }), { ...P, sex: 'f' });
  assert.ok(f.trimp > d.trimp * 0.9 && f.trimp !== d.trimp);
  const n = core.derive(act(1, { hr: () => null }), P);
  assert.equal(n.hrEst, true);
  assert.equal(n.trimp, 50);
});

test('Aerobe Entkopplung bei steigender HF', () => {
  const P = { lthr: 170, maxHR: 190, restHR: 50, sex: 'm' };
  const a = act(1, { seconds: 3600, hr: t => 135 + Math.round(t / 3600 * 12) });
  const d = core.derive(a, P);
  assert.ok(d.dec > 3 && d.dec < 10, 'dec ' + d.dec);
  assert.ok(d.ef > 1);
});

test('VDOT nach Daniels (Tabellenwerte)', () => {
  assert.ok(Math.abs(core.vdotFrom(5000, 20 * 60) - 49.8) < 0.3);
  assert.ok(Math.abs(core.vdotFrom(42195, 3 * 3600) - 53.5) < 0.5);
  const t = core.predictTime(21097.5, 50);
  assert.ok(Math.abs(core.vdotFrom(21097.5, t) - 50) < 0.01);
  const p = core.trainingPaces(50);
  assert.ok(p.E[0] > p.E[1] && p.E[1] > p.M && p.M > p.HM && p.HM > p.T && p.T > p.I);
});

test('VDOT aus Wettkampf-Eingabe oder Training', () => {
  assert.ok(Math.abs(core.estimateVdot([], { raceDist: '5', raceTime: '20:00' }).vdot - 49.8) < 0.3);
  const v = core.estimateVdot([act(10, { speed: 4 })], {});
  assert.ok(v && v.fromTraining && v.vdot > 40 && v.vdot < 60);
  assert.equal(core.estimateVdot([], {}), null);
});

test('Fitness, Ermüdung und Form', () => {
  const P = { lthr: 170, maxHR: 190, restHR: 50, sex: 'm' };
  const acts = [];
  for (let i = 1; i <= 42; i += 2) acts.push(act(i));
  const der = {}; for (const a of acts) der[a.id] = core.derive(a, P);
  const s = core.loadSeries(acts, der);
  assert.equal(s[s.length - 1].date, core.dayKey(Date.now()));
  const last = s[s.length - 1];
  assert.ok(last.ctl > 0 && last.atl > 0);
  assert.ok(s.every(x => isFinite(x.ctl) && isFinite(x.atl) && isFinite(x.tsb)));
  assert.deepEqual(core.loadSeries([], {}), []);
});

test('Wochenkilometer', () => {
  const w = core.weeklyKm([act(0, { seconds: 3000, speed: 3.333 })], 4);
  assert.equal(w.length, 4);
  assert.ok(Math.abs(w[3].km - 10) < 0.1);
  assert.equal(w[0].km, 0);
});

test('Zeitangaben einlesen und formatieren', () => {
  assert.equal(core.parseDuration('1:45:30'), 6330);
  assert.equal(core.parseDuration('20:00'), 1200);
  assert.equal(core.parseDuration('abc'), 0);
  assert.equal(core.parseDuration(''), 0);
  assert.equal(core.fmtPace(300), '5:00');
  assert.equal(core.fmtPace(null), '–');
  assert.equal(core.fmtDur(3725), '1:02:05');
  assert.equal(core.fmtHM(455), '7:35 h');
});

test('Zielzeit: „3:15“ bedeutet 3 h 15 min, nicht 3 min 15 s', () => {
  assert.equal(core.parseGoalTime('3:15'), 3 * 3600 + 15 * 60);
  assert.equal(core.parseGoalTime('1:45:00'), 6300);
  assert.equal(core.parseGoalTime('3:15:30'), 11730);
  assert.equal(core.parseGoalTime(''), 0);
  assert.equal(core.parseGoalTime('abc'), 0);
});

test('Zeitfelder (Std/Min/Sek) zusammensetzen und zerlegen', () => {
  assert.equal(core.joinDuration('3', '15', ''), '3:15:00');
  assert.equal(core.joinDuration('', '19', '30'), '0:19:30');
  assert.equal(core.joinDuration(' 1 ', '5', '7'), '1:05:07');
  assert.equal(core.joinDuration('', '', ''), '');
  assert.equal(core.joinDuration('0', '0', '0'), '');
  assert.equal(core.joinDuration('3', '75', '0'), null);
  assert.equal(core.joinDuration('3', '1', '60'), null);
  assert.equal(core.joinDuration('3', '1,5', ''), null);
  assert.deepEqual(core.splitDuration(11700), ['3', '15', '00']);
  assert.deepEqual(core.splitDuration(1170), ['0', '19', '30']);
  assert.deepEqual(core.splitDuration(0), ['', '', '']);
  // Rundweg: gespeicherter Text bleibt mit parseDuration lesbar
  assert.equal(core.parseDuration(core.joinDuration('', '19', '30')), 1170);
  assert.equal(core.parseDuration(core.joinDuration('3', '15', '')), 11700);
});
