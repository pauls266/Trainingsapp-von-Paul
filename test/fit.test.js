const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers.js');
const { makeActivity, FitWriter } = require('./fit-encoder.js');

const START = Date.UTC(2026, 8, 1, 6, 0, 0);
const run = extra => makeActivity({ start: START, seconds: 1800, speed: 10000/3000, hr: 150, ...extra });

test('Parser liest einen normalen Lauf', () => {
  const fit = core.parseFit(run());
  assert.equal(fit.session.length, 1);
  assert.equal(fit.file_id.length, 1);
  assert.equal(fit.record.length, 1801);
  const a = core.buildActivity(fit);
  assert.equal(a.id, String(START));
  assert.equal(a.start, START);
  assert.equal(a.isRun, true);
  assert.equal(a.sport, 1);
  assert.equal(a.timer, 1800);
  assert.ok(Math.abs(a.dist - 6000) < 1, 'Distanz ' + a.dist);
  assert.equal(a.avgHR, 150);
  assert.equal(a.maxHR, 150);
  assert.ok(Math.abs(a.avgSpd - 3.333) < 0.01);
  assert.equal(a.cad, 170, 'Schrittfrequenz wird beim Laufen verdoppelt');
  assert.equal(a.stream.t.length, a.stream.hr.length);
  assert.equal(a.stream.t[0], 0);
  assert.equal(a.stream.t[1], 5);
  // 1 km in 300 s, 5 km in 1500 s
  assert.ok(Math.abs(a.bestD[1000] - 300) <= 1, 'bestD 1000 = ' + a.bestD[1000]);
  assert.ok(Math.abs(a.bestD[5000] - 1500) <= 1);
  assert.equal(a.bestD[10000], undefined);
  assert.ok(Math.abs(a.bestT[1200] - 4000) <= 5);
  assert.equal(a.hr30, 150);
});

test('Big-Endian ergibt dieselbe Aktivität', () => {
  const le = core.buildActivity(core.parseFit(run()));
  const be = core.buildActivity(core.parseFit(run({ bigEndian: true })));
  assert.deepEqual(be, le);
});

test('Komprimierte Zeitstempel-Header werden korrekt fortgeschrieben', () => {
  const plain = core.buildActivity(core.parseFit(run()));
  const fit = core.parseFit(run({ compressed: true }));
  assert.equal(fit.record.length, 1801);
  const ts = fit.record.map(r => r[253]);
  for (let i = 1; i < ts.length; i++) assert.equal(ts[i] - ts[i-1], 1, 'Zeitstempel-Lücke bei ' + i);
  assert.deepEqual(core.buildActivity(fit), plain);
});

test('Entwicklerfelder werden übersprungen', () => {
  const plain = core.buildActivity(core.parseFit(run()));
  const dev = core.buildActivity(core.parseFit(run({ devFields: true })));
  assert.deepEqual(dev, plain);
});

test('Abgeschnittene Datei liefert die vorhandenen Daten', () => {
  const buf = makeActivity({ start: START, seconds: 1800, speed: 3, hr: 140, noSession: true, truncateBy: 20 });
  const fit = core.parseFit(buf);
  assert.ok(fit.record.length > 1700);
  const a = core.buildActivity(fit);
  assert.ok(a, 'Aktivität trotz fehlender Session');
  assert.equal(a.start, START);
  assert.ok(a.dist > 5000);
});

test('Ungültige Werte (0xFF usw.) werden ignoriert', () => {
  const a = core.buildActivity(core.parseFit(run({ hr: () => null })));
  assert.equal(a.avgHR, null);
  assert.ok(a.stream.hr.every(h => h === 0));
  assert.equal(a.hr30, null);
});

test('Uhr-Einstellungen (LTHR, HFmax, Ruhepuls, Geschlecht) werden übernommen', () => {
  const a = core.buildActivity(core.parseFit(run({ watch: { lthr: 168, maxHR: 190, rest: 48, sex: 'm' } })));
  assert.deepEqual(a.watch, { lthr: 168, maxHR: 190, rest: 48, sex: 'm' });
});

test('Nicht-Lauf-Aktivität bekommt keine Bestzeiten', () => {
  const a = core.buildActivity(core.parseFit(run({ sport: 2, speed: 8 })));
  assert.equal(a.isRun, false);
  assert.deepEqual(a.bestD, {});
  assert.equal(a.name, 'Radfahren');
});

test('Keine FIT-Datei bzw. zu kleine Datei wirft einen Fehler', () => {
  assert.throws(() => core.parseFit(new ArrayBuffer(10)), /zu klein/);
  const b = new Uint8Array(40); b[0] = 14;
  assert.throws(() => core.parseFit(b.buffer), /Keine FIT-Datei/);
});

test('Datei ohne Records und ohne Session ergibt keine Aktivität', () => {
  const w = new FitWriter();
  w.define(0, 0, [{ num: 0, type: 'enum' }]).data(0, { 0: 4 });
  assert.equal(core.buildActivity(core.parseFit(w.build())), null);
});
