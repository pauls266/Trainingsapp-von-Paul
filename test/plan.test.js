const test = require('node:test');
const assert = require('node:assert/strict');
const { core, DAY } = require('./helpers.js');
const { makeActivity } = require('./fit-encoder.js');

const act = (daysAgo, o = {}) => {
  const d = new Date(Date.now() - daysAgo * DAY); d.setHours(7, 0, 0, 0);
  return core.buildActivity(core.parseFit(makeActivity({ start: d.getTime(), step: 5, seconds: 3000, speed: 3, hr: 140, ...o })));
};
const history = (() => {
  const a = [];
  for (let i = 1; i <= 60; i++) if (i % 7 !== 0 && i % 7 !== 3) a.push(act(i, { seconds: i % 7 === 6 ? 6000 : 3000, hr: i % 7 === 2 ? 160 : 140 }));
  return a;
})();

function plan(S, acts = history){
  const P = core.estimateParams(acts, S), der = {};
  for (const a of acts) der[a.id] = core.derive(a, P);
  const vd = core.estimateVdot(acts, S), paces = vd ? core.trainingPaces(vd.vdot) : null;
  const series = core.loadSeries(acts, der);
  return core.buildPlan({ S, acts, der, P, paces, series, vd, rec: null, W: core.newWellness() });
}
// Kein undefined/NaN in irgendeinem Text oder Wert des Plans
function assertClean(p){
  const json = JSON.stringify(p);
  assert.ok(!/undefined|NaN|Infinity/.test(json), json.match(/.{40}(undefined|NaN|Infinity).{20}/));
}
const iso = ts => core.dayKey(ts);

test('Plan ohne Wettkampf: Grundlage, 7 Tage, sinnvolle Umfänge', () => {
  const p = plan({ goal: 'm', runsPerWeek: 4 });
  assertClean(p);
  assert.equal(p.phase, 'Grundlage');
  assert.equal(p.sessions.length, 7);
  assert.equal(p.sessions.filter(s => s.type !== 'R').length, 4);
  assert.ok(p.V >= 12);
  assert.ok(p.sessions.some(s => s.type === 'L'));
});

test('Phasen je nach Wochen bis zum Wettkampf', () => {
  const at = w => iso(Date.now() + w * 7 * DAY);
  assert.equal(plan({ goal: 'm', raceDate: at(12) }).phase, 'Aufbau');
  assert.equal(plan({ goal: 'm', raceDate: at(5) }).phase, 'Spezifisch');
  assert.equal(plan({ goal: 'hm', raceDate: at(1) }).phase, 'Tapering');
  assert.equal(plan({ goal: 'm', raceDate: at(30) }).phase, 'Grundlage');
  assert.equal(plan({ goal: 'm', raceDate: at(-2) }).phase, 'Grundlage');
});

test('Rennwoche: Wettkampf am richtigen Tag', () => {
  const race = new Date(); race.setDate(race.getDate() + ((6 - (race.getDay() + 6) % 7) + 7) % 7); // Sonntag dieser Woche
  const p = plan({ goal: 'hm', raceDate: iso(race.getTime()), targetTime: '1:40:00' });
  assertClean(p);
  const w = p.sessions.find(s => s.type === 'W');
  assert.ok(w, 'Wettkampftag fehlt');
  assert.equal(w.day, 6);
  assert.ok(p.goalCheck && p.goalCheck.verdict);
});

test('3 bis 6 Läufe pro Woche', () => {
  for (const n of [3, 4, 5, 6]){
    const p = plan({ goal: 'm', runsPerWeek: n });
    assertClean(p);
    assert.equal(p.sessions.filter(s => s.type !== 'R').length, n);
  }
});

test('Plan funktioniert ganz ohne Daten', () => {
  const p = plan({ goal: 'hm' }, []);
  assertClean(p);
  assert.equal(p.sessions.length, 7);
  assert.ok(p.notes.length >= 1);
});

test('Plan mit alten Datensätzen ohne neue Felder', () => {
  const old = history.map(a => { const o = { ...a }; delete o.watch; delete o.hr30; delete o.bestT; return o; });
  for (const o of old) o.bestT = {};
  assertClean(plan({ goal: 'm' }, old));
});

test('Ziel-Check mit Kurzschreibweise „1:45“ für den Halbmarathon', () => {
  const p = plan({ goal: 'hm', targetTime: '1:45' });
  assertClean(p);
  assert.ok(p.goalCheck);
  assert.ok(Math.abs(p.goalCheck.pace - 6300 / 21.0975) < 0.01);
});
