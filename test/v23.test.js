const test = require('node:test');
const assert = require('node:assert/strict');
const { core, DAY } = require('./helpers.js');

const run = (id, daysAgo, km) => ({ id, kind: 'run', start: Date.now() - daysAgo * DAY, dist: km * 1000 });

test('Laufschuhe: Startkilometer plus zugeordnete Läufe', () => {
  const shoes = [{ id: 's1', name: 'Pegasus', startKm: 320, limitKm: 700 }, { id: 's2', name: 'Vaporfly', startKm: 0 }];
  const acts = [run('a', 1, 10), run('b', 3, 21.1), run('c', 5, 8), { id: 'k', kind: 'strength', start: Date.now(), dist: 0 }];
  const annot = { a: { shoe: 's1' }, b: { shoe: 's2' }, c: { shoe: 's1', rpe: 4 } };
  const st = core.shoeStats(shoes, acts, annot);
  assert.equal(st[0].km, 338);
  assert.equal(st[0].runs, 2);
  assert.equal(st[0].limit, 700);
  assert.equal(st[1].km, 21.1);
  assert.equal(st[1].limit, 700, 'Standardgrenze 700 km');
  assert.ok(st[0].last > st[1].last);
  assert.deepEqual(core.shoeStats(undefined, acts, annot), []);
});

test('Laufschuhe: nur neue Läufe ohne Zuordnung werden abgefragt', () => {
  const acts = [run('a', 1, 10), run('b', 3, 12), run('c', 40, 8), { id: 'k', kind: 'strength', start: Date.now() }];
  const since = Date.now() - 10 * DAY;
  assert.deepEqual(core.unassignedRuns(acts, { b: { shoe: 's1' } }, since).map(a => a.id), ['a']);
  assert.deepEqual(core.unassignedRuns(acts, { a: { shoe: 'none' } }, since).map(a => a.id), ['b']);
  assert.equal(core.unassignedRuns(acts, {}, 0).length, 3);
});

const { makeActivity } = require('./fit-encoder.js');
function hist(){
  const a = [];
  for (let i = 1; i <= 40; i++) if (i % 7 !== 0 && i % 7 !== 3){
    const d = new Date(Date.now() - i * DAY); d.setHours(7, 0, 0, 0);
    a.push(core.buildActivity(core.parseFit(makeActivity({ start: d.getTime(), step: 5, seconds: 3000, speed: 3, hr: 140 }))));
  }
  return a;
}
function plans(S, todayTs){
  const acts = hist(), P = core.estimateParams(acts, S), der = {};
  for (const a of acts) der[a.id] = core.derive(a, P);
  const series = core.loadSeries(acts, der), base = { S, acts, der, P, paces: null, series, vd: null, rec: null, W: core.newWellness() };
  const t = new Date(todayTs); t.setHours(12, 0, 0, 0);
  const cur = core.buildPlan({ ...base, today: t.getTime() });
  const nm = new Date(t); nm.setDate(nm.getDate() + (7 - (nm.getDay() + 6) % 7));
  const next = core.buildPlan({ ...base, today: nm.getTime(), preview: true });
  return { cur, next, days: core.nextSevenDays(cur, next, t.getTime()) };
}

