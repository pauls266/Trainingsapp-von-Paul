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
    const laps = hard ? Array.from({length: 10}, (_, k) => ({ t0: k * 300, dur: 300, dist: k % 2 ? 1260 : 900, hr: k % 2 ? 168 : 145 })) : undefined;
    acts.push(core.buildActivity(core.parseFit(makeActivity({
      start: d.getTime(), step: 5, seconds: long ? 6600 : 3000,
      speed: bike ? 7 : (hard ? t => (Math.floor(t / 300) % 2 ? 4.2 : 3) : 3.1),
      hr: hard ? t => (Math.floor(t / 300) % 2 ? 168 : 145) : t => 138 + Math.round(t / 600),
      sport: bike ? 2 : 1, watch: i === 0 ? { lthr: 168, maxHR: 190, rest: 47, sex: 'm' } : undefined,
      gps: i % 3 === 0 ? (t, dist) => [48.40 + Math.sin(dist / 900) * 0.01, 9.98 + Math.cos(dist / 900) * 0.015] : undefined,
      alt: (t, dist) => 480 + Math.sin(dist / 1500) * 15, laps
    }))));
    if (i % 7 === 1 || i % 7 === 5){ // Krafttraining mit Sätzen
      const k = new Date(d); k.setHours(18, 0, 0, 0);
      acts.push(core.buildActivity(core.parseFit(makeActivity({ start: k.getTime(), step: 5, seconds: 2400, speed: 0, hr: 105, sport: 10, subSport: 20,
        sets: [{ t0: 60, dur: 40, reps: 8, kg: 60 + (70 - i) / 4, cat: 28, sub: 6 }, { t0: 200, dur: 40, reps: 8, kg: 60 + (70 - i) / 4, cat: 28, sub: 6 },
               { t0: 400, dur: 40, reps: 10, kg: 40, cat: 8, sub: 9 }, { t0: 600, dur: 45, reps: null, kg: null, cat: 19, sub: 0 }, { t0: 800, dur: 30, reps: 12, kg: null, cat: 17, sub: 20 }] }))));
    }
    if (i % 7 === 0 && i > 0){ // Fußball montags mit GPS
      const f = new Date(d); f.setHours(19, 0, 0, 0);
      acts.push(core.buildActivity(core.parseFit(makeActivity({ start: f.getTime(), step: 1, seconds: 4800, sport: 7, hr: t => 140 + (t % 300 < 20 ? 25 : 0),
        speed: t => (t % 150 >= 40 && t % 150 < 44) ? 7 : 1.8, gps: (t, dist) => [48.39 + Math.sin(t / 60) * 0.0004, 9.97 + Math.cos(t / 47) * 0.0006] }))));
    }
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
  const annot = acts ? Object.fromEntries(acts.filter(a => a.kind === 'strength').slice(0, 3).map(a => [a.id, { rpe: 7 }])) : null;
  await page.evaluate(async ({ acts, W, S, annot }) => {
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
      if (annot) t.objectStore('meta').put(annot, 'annot');
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    db.close();
  }, { acts, W, S, annot });
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
    ['synthetische Daten', syntheticActs(), wellness(), { goal:'hm', runsPerWeek:5, raceDate: core.dayKey(Date.now() + 8 * 7 * DAY), targetTime:'1:45:00', sleepTarget:'7.5', strengthPerWeek:2, teamDays:[0], teamSport:'Fußball' }],
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
      if (!(await page.evaluate(() => !!window.JSZip))) problems.push(`${name}/${theme}: JSZip nicht geladen`);
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
  // Einstellungen: Feldgrößen, Überlappungen und Zeiteingabe auf schmalem (iPhone SE) und normalem Bildschirm
  for (const width of [320, 390]){
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    await page.route(u => !u.href.startsWith(url), r => r.abort());
    page.on('pageerror', e => problems.push(`Einstellungen/${width}: Skriptfehler: ${e.message}`));
    await page.goto(url); await page.waitForTimeout(200);
    await page.click('#settingsBtn'); await page.waitForTimeout(200);
    const lay = await page.evaluate(() => {
      const out = [], sheet = document.querySelector('#sheet');
      if (sheet.scrollWidth > sheet.clientWidth + 1) out.push('Menü scrollt seitlich');
      const ctrls = [...document.querySelectorAll('.form input:not([type=hidden]), .form select, .form .seg')];
      const hs = new Set(ctrls.map(c => Math.round(c.getBoundingClientRect().height)));
      if (hs.size > 1) out.push('unterschiedliche Feldhöhen: ' + [...hs].join(', '));
      for (const c of ctrls){
        const r = c.getBoundingClientRect(), f = c.closest('.field') || c.parentElement, pr = f.getBoundingClientRect();
        if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push((c.id || c.className) + ' ragt aus seiner Spalte');
      }
      for (const row of document.querySelectorAll('.form .two')){
        const [a, b] = [...row.children].map(x => x.getBoundingClientRect());
        if (a && b && a.right > b.left) out.push('Spalten überlappen');
      }
      const tf = document.querySelectorAll('#targetTime-h, #targetTime-m, #targetTime-s');
      if ([...tf].some(i => i.inputMode !== 'numeric')) out.push('Zeitfelder ohne Zifferntastatur');
      return out;
    });
    lay.forEach(x => problems.push(`Einstellungen/${width}: ${x}`));
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `einstellungen-${width}.png`), fullPage: false });
    await page.fill('#targetTime-h', '3'); await page.fill('#targetTime-m', '15');
    await page.fill('#raceTime-m', '19'); await page.fill('#raceTime-s', '30');
    await page.click('.savebar [data-action="save"]'); await page.waitForTimeout(300);
    const saved = await page.evaluate(() => new Promise(res => {
      const r = indexedDB.open('laufbuch'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('settings'); g.onsuccess = () => res(g.result); };
    }));
    if (!saved || saved.targetTime !== '3:15:00' || saved.raceTime !== '0:19:30') problems.push(`Einstellungen/${width}: Zeiten falsch gespeichert: ${JSON.stringify(saved && [saved.targetTime, saved.raceTime])}`);
    await page.click('#settingsBtn'); await page.waitForTimeout(200);
    await page.fill('#targetTime-m', '75'); await page.click('.savebar [data-action="save"]'); await page.waitForTimeout(200);
    if (!(await page.evaluate(() => document.querySelector('#sheet').classList.contains('open') && document.querySelector('#targetTime-m').getAttribute('aria-invalid') === 'true')))
      problems.push(`Einstellungen/${width}: ungültige Minuten (75) werden nicht abgefangen`);
    await ctx.close();
  }

  // Interaktion: Diagramme (Wischen, Zoom, Doppeltipp, Vollbild), Karte, Kraft-Eingabe, Anstrengung
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false });
    const page = await ctx.newPage();
    await page.route(u => !u.href.startsWith(url), r => r.abort());
    page.on('pageerror', e => problems.push('Interaktion: Skriptfehler: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) problems.push('Interaktion: Konsole: ' + m.text()); });
    await page.goto(url);
    const acts = syntheticActs();
    await seed(page, acts, wellness(), { goal:'hm', runsPerWeek:4, strengthPerWeek:2, teamDays:[0], teamSport:'Fußball', mapTiles:false });
    await page.reload(); await page.waitForTimeout(300);
    const P = async (cond, msg) => { if (!(await page.evaluate(cond))) problems.push('Interaktion: ' + msg); };
    await P(() => /Trainingszustand/i.test(document.body.innerText), 'Trainingszustand fehlt auf „Heute“');
    await page.click('#tabs button[data-tab="trends"]'); await page.waitForTimeout(200);
    await P(() => /VO2max/i.test(document.body.innerText), 'VO2max fehlt in Trends');
    const SEL = '.chart-box[aria-label="Belastungsverlauf 90 Tage"]';
    await page.$eval(SEL, el => el.scrollIntoView({block: 'center'})); await page.waitForTimeout(100);
    const box = await page.$(SEL); const bb = await box.boundingBox();
    await page.mouse.move(bb.x + bb.width * 0.5, bb.y + 30); await page.waitForTimeout(120);
    await P(() => { const t = document.querySelector('.chart-box[aria-label="Belastungsverlauf 90 Tage"] .chart-tip'); return t && !t.hidden && /Fitness/.test(t.textContent); }, 'Tooltip beim Darüberfahren fehlt');
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -400); await page.keyboard.up('Control'); await page.waitForTimeout(150);
    const zoomed = await page.$eval(SEL, el => el.classList.contains('zoomed'));
    if (!zoomed) problems.push('Interaktion: Strg + Mausrad zoomt nicht');
    else { await page.click(SEL + ' .chart-reset'); await page.waitForTimeout(100);
      await P(() => !document.querySelector('.chart-box[aria-label="Belastungsverlauf 90 Tage"]').classList.contains('zoomed'), 'Zoom zurücksetzen geht nicht'); }
    await page.click(SEL + ' .chart-full'); await page.waitForTimeout(200);
    await P(() => document.querySelector('#zoom').classList.contains('open') && !!document.querySelector('#zoom [data-chart] svg path, #zoom [data-chart] svg rect'), 'Vollbild-Diagramm öffnet nicht');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    await P(() => !document.querySelector('#zoom').classList.contains('open'), 'Vollbild schließt nicht');
    // Detail mit Karte
    const withGps = acts.find(a => a.stream.la && a.isRun && a.laps);
    const anyGps = withGps || acts.find(a => a.stream.la);
    await page.click('#tabs button[data-tab="laeufe"]'); await page.waitForTimeout(100);
    await page.evaluate(id => document.querySelector(`[data-act="${id}"]`) ? document.querySelector(`[data-act="${id}"]`).click() : null, anyGps.id);
    await page.evaluate(id => { if (!document.querySelector('#sheet.open')) { const b = document.createElement('button'); b.dataset.act = id; document.body.appendChild(b); b.click(); b.remove(); } }, anyGps.id);
    await page.waitForTimeout(800);
    await P(() => !!document.querySelector('#sheet [data-map] .leaflet-overlay-pane path'), 'Karte zeigt keine Strecke');
    const hb = await (await page.$('#sheet .chart-box')).boundingBox();
    await page.mouse.move(hb.x + hb.width * 0.6, hb.y + 40); await page.waitForTimeout(150);
    await P(() => [...document.querySelectorAll('#sheet .leaflet-overlay-pane path')].some(p => p.getAttribute('stroke-opacity') === '1' && p.getAttribute('fill-opacity') === '1' && p.getAttribute('stroke') === '#fff'), 'Kartenmarkierung folgt dem Diagramm nicht');
    if (process.env.SHOTS){ await page.$eval('#sheet', el => el.scrollTop = 0); await page.waitForTimeout(100); await page.screenshot({ path: path.join(process.env.SHOTS, 'detail-oben.png'), fullPage: false }); }
    if (withGps) await P(() => /Runden/i.test(document.querySelector('#sheet').innerText), 'Runden fehlen');
    await page.click('#sheet [data-rpe] button[data-val="6"]'); await page.waitForTimeout(200);
    await P(() => document.querySelector('#sheet [data-rpe] button[data-val="6"]').getAttribute('aria-pressed') === 'true', 'Anstrengung lässt sich nicht setzen');
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'detail-karte.png'), fullPage: false });
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    // Kraft-Ansicht und manuelle Eingabe
    await page.click('[data-filter] button[data-val="strength"]'); await page.waitForTimeout(150);
    await P(() => /Sätze pro Muskelgruppe/i.test(document.body.innerText) && /Kniebeuge/i.test(document.body.innerText), 'Kraft-Auswertung fehlt');
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'kraft.png'), fullPage: true });
    await page.click('[data-action="addstrength"]'); await page.waitForTimeout(150);
    await page.fill('#exlist .s-reps', '10'); await page.fill('#exlist .s-kg', '50');
    await page.click('#exlist .ex-add'); await page.click('[data-action="addex"]');
    await page.fill('#exlist .exblock:nth-child(2) .s-reps', '15');
    await page.click('[data-action="savestrength"]'); await page.waitForTimeout(300);
    await P(() => /manuell/.test(document.body.innerText), 'Manuell eingetragenes Krafttraining fehlt in der Liste');
    const saved = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('laufbuch'); r.onsuccess = () => { const g = r.result.transaction('acts').objectStore('acts').getAll(); g.onsuccess = () => res(g.result.filter(a => a.src === 'manual')); }; }));
    if (saved.length !== 1 || saved[0].sets.length !== 3 || saved[0].sets[0].kg !== 50) problems.push('Interaktion: manuelles Krafttraining falsch gespeichert: ' + JSON.stringify(saved.map(a => a.sets)));
    // Plan mit Kraft und Fußball
    await page.click('#tabs button[data-tab="plan"]'); await page.waitForTimeout(150);
    await P(() => /Fußball/i.test(document.body.innerText) && /(Krafttraining|Rumpf)/i.test(document.body.innerText), 'Plan zeigt Fußball oder Kraft nicht');
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'plan.png'), fullPage: true });
    await P(() => getComputedStyle(document.documentElement).touchAction === 'manipulation', 'Doppeltipp-Zoom nicht abgeschaltet');
    await ctx.close();
  }

  // Offline-Start: erster Besuch mit Netz, dann Flugmodus und neu laden
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.route(u => !u.href.startsWith(url), r => r.abort());
    page.on('pageerror', e => problems.push('offline: Skriptfehler: ' + e.message));
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await page.waitForTimeout(300);
    await ctx.setOffline(true);
    await page.reload(); await page.waitForTimeout(500);
    const ok = await page.evaluate(() => !!document.querySelector('#tabs button') && !!window.JSZip && /laufbuch/i.test(document.body.innerText));
    if (!ok) problems.push('offline: App startet ohne Netz nicht');
    await ctx.close();
  }
  await browser.close(); srv.close();
  if (problems.length){ console.error('Probleme gefunden:\n- ' + [...new Set(problems)].join('\n- ')); process.exit(1); }
  console.log('Alle Ansichten ohne „undefined“/„NaN“ und ohne Skriptfehler (' + scenarios.length * 2 + ' Durchläufe) – Offline-Start funktioniert.');
})().catch(e => { console.error(e); process.exit(1); });
