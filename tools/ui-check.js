// Entwickler-Werkzeug (wird nicht ausgeliefert): öffnet die App in einem unsichtbaren Chromium,
// klickt alle Ansichten durch und meldet „undefined“, „NaN“ und Skriptfehler.
// Szenarien: ohne Daten, mit synthetischen Daten, mit alten Datensätzen.
// Aufruf: npm run ui-check   (benötigt Playwright, z. B. global installiert)
process.env.TZ = 'Europe/Berlin';
const http = require('http'), fs = require('fs'), path = require('path');
const core = require('../core.js');
const { makeActivity } = require('../test/fit-encoder.js');

function loadPlaywright(){
  try { return require('playwright'); } catch (e) {}
  const root = require('child_process').execSync('npm root -g').toString().trim();
  return require(path.join(root, 'playwright'));
}

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };
function serve(){
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(0, () => res(srv));
  });
}

const DAY = 864e5;
function syntheticActs(){
  const acts = [];
  for (let i = 0; i <= 70; i++){
    if (i % 7 === 3) continue;
    const d = new Date(Date.now() - i * DAY); d.setHours(7, 0, 0, 0);
    const long = i % 7 === 6, hard = i % 7 === 2, bike = i % 7 === 4 && i > 20;
    acts.push(core.buildActivity(core.parseFit(makeActivity({
      start: d.getTime(), step: 5, seconds: long ? 6600 : 3000,
      speed: bike ? 7 : (hard ? t => (Math.floor(t / 300) % 2 ? 4.2 : 3) : 3.1),
      hr: hard ? t => (Math.floor(t / 300) % 2 ? 168 : 145) : t => 138 + Math.round(t / 600),
      sport: bike ? 2 : 1, watch: i === 0 ? { lthr: 168, maxHR: 190, rest: 47, sex: 'm' } : undefined
    }))));
  }
  const noHr = new Date(Date.now() - 5 * DAY); noHr.setHours(18, 0, 0, 0);
  acts.push(core.buildActivity(core.parseFit(makeActivity({ start: noHr.getTime(), step: 5, seconds: 2400, speed: 0, hr: () => null, sport: 4 }))));
  return acts;
}
function oldActs(){
  // Datensätze wie aus einer früheren Version: ohne Uhr-Werte, ohne Bestzeiten nach Dauer usw.
  return syntheticActs().map(a => { const o = { ...a }; delete o.watch; delete o.bestT; delete o.hr30; delete o.ane; delete o.te; return o; });
}
function wellness(){
  const W = core.newWellness(), recs = [], now = Date.now();
  for (let i = 0; i < 40; i++){
    recs.push({ k:'R', t: now - i * DAY, v: 47 + (i % 3), src: 'Connect' });
    const e = new Date(now - i * DAY); e.setHours(6, 30, 0, 0);
    recs.push({ k:'S', s: e.getTime() - 7 * 3600e3, e: e.getTime(), kind: 'core', src: 'Connect' });
  }
  core.ingestWellness(W, recs);
  return W;
}

async function seed(page, acts, W, S){
  await page.evaluate(async ({ acts, W, S }) => {
    // Jeder Durchlauf hat einen frischen Browser-Kontext, der Speicher ist also anfangs leer.
    if (!acts) return;
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('laufbuch', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('acts', { keyPath: 'id' }); r.result.createObjectStore('meta'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const t = db.transaction(['acts', 'meta'], 'readwrite');
      for (const a of acts) t.objectStore('acts').put(a);
      if (W) t.objectStore('meta').put(W, 'wellness');
      if (S) t.objectStore('meta').put(S, 'settings');
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    db.close();
  }, { acts, W, S });
}

const BAD = /\bundefined\b|\bNaN\b|\bInfinity\b|\[object Object\]/;
async function check(page, label, problems){
  await page.waitForTimeout(150);
  const txt = await page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('svg')].map(s => s.outerHTML).join(''));
  const m = txt.match(BAD);
  if (m) problems.push(label + ': „' + m[0] + '“ bei …' + txt.slice(Math.max(0, m.index - 60), m.index + 30).replace(/\s+/g, ' ') + '…');
}

(async () => {
  const srv = await serve(), url = 'http://127.0.0.1:' + srv.address().port + '/';
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const problems = [];
  const scenarios = [
    ['ohne Daten', null, null, null],
    ['synthetische Daten', syntheticActs(), wellness(), { goal:'hm', runsPerWeek:5, raceDate: core.dayKey(Date.now() + 8 * 7 * DAY), targetTime:'1:45:00', sleepTarget:'7.5' }],
    ['alte Datensätze', oldActs(), null, null]
  ];
  for (const [name, acts, W, S] of scenarios){
    for (const theme of ['light', 'dark']){
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      // Externe Anfragen (Schriften, CDN) blockieren: Die App muss auch ohne sie laufen.
      await page.route(u => !u.href.startsWith(url), r => r.abort());
      page.on('pageerror', e => problems.push(`${name}/${theme}: Skriptfehler: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) problems.push(`${name}/${theme}: Konsole: ${m.text()}`); });
      await page.goto(url);
      await seed(page, acts, W, S);
      await page.reload(); await page.waitForTimeout(300);
      const L = s => `${name}/${theme}/${s}`;
      for (const tab of ['heute', 'laeufe', 'plan', 'zonen', 'trends']){
        await page.click(`#tabs button[data-tab="${tab}"]`);
        await check(page, L(tab), problems);
        if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name.replace(/\s/g,'_')}-${theme}-${tab}.png`), fullPage: true });
      }
      await page.click('#settingsBtn'); await check(page, L('Einstellungen'), problems);
      await page.keyboard.press('Escape');
      await page.click('#tabs button[data-tab="laeufe"]');
      const first = await page.$('[data-act]');
      if (first){ await first.click(); await check(page, L('Detailansicht'), problems); await page.keyboard.press('Escape'); }
      const w = await page.$('[data-action="wellness"]');
      if (w){ await w.click(); await check(page, L('Tageswerte'), problems); await page.keyboard.press('Escape'); }
      await ctx.close();
    }
  }
  await browser.close(); srv.close();
  if (problems.length){ console.error('Probleme gefunden:\n- ' + [...new Set(problems)].join('\n- ')); process.exit(1); }
  console.log('Alle Ansichten ohne „undefined“/„NaN“ und ohne Skriptfehler (' + scenarios.length * 2 + ' Durchläufe).');
})().catch(e => { console.error(e); process.exit(1); });