test('Plan: immer die nächsten 7 Tage – auch am Sonntag', () => {
  // nächster Sonntag (oder heute, falls Sonntag)
  const sun = new Date(); sun.setDate(sun.getDate() + (7 - sun.getDay()) % 7);
  const { days, next } = plans({ goal: 'hm', runsPerWeek: 4, teamDays: [0] }, sun.getTime());
  assert.equal(days.length, 7);
  assert.equal(days[0].day, 6, 'heute = Sonntag');
  assert.equal(days[0].preview, false);
  assert.equal(days[1].day, 0, 'morgen = Montag');
  assert.equal(days[1].preview, true);
  assert.equal(days[1].type, 'T', 'Montag: Fußball aus der Vorschau');
  assert.deepEqual(days.map(d => d.offset), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(!/undefined|NaN/.test(JSON.stringify(days)));
  assert.ok(next.V >= 12);
});

test('Plan: am Montag kommen alle 7 Tage aus der laufenden Woche', () => {
  const mon = new Date(); mon.setDate(mon.getDate() + (8 - mon.getDay()) % 7);
  const { days } = plans({ goal: 'm', runsPerWeek: 5 }, mon.getTime());
  assert.equal(days.length, 7);
  assert.ok(days.every(d => !d.preview));
  assert.deepEqual(days.map(d => d.day), [0, 1, 2, 3, 4, 5, 6]);
});

test('Kurzbefehl: neue H-Zeilen (Herzfrequenz) sind optional und abwärtskompatibel', () => {
  const now = Date.now(), iso = t => new Date(t).toISOString();
  const txt = ['LB1', `R;${iso(now - 3600e3)};50;Connect`, `H;${iso(now - 600e3)};112;Connect`, `H;${iso(now - 540e3)};130 bpm;Connect`, `H;${iso(now - 40 * 864e5)};99;Connect`].join('\n');
  const recs = core.parseShortcutText(txt);
  assert.equal(recs.filter(r => r.k === 'H').length, 3);
  const W = core.newWellness(), r = core.ingestWellness(W, recs, now);
  assert.equal(r.rhr, 1);
  assert.equal(r.hr, 2, 'Werte älter als 21 Tage werden verworfen');
  assert.equal(Object.keys(W.hr).length, 2);
  // alte Wellness-Daten ohne hr-Feld funktionieren
  const old = { rhr: {}, sleep: {} };
  assert.equal(core.ingestWellness(old, recs, now).hr, 2);
});

test('Health-XML: Herzfrequenz nur der letzten 3 Wochen', () => {
  const recs = [], d = t => new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +0000');
  core.parseHealthXmlLine(` <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Connect" startDate="${d(Date.now() - 864e5)}" value="141"/>`, recs);
  core.parseHealthXmlLine(` <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Connect" startDate="${d(Date.now() - 90 * 864e5)}" value="141"/>`, recs);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].v, 141);
});

test('Krafttraining: Puls aus Health wird der eingetragenen Einheit zugeordnet', () => {
  const start = Date.now() - 2 * 3600e3, W = core.newWellness(), recs = [];
  for (let i = 0, t = start - 600e3; t <= start + 3000e3; t += 90e3, i++) recs.push({ k: 'H', t, v: 108 + (i % 5) * 6, src: 'Connect' });
  core.ingestWellness(W, recs);
  const m = core.normalizeAct({ id: 'm1', src: 'manual', kind: 'strength', start, timer: 2700, sport: 10, subSport: 20, sets: [] });
  assert.equal(core.attachHealthHR([m], W), 1);
  assert.equal(m.hrSrc, 'health');
  assert.ok(m.avgHR > 100 && m.avgHR < 140);
  assert.ok(m.maxHR <= 132);
  assert.equal(m.stream.t.length, 2700 / 5 + 1);
  const d = core.derive(m, { lthr: 170, maxHR: 190, restHR: 50, sex: 'm' }, {});
  assert.equal(d.src, 'hr');
  assert.ok(d.trimp > 10);
  // ohne passende Werte bleibt alles, wie es war
  const m2 = core.normalizeAct({ id: 'm2', src: 'manual', kind: 'strength', start: start - 5 * 864e5, timer: 1800 });
  assert.equal(core.attachHealthHR([m2], W), 0);
  assert.equal(m2.hrSrc, undefined);
});

test('Krafttraining: eingetragene Einheit und Uhr-Aufzeichnung werden als dieselbe erkannt', () => {
  const t = Date.now() - 864e5;
  const man = { id: 'm', src: 'manual', kind: 'strength', start: t, timer: 2700 };
  const watch = { id: 'w', kind: 'strength', sport: 10, subSport: 20, start: t + 10 * 60000, timer: 2400 };
  const run = { id: 'r', kind: 'run', sport: 1, start: t + 5 * 60000, timer: 1800 };
  const other = { id: 'o', kind: 'strength', sport: 10, start: t + 5 * 3600e3, timer: 1800 };
  assert.equal(core.findStrengthPartner(man, [man, run, other, watch]).id, 'w');
  assert.equal(core.findStrengthPartner(watch, [watch, man]).id, 'm');
  assert.equal(core.findStrengthPartner(other, [other, man]), null);
});
