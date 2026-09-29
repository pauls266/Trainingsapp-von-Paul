const test = require('node:test');
const assert = require('node:assert/strict');
const { core, DAY } = require('./helpers.js');

// Das Format des iOS-Kurzbefehls „Laufbuch Tageswerte“ darf nicht brechen.
const SHORTCUT = [
  'LB1',
  'R;2026-09-27T08:00:00+02:00;52;Pauls Apple Watch',
  'R;28.9.2026, 08:00;50 bpm;Connect',
  'S;2026-09-27T23:10:00+02:00;2026-09-28T02:10:00+02:00;Kern;Connect',
  'S;28.9.2026, 02:10;28.9.2026, 03:40;Tief;Connect',
  'S;28.9.2026, 03:40;28.9.2026, 05:10;REM;Connect',
  'S;28.9.2026, 05:10;28.9.2026, 05:25;Wach;Connect',
  'S;27.9.2026, 23:00;28.9.2026, 06:30;Im Bett;Connect',
  '',
  'Unbekannte Zeile',
  'W;2026-09-28T18:00:00+02:00;2026-09-28T19:30:00+02:00;Fußball;90'
].join('\r\n');

test('Kurzbefehl-Text: ISO- und deutsches Datum, Einheiten im Wert', () => {
  const recs = core.parseShortcutText(SHORTCUT);
  const R = recs.filter(r => r.k === 'R'), S = recs.filter(r => r.k === 'S');
  assert.equal(R.length, 2);
  assert.equal(S.length, 5);
  assert.equal(R[0].t, Date.parse('2026-09-27T08:00:00+02:00'));
  assert.equal(R[0].v, 52);
  assert.equal(R[0].src, 'Pauls Apple Watch');
  assert.equal(R[1].t, new Date(2026, 8, 28, 8, 0).getTime());
  assert.equal(R[1].v, 50);
  assert.deepEqual(S.map(s => s.kind), ['core', 'deep', 'rem', 'awake', 'inbed']);
});

test('Kurzbefehl-Text: unbekannte Zeilentypen werden ignoriert (abwärtskompatibel)', () => {
  const recs = core.parseShortcutText('LB1\nW;foo;bar\nX;1;2\nR;2026-09-20T07:00:00Z;55;Uhr');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].k, 'R');
});

test('Schlafphasen-Erkennung: deutsch, englisch, HK-Konstanten und Zahlen', () => {
  const cases = {
    'Kern': 'core', 'Leicht': 'core', 'Core': 'core', 'HKCategoryValueSleepAnalysisAsleepCore': 'core',
    'Tief': 'deep', 'HKCategoryValueSleepAnalysisAsleepDeep': 'deep',
    'REM': 'rem', 'HKCategoryValueSleepAnalysisAsleepREM': 'rem',
    'Wach': 'awake', 'HKCategoryValueSleepAnalysisAwake': 'awake',
    'Im Bett': 'inbed', 'HKCategoryValueSleepAnalysisInBed': 'inbed',
    'Schlafend': 'asleep', 'HKCategoryValueSleepAnalysisAsleepUnspecified': 'asleep',
    '0': 'inbed', '1': 'asleep', '2': 'awake', '3': 'core', '4': 'deep', '5': 'rem', 'Quatsch': null
  };
  for (const [k, v] of Object.entries(cases)) assert.equal(core.sleepKind(k), v, k);
});

test('Datumsformate', () => {
  assert.equal(core.parseHKDate('2026-09-28 07:15:00 +0200'), Date.parse('2026-09-28T07:15:00+02:00'));
  assert.equal(core.parseHKDate('25.9.2026, 08:00'), new Date(2026, 8, 25, 8, 0).getTime());
  assert.equal(core.parseHKDate('25.09.26 um 08:00'), new Date(2026, 8, 25, 8, 0).getTime());
  assert.equal(core.parseHKDate(''), null);
  assert.equal(core.parseHKDate('kein Datum'), null);
});

test('Nacht wird dem Tag des Aufwachens zugeordnet und summiert', () => {
  const W = core.newWellness();
  const today = new Date(2026, 8, 29, 12).getTime();
  const r = core.ingestWellness(W, core.parseShortcutText(SHORTCUT), today);
  assert.equal(r.rhr, 2);
  assert.equal(r.nights, 1);
  assert.equal(core.rhrOf(W, '2026-09-28'), 50);
  const n = core.sleepOf(W, '2026-09-28');
  assert.equal(n.core, 180);
  assert.equal(n.deep, 90);
  assert.equal(n.rem, 90);
  assert.equal(n.awake, 15);
  assert.equal(n.tot, 360);
  assert.equal(n.stages, true);
});

test('Erneuter Import derselben Daten verdoppelt nichts', () => {
  const W = core.newWellness(), today = new Date(2026, 8, 29, 12).getTime();
  core.ingestWellness(W, core.parseShortcutText(SHORTCUT), today);
  core.ingestWellness(W, core.parseShortcutText(SHORTCUT), today);
  assert.equal(core.sleepOf(W, '2026-09-28').tot, 360);
});

test('Health-XML-Zeilen: Ruhepuls und Schlaf, andere Records ignoriert', () => {
  const recs = [];
  core.parseHealthXmlLine(' <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Connect" unit="count/min" startDate="2026-09-20 07:00:00 +0200" endDate="2026-09-20 07:00:00 +0200" value="49"/>', recs);
  core.parseHealthXmlLine(' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Connect" startDate="2026-09-20 01:00:00 +0200" endDate="2026-09-20 02:00:00 +0200" value="HKCategoryValueSleepAnalysisAsleepDeep"/>', recs);
  core.parseHealthXmlLine(' <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Connect" startDate="2026-09-20 01:00:00 +0200" value="60"/>', recs);
  core.parseHealthXmlLine(' <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30"/>', recs);
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0], { k: 'R', t: Date.parse('2026-09-20T07:00:00+02:00'), v: 49, src: 'Connect' });
  assert.equal(recs[1].kind, 'deep');
});

test('Unplausible Werte werden verworfen', () => {
  const W = core.newWellness(), today = Date.now();
  const r = core.ingestWellness(W, [
    { k: 'R', t: today - DAY, v: 12, src: 'x' },
    { k: 'R', t: today - 800 * DAY, v: 50, src: 'x' },
    { k: 'S', s: today - DAY, e: today - DAY - 1000, kind: 'deep', src: 'x' },
    { k: 'S', s: today - 2 * DAY, e: today - DAY, kind: 'deep', src: 'x' }
  ], today);
  assert.equal(r.rhr, 0);
  assert.equal(r.nights, 0);
});

test('Erholungswert und Ruhepuls-Warnung', () => {
  const W = core.newWellness(), today = new Date(2026, 8, 29, 9).getTime(), recs = [];
  for (let i = 1; i <= 28; i++) recs.push({ k: 'R', t: today - i * DAY, v: 48, src: 'Connect' });
  for (let i = 0; i < 4; i++) recs.push({ k: 'R', t: today - i * DAY + 3600e3, v: 55, src: 'Connect' });
  core.ingestWellness(W, recs, today);
  const rec = core.recovery(W, [], { sleepTarget: '7.5' }, today);
  assert.ok(rec.hasData);
  assert.ok(rec.score >= 0 && rec.score <= 100);
  assert.ok(rec.streak >= 3, 'streak ' + rec.streak);
  const empty = core.recovery(core.newWellness(), [], {}, today);
  assert.ok(!empty.hasData);
});
