(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (x,d=0) => (x == null || !isFinite(x)) ? '–' : x.toFixed(d).replace('.',',');
const ZC = ['var(--z1)','var(--z2)','var(--z3)','var(--z4)','var(--z5)'];
const ZN = ['Regeneration','Grundlage','Tempo („Grauzone“)','Schwelle','VO₂max & darüber'];
const WDL = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];

/* ---------- Lokaler Speicher (IndexedDB, bleibt auf dem Gerät) ---------- */
const DB = {
  db:null, mem:{acts:new Map(), meta:new Map()}, ok:true,
  async open(){
    try {
      this.db = await new Promise((res,rej) => {
        const r = indexedDB.open('laufbuch', 1);
        r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('acts', {keyPath:'id'}); d.createObjectStore('meta'); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    } catch(e){ this.db = null; this.ok = false; }
  },
  req(store, mode, fn){
    return new Promise((res,rej) => {
      const t = this.db.transaction(store, mode), r = fn(t.objectStore(store));
      t.oncomplete = () => res(r ? r.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  async safe(fn, fb){ if (!this.db) return fb(); try { return await fn(); } catch(e){ this.ok = false; return fb(); } },
  all(){ return this.safe(() => this.req('acts','readonly', s => s.getAll()), () => [...this.mem.acts.values()]); },
  put(a){ return this.safe(() => this.req('acts','readwrite', s => s.put(a)), () => { this.mem.acts.set(a.id, a); }); },
  del(id){ return this.safe(() => this.req('acts','readwrite', s => s.delete(id)), () => { this.mem.acts.delete(id); }); },
  clear(){ return this.safe(() => this.req('acts','readwrite', s => s.clear()), () => { this.mem.acts.clear(); }); },
  getMeta(k){ return this.safe(() => this.req('meta','readonly', s => s.get(k)), () => this.mem.meta.get(k)); },
  setMeta(k,v){ return this.safe(() => this.req('meta','readwrite', s => s.put(v,k)), () => { this.mem.meta.set(k,v); }); }
};

/* ---------- Zustand ---------- */
const state = { acts:[], S:{goal:'m', runsPerWeek:4, sleepTarget:'7.5', strengthPerWeek:2, teamDays:[0], teamSport:'Fußball', mapTiles:false}, tab:'heute', filter:'all', P:null, der:{}, vd:null, paces:null, series:[], plan:null, W:newWellness(), rec:null, annot:{}, vo2:null, status:null, str:null, rk:null };

function recompute(){
  const {acts, S, annot} = state;
  for (const a of acts) normalizeAct(a);
  acts.sort((a,b) => b.start - a.start);
  state.P = estimateParams(acts, S);
  state.rk = rpeFactor(acts, state.P, annot);
  state.der = {}; for (const a of acts) state.der[a.id] = derive(a, state.P, {rpe: annot[a.id] && annot[a.id].rpe, k: state.rk.k});
  state.vd = estimateVdot(acts, S);
  state.paces = state.vd ? trainingPaces(state.vd.vdot) : null;
  state.series = loadSeries(acts, state.der);
  state.rec = recovery(state.W, state.series, S);
  state.vo2 = vo2Trend(acts, state.P);
  state.str = strengthSummary(acts);
  state.plan = buildPlan({S, acts, der:state.der, P:state.P, paces:state.paces, series:state.series, vd:state.vd, rec:state.rec, W:state.W});
  state.status = trainingStatus({acts, der:state.der, series:state.series, S, W:state.W, vo2:state.vo2, rec:state.rec});
}

/* ---------- Diagramme (SVG) ---------- */
function chart(series, o = {}){ return Charts.html({series, ...o}); }
const shortDate = ts => new Date(ts).toLocaleDateString('de-DE', {day:'numeric', month:'short'});
const weekOf = ts => 'Woche ab ' + new Date(ts).toLocaleDateString('de-DE', {day:'numeric', month:'short'});
const dayOf = ts => new Date(ts).toLocaleDateString('de-DE', {weekday:'short', day:'numeric', month:'short'});
const signed = (x, d=0) => (x > 0 ? '+' : '') + num(x, d);

function zbarHTML(zs){
  const t = zs.reduce((a,c) => a+c, 0); if (!t) return '';
  return `<div class="zbar">${zs.map((z,i) => z ? `<i style="width:${z/t*100}%;background:${ZC[i]}"></i>` : '').join('')}</div>`;
}

/* ---------- Ansichten ---------- */
function emptyView(){
  return `<div class="empty">
    <h2>Deine Läufe, lokal ausgewertet.</h2>
    <p>Importiere FIT-Dateien aus Garmin Connect. Die Auswertung läuft komplett auf diesem Gerät – nichts wird hochgeladen.</p>
    <h3>Einzelne Läufe exportieren (iPhone)</h3>
    <ol class="steps">
      <li>In Safari <b>connect.garmin.com</b> öffnen und anmelden.</li>
      <li>Aktivität öffnen, auf das Zahnrad tippen und <b>Original exportieren</b> wählen. Falls die Option fehlt: im Safari-Menü „Desktop-Website anfordern“.</li>
      <li>Die ZIP-Datei landet in der Dateien-App. Hier auf <b>Importieren</b> tippen und sie auswählen – auch mehrere auf einmal.</li>
    </ol>
    <h3>Alle bisherigen Läufe auf einmal</h3>
    <ol class="steps">
      <li>Garmin-Konto → Datenverwaltung → <b>Daten exportieren</b> anfordern. Garmin schickt dir per E-Mail einen Download-Link.</li>
      <li>Die große ZIP-Datei hier importieren. Die App sucht die FIT-Dateien darin selbst heraus. Bei sehr großen Exporten klappt das am PC-Browser zuverlässiger als am iPhone.</li>
    </ol>
    <button class="btn" data-action="import">FIT- oder ZIP-Dateien importieren</button>
    ${privacyNote()}
  </div>`;
}
function privacyNote(){
  return `<p class="privacy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span>Deine Trainingsdaten werden nur in diesem Browser auf deinem Gerät gespeichert und verarbeitet${DB.ok ? '' : '. <b>Achtung:</b> Der Gerätespeicher ist gerade nicht verfügbar, importierte Daten gehen beim Schließen verloren'}.</span></p>`;
}

function formState(){
  const c = state.series[state.series.length-1];
  if (!c || c.ctl < 5) return {label:'Zu wenig Daten', text:'Für eine Formkurve braucht es einige Wochen Training.'};
  const r = c.tsb / c.ctl;
  if (r < -0.3) return {label:'Hohe Ermüdung', text:'Mehr Belastung als dein Körper gerade verarbeitet. Erholung einplanen.'};
  if (r < -0.1) return {label:'Produktives Training', text:'Du setzt Reize, die Fitness wächst.'};
  if (r < 0.15) return {label:'Frisch', text:'Gute Voraussetzungen für eine harte Einheit oder einen Wettkampf.'};
  return {label:'Sehr frisch', text:'Viel Erholung. Dauert das länger an, sinkt die Fitness langsam.'};
}

function viewHeute(){
  const {plan, series, acts, vd} = state;
  const t = plan.today, now = new Date();
  const kmTxt = t.km ? `<div class="kmnum">${num(t.km, t.km % 1 ? 1 : 0)}<small>km</small></div>` : `<div class="kmnum">–</div>`;
  const extra = (t.extra || []).map(x => `<div class="bib-extra"><span class="tag" style="background:var(--accent)"></span><div><b>+ ${esc(x.title)}</b><div class="small">${esc(x.detail)}</div></div></div>`).join('');
  let h = `<div class="bib type-${esc(t.type)}"><span class="pin"></span><span class="pin"></span><span class="pin"></span><span class="pin"></span>
    <div class="date">Heute, ${now.toLocaleDateString('de-DE',{weekday:'long', day:'numeric', month:'long'})}${t.optional ? ' · optional' : ''}</div>
    <div class="row">${kmTxt}<div class="title">${esc(t.title)}</div></div>
    ${t.tempo ? `<div class="tempo">${esc(t.tempo)}</div>` : ''}
    <div class="detail">${esc(t.detail)}</div>${extra}</div>`;

  h += statusCard();
  h += recoveryPanel();
  const c = series[series.length-1] || {ctl:0, atl:0, tsb:0}, fs = formState();
  const last = series.slice(-42);
  h += `<h2>Form</h2><div class="stats">
    <div><div class="v">${num(c.ctl)}</div><div class="l">Fitness</div></div>
    <div><div class="v">${num(c.atl)}</div><div class="l">Ermüdung</div></div>
    <div><div class="v">${c.tsb > 0 ? '+' : ''}${num(c.tsb)}</div><div class="l">Form</div></div></div>
    <div class="panel" style="margin-top:10px"><span class="state">${fs.label}</span><p class="small muted" style="margin:8px 0 10px">${fs.text}</p>
    <div class="legend"><span><b style="background:var(--data)"></b>Fitness</span><span><b style="background:var(--hr)"></b>Ermüdung</span></div>
    ${chart([{v:last.map(x=>x.ctl), c:'var(--data)', w:2.4, name:'Fitness', fmt:x=>num(x), area:true}, {v:last.map(x=>x.atl), c:'var(--hr)', w:1.6, name:'Ermüdung', fmt:x=>num(x)}],
      {h:100, min:0, xs:last.map(x=>x.ts), fmtX:dayOf, label:'Fitness und Ermüdung der letzten 6 Wochen', title:'Fitness und Ermüdung'})}</div>`;

  if (vd){
    const hm = predictTime(21097.5, vd.vdot), m = predictTime(42195, vd.vdot);
    h += `<h2>Aktuelle Prognose</h2><div class="stats" style="grid-template-columns:repeat(3,1fr)">
      <div><div class="v">${num(vd.vdot,1)}</div><div class="l">VDOT</div></div>
      <div><div class="v">${fmtDur(hm)}</div><div class="l">Halbmarathon</div></div>
      <div><div class="v">${fmtDur(m)}</div><div class="l">Marathon</div></div></div>
      <p class="small muted" style="margin-top:6px">Grundlage: ${esc(vd.src)}.${vd.fromTraining ? ' Aus Trainingsdaten geschätzt – mit einem echten Wettkampfergebnis in den Einstellungen wird es genauer.' : ''}${state.S.goal === 'm' ? ' Die Marathonprognose setzt ausreichend lange Läufe voraus.' : ''}</p>`;
    if (plan.goalCheck) h += `<div class="panel"><b>Dein Ziel ${fmtDur(parseGoalTime(state.S.targetTime))}</b> (${fmtPace(plan.goalCheck.pace)}/km)<p class="small" style="margin:4px 0 0">${esc(plan.goalCheck.verdict)}</p></div>`;
  }

  if (acts.length){ h += `<h2>Letzte Aktivität</h2><div class="list">${actItem(acts[0])}</div>`; }
  if (plan.notes.length) h += `<h2>Hinweise</h2><ul class="notes">${plan.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
  h += privacyNote();
  return h;
}

const TONE = {good:'var(--z3)', warn:'var(--z4)', bad:'var(--hr)', neutral:'var(--muted)'};
function vo2Badge(){
  const v = state.vo2; if (!v || v.cur == null) return '';
  const arrow = v.delta == null ? '' : v.delta > 0.2 ? '▲' : v.delta < -0.2 ? '▼' : '■';
  return `<div class="vo2"><span class="num">${num(v.cur,1)}</span><span class="lbl">VO2max${v.delta != null ? ` <b class="${v.delta > 0.2 ? 'up' : v.delta < -0.2 ? 'down' : ''}">${arrow} ${Math.abs(v.delta) <= 0.2 ? 'stabil' : num(Math.abs(v.delta),1)}</b>` : ''}</span></div>`;
}
function signalList(arr, cls){ return arr.map(x => `<li class="${cls}"><b>${esc(x.t)}</b><span>${esc(x.d)}</span></li>`).join(''); }
function statusCard(){
  const s = state.status; if (!s) return '';
  return `<h2>Trainingszustand</h2><div class="panel status-card" style="--tone:${TONE[s.tone]}">
    <div class="status-head"><div><span class="status-pill">${esc(s.label)}</span><p class="small" style="margin:8px 0 0">${esc(s.text)}</p></div>${vo2Badge()}</div>
    ${s.better.length || s.watch.length ? `<ul class="signals">${signalList(s.better.slice(0,2), 'up')}${signalList(s.watch.slice(0,2), 'warn')}</ul>` : ''}
    <button class="btn ghost" data-action="tab" data-tab="trends">Alle Signale und VO2max-Verlauf</button></div>`;
}
function statusPanel(){
  const s = state.status; if (!s) return '';
  return `<h2 style="margin-top:8px">Trainingszustand</h2><div class="panel status-card" style="--tone:${TONE[s.tone]}">
    <div class="status-head"><div><span class="status-pill">${esc(s.label)}</span><p class="small" style="margin:8px 0 0">${esc(s.text)}</p></div>${vo2Badge()}</div>
    <h3>Das verbessert sich</h3>${s.better.length ? `<ul class="signals">${signalList(s.better, 'up')}</ul>` : '<p class="small muted">Noch keine klaren Verbesserungen erkennbar – dafür braucht es ein paar Wochen Daten.</p>'}
    <h3>Darauf achten</h3>${s.watch.length ? `<ul class="signals">${signalList(s.watch, 'warn')}</ul>` : '<p class="small muted">Aktuell nichts Auffälliges.</p>'}
    <p class="small muted" style="margin:10px 0 0">Die Einschätzung kombiniert Belastungsverlauf, VO2max-Trend, Effizienz, Erholungswerte und Krafttraining. Bei Schmerzen, Krankheit oder auffälligen Werten bitte ärztlich oder trainerisch abklären.</p></div>`;
}
function vo2Panel(){
  const v = state.vo2;
  let h = `<h2>VO2max-Schätzung</h2><div class="panel">`;
  if (!v || v.list.length < 2) return h + `<p class="small muted" style="margin:0">Braucht mindestens zwei gleichmäßige Läufe ab 25 Minuten mit Herzfrequenz (möglichst flach, ohne viele Stopps).</p></div>`;
  const L = v.list, vals = L.map(x => x.vo2), roll = vals.map((_, i) => median(vals.slice(Math.max(0, i-4), i+1)));
  h += `<div class="status-head" style="margin-bottom:8px"><p class="small" style="margin:0">Aktuell <b>${num(v.cur,1)} ml/kg/min</b>${v.delta != null ? `, vor einem Monat ${num(v.prev,1)} (${signed(v.delta,1)})` : ''}.${state.vd ? ` Aus deiner Wettkampfleistung (VDOT): ${num(state.vd.vdot,1)}.` : ''}</p></div>
    <div class="legend"><span><b style="background:var(--data)"></b>einzelner Lauf</span><span><b style="background:var(--ink)"></b>Verlauf</span></div>
    ${chart([{v:vals, c:'var(--data)', dots:true, name:'Lauf', fmt:x=>num(x,1)}, {v:roll, c:'var(--ink)', w:1.8, name:'Verlauf', fmt:x=>num(x,1)}], {h:130, xs:L.map(x=>x.start), fmtX:dayOf, label:'VO2max-Schätzung', title:'VO2max-Schätzung'})}
    <p class="small muted" style="margin:8px 0 0">Geschätzt aus Tempo und Puls bei gleichmäßigen, flachen Abschnitten (Sauerstoffbedarf nach Daniels, Herzfrequenzreserve nach Swain). Wie genau das ist, hängt an deiner HFmax und deinem Ruhepuls in den Einstellungen. Garmin rechnet mit einem eigenen Verfahren, die Werte können ein paar Punkte abweichen. Wichtiger als der absolute Wert ist der Trend.</p></div>`;
  return h;
}

function recoveryPanel(){
  const r = state.rec;
  if (!r || r.empty) return `<h2>Erholung</h2><div class="panel"><p style="margin:0 0 10px">Bezieh Ruhepuls und Schlaf aus Apple Health ein – dann passt sich die Empfehlung jeden Morgen an deinen Zustand an.</p><button class="btn" data-action="wellness">Tageswerte einrichten</button></div>`;
  const col = p => p > 0 ? 'var(--z3)' : p < 0 ? (p <= -15 ? 'var(--z5)' : 'var(--z4)') : 'var(--z1)';
  const last = lastWellnessDay(state.W);
  const stale = last && last < dayKey(Date.now() - 864e5);
  let h = `<h2>Erholung</h2><div class="panel">`;
  if (r.hasData) h += `<div class="rec"><div class="score">${r.score}<small>von 100</small></div><div><span class="state">${esc(r.label)}</span><p class="small" style="margin:6px 0 0">${esc(r.text)}${r.partial ? ' Nur teilweise Daten vorhanden.' : ''}</p></div></div>`;
  else h += `<p class="small" style="margin:0">Für heute fehlen noch Werte.</p>`;
  h += r.factors.map(f => `<div class="factor"><span class="dot" style="background:${col(f.p)}"></span><div><b>${esc(f.name)}</b><div class="small muted">${esc(f.text)}</div></div><span class="fv">${esc(f.val)}</span></div>`).join('');
  h += `<p style="margin:12px 0 0"><button class="btn ghost" data-action="wellness">Tageswerte aktualisieren</button>${stale ? ` <span class="small muted">Letzte Werte vom ${fmtDate(new Date(last+'T12:00').getTime())}</span>` : ''}</p></div>`;
  return h;
}

function openWellness(){
  const h = `<div class="bar"><h2>Tageswerte</h2><button class="icon-btn" data-action="close" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <div class="wrap form">
    <p style="margin-top:0">Ruhepuls und Schlaf kommen von deiner Garmin über Apple Health hierher. Alles bleibt auf deinem iPhone.</p>
    <label for="wtext">Kurzbefehl-Ergebnis einfügen</label>
    <textarea id="wtext" placeholder="Nach dem Kurzbefehl: lange hier hineintippen und „Einfügen“ wählen"></textarea>
    <p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" data-action="wapply">Übernehmen</button><button class="btn ghost" data-action="wclip">Aus Zwischenablage holen</button></p>

    <h2>Einrichtung</h2>
    <h3>1. Garmin mit Apple Health verbinden</h3>
    <div class="guide"><ol>
      <li>Garmin Connect öffnen → <b>Mehr</b> → <b>Einstellungen</b> → <b>Verbundene Apps</b> → <b>Apple Health</b>.</li>
      <li>Das Schreiben von <b>Herzfrequenz</b> und <b>Schlaf</b> erlauben. Ab jetzt landen die Werte nach jeder Synchronisierung in Apple Health.</li>
    </ol></div>

    <h3>2. Einmalig: bisherigen Verlauf importieren</h3>
    <div class="guide"><ol>
      <li>Health-App öffnen → oben rechts auf dein Profilbild → ganz unten <b>Alle Gesundheitsdaten exportieren</b>. Das dauert je nach Datenmenge ein paar Minuten.</li>
      <li>Die Datei <span class="code">Export.zip</span> in der Dateien-App sichern.</li>
      <li>Hier oben auf <b>Importieren</b> tippen und die ZIP-Datei wählen. Das Laufbuch liest daraus nur Ruhepuls und Schlaf.</li>
    </ol>
    <p class="small muted">Der Export kann mehrere hundert MB groß sein. Wenn der Import abbricht, hilft ein Neustart des iPhones vor dem Import.</p></div>

    <h3>3. Für jeden Tag: Kurzbefehl anlegen</h3>
    <div class="guide"><ol>
      <li>Kurzbefehle-App öffnen → <b>+</b> → Name: <b>Laufbuch Tageswerte</b>.</li>
      <li>Aktion <b>Health-Samples suchen</b> hinzufügen. Typ: <b>Ruhepuls</b>. Filter: <b>Startdatum</b> ist in den letzten <b>14 Tagen</b>.</li>
      <li>Aktion <b>Wiederholen mit jedem Objekt</b> hinzufügen. Darin eine Aktion <b>Text</b> mit diesem Inhalt:<br><span class="code">R;Startdatum;Wert;Quelle</span><br>Dabei „Startdatum“, „Wert“ und „Quelle“ jeweils als Variable einfügen: auf <b>Wiederholungsobjekt</b> tippen und die Eigenschaft auswählen. Die Semikolons tippst du normal.</li>
      <li>Nochmal <b>Health-Samples suchen</b>, diesmal Typ <b>Schlafanalyse</b>, ebenfalls letzte <b>14 Tage</b>.</li>
      <li>Wieder <b>Wiederholen mit jedem Objekt</b>, darin <b>Text</b>:<br><span class="code">S;Startdatum;Enddatum;Wert;Quelle</span></li>
      <li>Aktion <b>Text</b> ans Ende: erste Zeile <span class="code">LB1</span>, darunter die Variable <b>Wiederholungsergebnisse</b> der ersten Schleife, in der nächsten Zeile die der zweiten Schleife.</li>
      <li>Zum Schluss <b>In Zwischenablage kopieren</b>.</li>
    </ol>
    <p class="small muted">Tipp: Bei den Datumsvariablen als Format „ISO 8601“ mit Uhrzeit wählen. Das deutsche Standardformat wird aber auch erkannt. Beim ersten Start fragt iOS, ob der Kurzbefehl Health-Daten lesen darf – erlauben.</p></div>

    <h3>Morgens dann</h3>
    <div class="guide"><ol>
      <li>Garmin Connect kurz öffnen, damit die Uhr synchronisiert.</li>
      <li>Kurzbefehl starten, am schnellsten über ein Widget auf dem Home-Bildschirm.</li>
      <li>Laufbuch öffnen → <b>Tageswerte aktualisieren</b> → einfügen → <b>Übernehmen</b>.</li>
    </ol>
    <p class="small muted">Öffne das Laufbuch immer auf dieselbe Weise, am besten über das Symbol auf dem Home-Bildschirm. Safari und Home-Bildschirm-Apps haben auf dem iPhone getrennte Speicher.</p></div>
    <p class="privacy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span>Die Kurzbefehle-App und das Laufbuch laufen beide lokal auf deinem iPhone. Es wird nichts an einen Server geschickt.</span></p>
  </div>`;
  openSheet(h);
}
async function applyWellness(recs, silentIfEmpty){
  const r = ingestWellness(state.W, recs);
  if (!r.rhr && !r.nights){ if (!silentIfEmpty) toast('Keine Ruhepuls- oder Schlafdaten erkannt. Prüfe den Kurzbefehl (erste Zeile LB1, Zeilen mit R; und S;).'); return r; }
  await DB.setMeta('wellness', state.W);
  recompute(); render();
  return r;
}

function actItem(a){
  const d = state.der[a.id] || {zs:[0,0,0,0,0], trimp:0};
  const pace = a.isRun && a.avgSpd > 0 ? fmtPace(1000/a.avgSpd)+'/km' : '';
  const bits = [fmtDate(a.start,true), fmtDur(a.timer)];
  if (pace) bits.push(pace);
  if (a.avgHR) bits.push('Ø '+a.avgHR+' bpm');
  if (a.sets && a.sets.length) bits.push(a.sets.length+' Sätze');
  if (a.sprints != null) bits.push(a.sprints+' Sprints');
  const rpe = state.annot[a.id] && state.annot[a.id].rpe;
  if (rpe) bits.push('RPE '+rpe);
  const big = a.dist > 50 ? fmtKm(a.dist)+'<span class="small muted"> km</span>' : num(d.trimp)+'<span class="small muted"> Bel.</span>';
  return `<button class="item act" data-act="${esc(a.id)}"><span class="kind" style="background:${KIND_COLORS[a.kind] || 'var(--muted)'}"></span><div class="main">
    <div class="t1">${esc(a.name)}${a.src === 'manual' ? ' <span class="small muted">· manuell</span>' : ''}</div>
    <div class="t2">${bits.join(' · ')}</div>
    ${zbarHTML(d.zs)}</div>
    <div class="big">${big}</div></button>`;
}

function viewLaeufe(){
  const f = state.filter || 'all';
  const segs = [['all','Alle'],['run','Laufen'],['strength','Kraft'],['other','Andere']];
  let h = `<div class="seg filter" data-filter role="group" aria-label="Filter">${segs.map(([k,l]) => `<button type="button" data-val="${k}" aria-pressed="${f===k}">${l}</button>`).join('')}</div>`;
  if (f === 'strength') h += strengthView();
  else if (!state.acts.length) return h + emptyView();
  const list = state.acts.filter(a => f === 'all' || (f === 'other' ? a.kind !== 'run' && a.kind !== 'strength' : a.kind === f));
  if (f === 'strength' && list.length) h += `<h3>Alle Einheiten</h3>`;
  let cur = '';
  const show = list.slice(0, state.showAll ? undefined : 150);
  for (const a of show){
    const m = new Date(a.start).toLocaleDateString('de-DE', {month:'long', year:'numeric'});
    if (m !== cur){ if (cur) h += '</div>'; cur = m; h += `<div class="month">${m}</div><div class="list">`; }
    h += actItem(a);
  }
  if (cur) h += '</div>';
  else if (f !== 'strength') h += `<p class="muted small" style="margin-top:16px">Keine Einträge in dieser Auswahl.</p>`;
  if (!state.showAll && list.length > 150) h += `<p style="margin-top:14px"><button class="btn ghost" data-action="showall">Alle ${list.length} anzeigen</button></p>`;
  return h;
}

function strengthView(){
  const s = state.str, wk = s.weeks;
  let h = `<div class="str-head"><h2>Krafttraining</h2><button class="btn" data-action="addstrength">+ Eintragen</button></div>`;
  if (!s.total) return h + `<div class="panel"><p style="margin:0 0 8px">Noch kein Krafttraining erfasst.</p><p class="small muted" style="margin:0">Zeichne es auf der Uhr mit dem Profil „Krafttraining“ auf – dann kommen Übungen, Sätze, Wiederholungen und Gewichte beim Import automatisch mit. Oder trag eine Einheit hier von Hand ein.</p></div>`;
  const cur = wk[wk.length-1];
  h += `<div class="stats">
    <div><div class="v">${num(s.sessions4,1)}</div><div class="l">Einheiten pro Woche</div></div>
    <div><div class="v">${cur.sets}</div><div class="l">Sätze diese Woche</div></div>
    <div><div class="v">${cur.tonnage ? num(cur.tonnage/1000, 1) : '–'}</div><div class="l">Tonnen bewegt</div></div></div>`;
  const mg = MUSCLES.map(m => [m, s.setsWeek[m] || 0]), mx = Math.max(6, ...mg.map(x => x[1]));
  h += `<h3>Sätze pro Muskelgruppe · 7 Tage</h3><div class="panel">${mg.map(([m,v]) => `<div class="hbar${['Beine','Gesäß & Hüfte','Rumpf','Waden'].includes(m) ? ' key' : ''}"><span>${m}</span><i><b style="width:${v/mx*100}%"></b><u style="left:${6/mx*100}%"></u></i><em>${num(v, v % 1 ? 1 : 0)}</em></div>`).join('')}
    <p class="small muted" style="margin:10px 0 0">Für Läufer am wichtigsten (fett): Beine, Gesäß & Hüfte, Rumpf und Waden. Die Linie markiert etwa 6 Sätze pro Woche als sinnvolle Untergrenze.</p></div>`;
  h += `<h3>Verlauf · 8 Wochen</h3><div class="panel">${chart([{v:wk.map(w=>w.sets), c:'var(--accent)', bars:true, op:.85, name:'Sätze', fmt:x=>num(x)}, {v:wk.map(w=>w.sessions), c:'var(--ink)', hidden:true, name:'Einheiten', fmt:x=>num(x)}, {v:wk.map(w=>w.minutes), c:'var(--muted)', hidden:true, name:'Minuten', fmt:x=>num(x)}],
    {h:110, min:0, xs:wk.map(w=>w.start), fmtX:weekOf, label:'Sätze pro Woche', title:'Krafttraining: Sätze pro Woche'})}</div>`;
  if (s.exercises.length){
    h += `<h3>Übungen</h3><div class="list">${s.exercises.slice(0, 40).map(e => { const last = e.hist[e.hist.length-1];
      return `<button class="item" data-ex="${esc(e.key)}"><div class="main"><div class="t1">${esc(e.label)}</div><div class="t2">${e.name ? esc(e.name)+' · ' : ''}${e.count}× · zuletzt ${fmtDate(e.last)}</div></div>
        <div class="big" style="font-size:21px;text-align:right">${last.topKg ? num(last.topKg, last.topKg % 1 ? 1 : 0)+'<span class="small muted"> kg</span>' : last.reps ? last.reps+'<span class="small muted"> Wdh.</span>' : last.dur ? fmtDur(last.dur)+'<span class="small muted"> min</span>' : '–'}${e.trend != null ? `<div class="small ${e.trend >= 0 ? 'up' : 'down'}">${signed(e.trend,1)} %</div>` : ''}</div></button>`; }).join('')}</div>`;
  } else h += `<p class="small muted">Deine Krafteinheiten enthalten noch keine Sätze. Auf der Uhr das Profil „Krafttraining“ nutzen und die Sätze mit der Rundentaste abschließen.</p>`;
  return h;
}

function openExercise(key){
  const e = state.str.exercises.find(x => x.key === key); if (!e) return;
  const H = e.hist, hasKg = H.some(h => h.best > 0);
  let h = `<div class="bar"><h2>${esc(e.label)}</h2><button class="icon-btn" data-action="close" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="wrap">
    ${e.name ? `<p class="muted" style="margin-top:0">${esc(e.name)}</p>` : ''}`;
  if (hasKg){
    h += `<div class="legend"><span><b style="background:var(--accent)"></b>geschätztes Maximum (1 Wdh.)</span><span><b style="background:var(--ink)"></b>schwerster Satz</span></div><div class="panel">
      ${chart([{v:H.map(x=>x.best || null), c:'var(--accent)', w:2.2, name:'Maximum (geschätzt)', fmt:x=>num(x,1)+' kg', area:true}, {v:H.map(x=>x.topKg || null), c:'var(--ink)', dots:true, name:'Schwerster Satz', fmt:x=>num(x,1)+' kg'}],
        {h:140, xs:H.map(x=>x.start), fmtX:dayOf, label:'Gewichtsentwicklung', title:e.label+': Gewichtsentwicklung'})}
      <p class="small muted" style="margin:8px 0 0">Das Maximum ist mit der Epley-Formel aus Gewicht und Wiederholungen geschätzt (nur Sätze bis 12 Wiederholungen).${e.trend != null ? ` Veränderung seit der ersten Einheit: <b>${signed(e.trend,1)} %</b>.` : ''}</p></div>`;
  } else {
    const byDur = H.every(x => !x.reps && x.dur);
    h += `<div class="panel">${byDur ? chart([{v:H.map(x=>x.dur), c:'var(--accent)', bars:true, op:.8, name:'Haltezeit', fmt:x=>fmtDur(x)+' min'}], {h:120, min:0, xs:H.map(x=>x.start), fmtX:dayOf, label:'Haltezeit pro Einheit', title:e.label+': Haltezeit'})
      : chart([{v:H.map(x=>x.reps), c:'var(--accent)', bars:true, op:.8, name:'Wiederholungen', fmt:x=>num(x)}], {h:120, min:0, xs:H.map(x=>x.start), fmtX:dayOf, label:'Wiederholungen pro Einheit', title:e.label+': Wiederholungen'})}</div>`;
  }
  h += `<h3>Einheiten</h3><div class="list">${[...H].reverse().map(x => `<div class="item"><div class="main"><div class="t1">${fmtDate(x.start,true)}</div><div class="t2">${x.sets} Sätze${x.reps ? ' · ' + x.reps + ' Wdh.' : ''}${x.dur ? ' · ' + fmtDur(x.dur) + ' min gehalten' : ''}${x.volume ? ' · '+num(x.volume)+' kg bewegt' : ''}</div></div><div class="big" style="font-size:20px">${x.topKg ? num(x.topKg, x.topKg % 1 ? 1 : 0)+'<span class="small muted"> kg</span>' : '–'}</div></div>`).join('')}</div></div>`;
  openSheet(h);
}

// Krafttraining von Hand eintragen
function exBlock(cat){
  return `<div class="exblock"><div class="exhead"><div class="select"><select class="ex-cat" aria-label="Übung">${EX_PICK.map(c => `<option value="${c}" ${c === cat ? 'selected' : ''}>${esc(catName(c))}</option>`).join('')}</select></div>
    <button type="button" class="icon-btn ex-del" aria-label="Übung entfernen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <input class="ex-name" type="text" placeholder="Variante, z. B. Langhantel (optional)" autocomplete="off">
    <div class="ex-sets">${setRow()}</div>
    <button type="button" class="btn ghost ex-add">+ Satz</button></div>`;
}
function setRow(reps = '', kg = ''){
  return `<div class="setrow"><div class="unit"><input class="s-reps" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="10" value="${esc(reps)}" aria-label="Wiederholungen"><span>Wdh.</span></div>
    <div class="unit"><input class="s-kg" type="text" inputmode="decimal" placeholder="0" value="${esc(kg)}" aria-label="Gewicht"><span>kg</span></div>
    <button type="button" class="icon-btn s-del" aria-label="Satz entfernen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg></button></div>`;
}
function openStrengthForm(){
  const now = new Date(), d = dayKey(now.getTime()), t = String(now.getHours()).padStart(2,'0') + ':' + String(Math.floor(now.getMinutes()/5)*5).padStart(2,'0');
  const h = `<div class="bar"><h2>Krafttraining</h2><button class="icon-btn" data-action="close" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <div class="wrap form" id="strform">
    <div class="two"><div class="field"><label for="k-date">Datum</label><input type="date" id="k-date" value="${d}"></div><div class="field"><label for="k-time">Uhrzeit</label><input type="time" id="k-time" value="${t}"></div></div>
    <div class="field"><label for="k-min">Dauer</label><div class="unit"><input id="k-min" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="45" value="45"><span>min</span></div></div>
    <div class="field"><label>Anstrengung (1 = sehr leicht, 10 = maximal)</label><div class="seg rpe" data-seg="k-rpe" data-local role="group" aria-label="Anstrengung">${[1,2,3,4,5,6,7,8,9,10].map(i => `<button type="button" data-val="${i}" aria-pressed="${i === 6}">${i}</button>`).join('')}</div>
      <div class="hint">Wird für die Belastung genutzt (Dauer × Anstrengung), weil der Puls Krafttraining unterschätzt.</div></div>
    <h2>Übungen</h2>
    <div id="exlist">${exBlock(28)}</div>
    <button type="button" class="btn ghost" data-action="addex" style="margin-top:12px">+ Übung</button>
    <div class="savebar"><button class="btn" data-action="savestrength">Speichern</button><span class="small muted">Wird lokal gespeichert und fließt in Belastung und Plan ein.</span></div>
  </div>`;
  openSheet(h);
}
async function saveStrength(){
  const g = id => ($('#'+id) || {}).value || '';
  const date = g('k-date'), time = g('k-time') || '18:00', mins = parseInt(g('k-min'), 10);
  const rpeBtn = document.querySelector('[data-seg="k-rpe"] [aria-pressed="true"]'), rpe = rpeBtn ? +rpeBtn.dataset.val : null;
  if (!date) return toast('Bitte ein Datum wählen.');
  if (!(mins >= 5 && mins <= 300)) return toast('Dauer bitte zwischen 5 und 300 Minuten eingeben.');
  const sets = [];
  for (const b of document.querySelectorAll('#exlist .exblock')){
    const cat = +b.querySelector('.ex-cat').value, name = b.querySelector('.ex-name').value.trim() || null;
    for (const r of b.querySelectorAll('.setrow')){
      const reps = parseInt(r.querySelector('.s-reps').value, 10), kg = parseNum(r.querySelector('.s-kg').value);
      if (!(reps >= 1 && reps <= 200)) continue;
      sets.push({t0:null, dur:null, reps, kg: kg > 0 && kg < 1000 ? Math.round(kg*10)/10 : null, cat, sub:null, name});
    }
  }
  const start = new Date(date + 'T' + time).getTime();
  if (!isFinite(start)) return toast('Datum oder Uhrzeit ungültig.');
  const a = normalizeAct({id:'m' + start, src:'manual', v:SCHEMA, start, sport:10, subSport:20, isRun:false, kind:'strength', name:'Krafttraining',
    dist:0, timer:mins*60, avgHR:null, maxHR:null, avgSpd:0, ascent:null, kcal:null, te:null, ane:null, cad:null, gct:null, vo:null, hr30:null,
    bestD:{}, bestT:{}, watch:{}, sets, stream:{t:[],hr:[],v:[],c:[],d:[],a:[]}});
  if (state.acts.some(x => x.id === a.id)) a.id += '-' + Math.floor(Math.random()*1000);
  try { await DB.put(a); } catch(e){}
  state.acts.push(a);
  if (rpe){ state.annot[a.id] = {...(state.annot[a.id] || {}), rpe}; try { await DB.setMeta('annot', state.annot); } catch(e){} }
  recompute(); closeSheet(); state.tab = 'laeufe'; state.filter = 'strength'; render();
  toast(`Krafttraining gespeichert: ${sets.length} Sätze`);
}

function viewPlan(){
  const p = state.plan;
  const TC = {Q:'var(--z4)', L:'var(--ink)', E:'var(--z2)', R:'var(--line)', W:'var(--z5)', T:'var(--z3)', K:'var(--accent)'};
  const total = p.sessions.reduce((s,x) => s + x.km, 0);
  let h = `<h2 style="margin-top:8px">Diese Woche: ${esc(p.phase)}${p.recovery ? ' (Entlastung)' : ''}</h2>
    <p class="muted small">${p.wtr !== null ? (p.wtr === 0 ? 'Wettkampfwoche. ' : `Noch ${p.wtr} Woche${p.wtr===1?'':'n'} bis zum ${p.goal==='m'?'Marathon':'Halbmarathon'}. `) : 'Kein Wettkampfdatum eingetragen – der Plan baut Grundlage auf. '}Rund ${num(total)} km geplant, Schnitt der letzten 4 Wochen ${num(p.vol4)} km.</p>
    <div class="list week">`;
  for (const s of p.sessions){
    const ex = (s.extra || []).map(x => `<div class="t2 extra"><span class="tag" style="background:${TC[x.type]}"></span><b>+ ${esc(x.title)}</b> – ${esc(x.detail)}</div>`).join('');
    h += `<div class="item${s.day === p.tIdx ? ' today' : ''}${s.optional ? ' optional' : ''}"><div class="wd">${WD[s.day]}</div><div class="main">
      <div class="t1"><span class="tag" style="background:${TC[s.type]||'var(--line)'}"></span>${esc(s.title)}${s.km ? ` · ${num(s.km, s.km % 1 ? 1 : 0)} km` : ''}${s.optional ? ' <span class="small muted">· optional</span>' : ''}</div>
      ${s.tempo ? `<div class="t2" style="color:var(--ink);font-weight:500">${esc(s.tempo)}</div>` : ''}
      <div class="t2">${esc(s.detail)}</div>${ex}</div></div>`;
  }
  h += `</div><div class="legend plan-legend"><span><b style="background:var(--z4)"></b>Qualität</span><span><b style="background:var(--ink)"></b>Langer Lauf</span><span><b style="background:var(--z2)"></b>Locker</span><span><b style="background:var(--accent)"></b>Kraft</span><span><b style="background:var(--z3)"></b>Fester Termin</span></div>`;
  if (p.notes.length) h += `<h2>Warum so?</h2><ul class="notes">${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
  h += `<p class="small muted">Der Plan wird bei jedem Import neu berechnet – aus deinem Umfang, deiner Form, deiner Zonenverteilung, deinem Wettkampfdatum, deinen festen Terminen und deinem Krafttraining. Das alles änderst du in den Einstellungen.</p>
    <button class="btn ghost" data-action="settings">Ziel, Trainingstage & Kraft ändern</button>`;
  return h;
}

function viewZonen(){
  const {P, paces, vd, S} = state, b = hrBounds(P.lthr);
  const ranges = [`unter ${b[0]}`, `${b[0]}–${b[1]-1}`, `${b[1]}–${b[2]-1}`, `${b[2]}–${b[3]-1}`, `ab ${b[3]}`];
  const use = ['Aktive Erholung, Einlaufen','Lockere und lange Läufe – das Fundament für HM und Marathon','Marathontempo liegt oft hier; im Alltagstraining eher meiden','Schwellentraining, Halbmarathontempo','Intervalle, kurze harte Belastungen'];
  let h = `<h2 style="margin-top:8px">Herzfrequenzzonen</h2>
    <p class="small muted">Berechnet aus deiner Laktatschwelle von <b style="color:var(--ink)">${P.lthr} bpm</b> (${esc(P.src.lthr)}). HFmax ${P.maxHR} bpm, Ruhepuls ${P.restHR} bpm.</p>
    <div class="list ztable">${ranges.map((r,i) => `<div class="item"><div class="zchip" style="background:${ZC[i]}">Z${i+1}</div><div class="main"><div class="t1">${r} bpm · ${ZN[i]}</div><div class="t2">${use[i]}</div></div></div>`).join('')}</div>`;
  if (P.src.lthr.indexOf('Schätzung') >= 0) h += `<p class="small" style="margin-top:8px">Tipp: Für genauere Zonen trage deine Laktatschwelle ein. Die Forerunner 265 zeigt sie unter Leistungswerte an, sofern sie erfasst wurde (meist mit Brustgurt). Alternativ: 30 min allein so schnell wie möglich laufen – der Durchschnittspuls der letzten 20 Minuten ist ein guter Wert.</p>`;
  h += `<button class="btn ghost" data-action="settings" style="margin-top:6px">Werte anpassen</button>`;
  h += `<h2>Tempobereiche</h2>`;
  if (!paces){
    h += `<p class="small muted">Noch keine Tempobereiche: Es fehlt ein Leistungswert. Trag ein Wettkampfergebnis in den Einstellungen ein oder importiere Läufe mit schnellen Abschnitten (ab 3 km).</p>`;
  } else {
    const rows = [
      ['Locker (E)', fmtPace(paces.E[0])+' – '+fmtPace(paces.E[1]), 'Grundlage, lange Läufe, Erholung', 'var(--z2)'],
      ['Marathontempo (M)', fmtPace(paces.M), 'Spezifische Marathonblöcke', 'var(--z3)'],
      ['Halbmarathontempo', fmtPace(paces.HM), 'Spezifische HM-Blöcke', 'var(--z4)'],
      ['Schwelle (T)', fmtPace(paces.T), 'Tempodauerläufe, 5–15-min-Intervalle', 'var(--z4)'],
      ['Intervall (I)', fmtPace(paces.I), '3–5-min-Intervalle, VO₂max', 'var(--z5)']
    ];
    const tt = parseGoalTime(S.targetTime);
    if (tt) rows.splice(3, 0, ['Dein Zieltempo', fmtPace(tt/((S.goal==='hm'?21.0975:42.195))), 'Aus deiner Zielzeit '+fmtDur(tt), 'var(--accent)']);
    h += `<p class="small muted">Nach Jack Daniels’ VDOT-Modell (angenähert), VDOT ${num(vd.vdot,1)}. Quelle: ${esc(vd.src)}.</p>
      <div class="list ztable">${rows.map(r => `<div class="item"><div class="zchip" style="background:${r[3]};width:6px;height:34px;border-radius:3px"></div><div class="main"><div class="t1">${r[0]}</div><div class="t2">${r[2]}</div></div><div class="big">${r[1]}<span class="small muted"> /km</span></div></div>`).join('')}</div>`;
  }
  return h;
}

function viewTrends(){
  const {acts, der, series} = state;
  const now = Date.now();
  let h = statusPanel();
  h += vo2Panel();

  // Belastung nach Sportart (12 Wochen, gestapelt)
  const m0 = mondayOf(now), weeks = [];
  for (let w = 11; w >= 0; w--){ const ws = new Date(m0); ws.setDate(ws.getDate() - 7*w); weeks.push(ws.getTime()); }
  const kinds = Object.keys(KINDS), load = Object.fromEntries(kinds.map(k => [k, weeks.map(() => 0)]));
  for (const a of acts){ const wi = weeks.findIndex((ws, i) => a.start >= ws && a.start < (weeks[i+1] || ws + 7*864e5)); if (wi >= 0 && der[a.id]) load[a.kind || 'other'][wi] += der[a.id].trimp; }
  const used = kinds.filter(k => load[k].some(v => v > 0));
  h += `<h2>Belastung nach Sportart</h2><div class="panel">
    <div class="legend">${used.map(k => `<span><b style="background:${KIND_COLORS[k]}"></b>${KINDS[k]}</span>`).join('')}</div>
    ${chart(used.map(k => ({v:load[k].map(v => Math.round(v)), c:KIND_COLORS[k], stack:true, name:KINDS[k], fmt:x=>num(x)})), {h:130, min:0, xs:weeks, fmtX:weekOf, label:'Wöchentliche Belastung nach Sportart', title:'Belastung nach Sportart'})}
    <p class="small muted" style="margin:8px 0 0">Summe der Belastung (TRIMP) pro Woche. Krafttraining zählt über deine Anstrengungs-Angabe (RPE), wenn vorhanden.</p></div>`;

  const wk = weeklyKm(acts, 12);
  h += `<h2>Laufumfang</h2><div class="panel">
    ${chart([{v:wk.map(w=>Math.round(w.km*10)/10), c:'var(--data)', bars:true, op:.85, name:'Laufen', fmt:x=>num(x,1)+' km'}], {h:110, min:0, xs:wk.map(w=>w.start), fmtX:weekOf, label:'Laufkilometer pro Woche', title:'Laufkilometer pro Woche'})}
    <p class="small muted" style="margin:6px 0 0">Max. ${num(Math.max(...wk.map(w=>w.km)))} km · diese Woche ${num(wk[wk.length-1].km)} km</p></div>`;

  const s90 = series.slice(-90);
  h += `<h2>Fitness, Ermüdung, Form</h2><div class="panel">
    <div class="legend"><span><b style="background:var(--data)"></b>Fitness (42 Tage)</span><span><b style="background:var(--hr)"></b>Ermüdung (7 Tage)</span><span><b style="background:var(--z3)"></b>Form</span></div>
    ${chart([{v:s90.map(x=>Math.round(x.tsb*10)/10), c:'var(--z3)', bars:true, op:.45, name:'Form', fmt:x=>signed(x)}, {v:s90.map(x=>x.ctl), c:'var(--data)', w:2.4, name:'Fitness', fmt:x=>num(x)}, {v:s90.map(x=>x.atl), c:'var(--hr)', w:1.5, name:'Ermüdung', fmt:x=>num(x)}, {v:s90.map(x=>x.load), c:'var(--muted)', hidden:true, name:'Tagesbelastung', fmt:x=>num(x)}],
      {h:160, zero:true, xs:s90.map(x=>x.ts), fmtX:dayOf, label:'Belastungsverlauf 90 Tage', title:'Fitness, Ermüdung und Form'})}
    <p class="small muted" style="margin:8px 0 0">Basis ist der Banister-TRIMP aus deiner Herzfrequenz – also deine innere Belastung, nicht nur Kilometer.</p></div>`;

  const efp = acts.filter(a => der[a.id] && der[a.id].ef && now - a.start < 180*864e5).sort((a,b) => a.start-b.start);
  h += `<h2>Effizienz bei lockeren Läufen</h2><div class="panel">`;
  if (efp.length >= 3){
    const ys = efp.map(a => der[a.id].ef), n = ys.length, xs = ys.map((_,i)=>i);
    const mx = xs.reduce((a,c)=>a+c,0)/n, my = ys.reduce((a,c)=>a+c,0)/n;
    const sl = xs.reduce((a,x,i)=>a+(x-mx)*(ys[i]-my),0) / (xs.reduce((a,x)=>a+(x-mx)**2,0) || 1);
    const fit = xs.map(x => my + sl*(x-mx)), chg = (fit[n-1]-fit[0])/fit[0]*100;
    h += chart([{v:ys, c:'var(--data)', dots:true, name:'Effizienz', fmt:x=>num(x,2)}, {v:fit, c:'var(--ink)', w:1.4, dash:true, name:'Trend', fmt:x=>num(x,2)}], {h:110, xs:efp.map(a=>a.start), fmtX:dayOf, label:'Effizienzfaktor', title:'Effizienz bei lockeren Läufen'}) +
      `<p class="small" style="margin:8px 0 0">Meter pro Minute je Herzschlag. Trend: <b>${chg >= 0 ? '+' : ''}${num(chg,1)} %</b> – ${chg > 1 ? 'du läufst bei gleichem Puls schneller, die aerobe Basis wächst.' : chg < -1 ? 'leicht rückläufig. Ermüdung, Hitze oder Krankheit können das erklären.' : 'stabil.'}</p>`;
  } else h += `<p class="small muted" style="margin:0">Braucht mindestens drei lockere Läufe ab 20 Minuten mit Herzfrequenz.</p>`;
  h += `</div>`;

  const z = [0,0,0,0,0]; for (const a of acts) if (now - a.start < 28*864e5 && der[a.id]) der[a.id].zs.forEach((v,i)=>z[i]+=v);
  const zt = z.reduce((a,c)=>a+c,0);
  h += `<h2>Zonenverteilung (4 Wochen)</h2><div class="panel">`;
  if (zt){
    h += `<div class="zbar" style="height:16px;margin:2px 0 10px">${z.map((v,i)=> v ? `<i style="width:${v/zt*100}%;background:${ZC[i]}"></i>` : '').join('')}</div>` +
      z.map((v,i) => `<div style="display:flex;justify-content:space-between;font-size:14.5px;padding:3px 0"><span><span class="tag" style="background:${ZC[i]}"></span>Z${i+1} ${ZN[i]}</span><span>${fmtDur(v).replace(/:\d\d$/, '')} h · ${num(v/zt*100)} %</span></div>`).join('');
  } else h += `<p class="small muted" style="margin:0">Keine Herzfrequenzdaten in den letzten 4 Wochen.</p>`;
  h += `</div>`;

  const W = state.W;
  if (Object.keys(W.rhr).length || Object.keys(W.sleep).length){
    const days = []; for (let i=89;i>=0;i--) days.push(dayKey(now - i*864e5));
    const rv = days.map(d => rhrOf(W, d)), bv = days.map(d => rhrBaseline(W, d));
    const have = rv.filter(x => x != null);
    const dts = days.map(d => new Date(d+'T12:00').getTime());
    if (have.length >= 3){
      const f7 = have.slice(-7), f28 = rv.slice(-35, -7).filter(x=>x!=null);
      const a7 = f7.reduce((a,c)=>a+c,0)/f7.length, a28 = f28.length ? f28.reduce((a,c)=>a+c,0)/f28.length : null;
      h += `<h2>Ruhepuls (90 Tage)</h2><div class="panel"><div class="legend"><span><b style="background:var(--hr)"></b>Ruhepuls</span><span><b style="background:var(--muted)"></b>4-Wochen-Schnitt</span></div>
        ${chart([{v:bv, c:'var(--muted)', w:1.3, dash:true, name:'Schnitt', fmt:x=>num(x,1)+' bpm'}, {v:rv, c:'var(--hr)', w:1.8, name:'Ruhepuls', fmt:x=>num(x)+' bpm'}], {h:110, min:Math.min(...have)-3, max:Math.max(...have)+3, xs:dts, fmtX:dayOf, label:'Ruhepuls', title:'Ruhepuls'})}
        <p class="small" style="margin:8px 0 0">Letzte 7 Tage Ø <b>${num(a7,1)} bpm</b>${a28 !== null ? `, davor ${num(a28,1)} bpm. ${a7 < a28 - 1 ? 'Sinkender Ruhepuls ist meist ein Zeichen wachsender Fitness oder guter Erholung.' : a7 > a28 + 2 ? 'Der Ruhepuls steigt – Belastung, Schlaf und Stress im Blick behalten.' : 'Stabil.'}` : '.'}</p></div>`;
    }
    const sd = []; for (let i=29;i>=0;i--) sd.push(dayKey(now - i*864e5));
    const sls = sd.map(d => sleepOf(W, d)), tgt = (parseFloat(String(state.S.sleepTarget||'7.5').replace(',','.')) || 7.5);
    const valid = sls.filter(Boolean);
    if (valid.length >= 3){
      const avg = arr => arr.reduce((a,c)=>a+c,0)/arr.length;
      const l7 = sls.slice(-7).filter(Boolean), st = valid.filter(x => x.stages);
      h += `<h2>Schlaf (30 Nächte)</h2><div class="panel"><div class="legend"><span><b style="background:var(--data)"></b>Schlafdauer</span><span><b style="background:var(--z3)"></b>Ziel ${num(tgt,1)} h</span></div>
        ${chart([{v:sls.map(x => x ? Math.round(x.tot/6)/10 : null), c:'var(--data)', bars:true, op:.75, name:'Schlaf', fmt:x=>fmtHM(x*60)}, {v:sd.map(()=>tgt), c:'var(--z3)', w:1.4, dash:true, name:'Ziel', fmt:x=>fmtHM(x*60)}, {v:sls.map(x => x && x.stages ? x.deep : null), c:'var(--muted)', hidden:true, name:'Tiefschlaf', fmt:x=>fmtHM(x)}],
          {h:110, min:0, max:Math.max(tgt+1, ...valid.map(x=>x.tot/60)), xs:sd.map(d => new Date(d+'T12:00').getTime()), fmtX:dayOf, label:'Schlafdauer', title:'Schlaf'})}
        <p class="small" style="margin:8px 0 0">Ø letzte 7 Nächte <b>${l7.length ? fmtHM(avg(l7.map(x=>x.tot))) : '–'}</b>, Ø 30 Nächte ${fmtHM(avg(valid.map(x=>x.tot)))}.${st.length ? ` Tiefschlaf im Schnitt ${num(avg(st.map(x=>x.deep/x.tot*100)))} %, REM ${num(avg(st.map(x=>x.rem/x.tot*100)))} %.` : ''}</p></div>`;
    }
  }

  const cadp = acts.filter(a => a.isRun && a.cad && now - a.start < 180*864e5).sort((a,b)=>a.start-b.start);
  if (cadp.length >= 3){
    h += `<h2>Schrittfrequenz</h2><div class="panel">${chart([{v:cadp.map(a=>a.cad), c:'var(--z3)', dots:true, name:'Schrittfrequenz', fmt:x=>num(x)+' /min'}], {h:90, xs:cadp.map(a=>a.start), fmtX:dayOf, label:'Schrittfrequenz', title:'Schrittfrequenz'})}
      <p class="small muted" style="margin:6px 0 0">Ø ${num(cadp.reduce((s,a)=>s+a.cad,0)/cadp.length)} Schritte/min</p></div>`;
  }
  const best = {};
  for (const a of acts) if (a.isRun && now - a.start < 365*864e5) for (const d in a.bestD) if (!best[d] || a.bestD[d] < best[d].t) best[d] = {t:a.bestD[d], a};
  const bk = Object.keys(best).sort((x,y)=>x-y);
  if (bk.length){
    h += `<h2>Bestzeiten (12 Monate)</h2><div class="list">${bk.map(d => `<button class="item" data-act="${esc(best[d].a.id)}"><div class="main"><div class="t1">${({1000:'1 km',5000:'5 km',10000:'10 km',21097.5:'Halbmarathon',42195:'Marathon'})[d]}</div><div class="t2">${fmtDate(best[d].a.start,true)} · ${fmtPace(best[d].t/(d/1000))}/km</div></div><div class="big">${fmtDur(best[d].t)}</div></button>`).join('')}</div>
      <p class="small muted" style="margin-top:6px">Schnellster Abschnitt innerhalb eines Laufs, aus GPS-Daten – kann leicht abweichen.</p>`;
  }
  return h;
}

/* ---------- Detailansicht ---------- */
function lapsHTML(a){
  const L = a.laps; if (!L || L.length < 2) return '';
  const spd = L.map(l => l.spd || (l.dist && l.dur ? l.dist/l.dur : 0));
  const med = median(spd.filter(x => x > 0)) || 0;
  const work = L.map((l, i) => a.isRun && med > 0 && spd[i] > med * 1.08 && (l.dur || 0) < 1200);
  const nW = work.filter(Boolean).length;
  let summary = '';
  if (a.isRun && nW >= 3 && nW < L.length){
    const wl = L.filter((_, i) => work[i]), avg = f => wl.reduce((s, l) => s + (f(l) || 0), 0) / wl.length;
    const dists = wl.map(l => l.dist || 0), dMed = median(dists);
    const sameDist = dists.every(d => Math.abs(d - dMed) <= Math.max(30, dMed * 0.06));
    const what = sameDist ? (dMed >= 1000 ? num(dMed/1000, dMed % 1000 ? 1 : 0)+' km' : Math.round(dMed/10)*10+' m') : fmtDur(avg(l => l.dur));
    const hr = avg(l => l.hr);
    summary = `<p class="small interval"><b>Intervalle erkannt:</b> ${nW} × ${what} in Ø ${fmtPace(avg(l => l.dur) / (avg(l => l.dist) / 1000))}/km${hr ? `, Ø HF ${Math.round(hr)}` : ''}.</p>`;
  }
  const rows = L.map((l, i) => `<tr class="${work[i] ? 'work' : ''}"><td>${i+1}</td><td>${l.dist != null ? fmtKm(l.dist, 2) : '–'}</td><td>${fmtDur(l.dur)}</td><td>${a.isRun && spd[i] > 0.5 ? fmtPace(1000/spd[i]) : spd[i] > 0 ? num(spd[i]*3.6, 1) : '–'}</td><td>${l.hr || '–'}</td></tr>`).join('');
  return `<h3>Runden</h3>${summary}<div class="panel laps"><div class="scroll-x"><table><thead><tr><th>#</th><th>km</th><th>Zeit</th><th>${a.isRun ? 'Pace' : 'km/h'}</th><th>HF</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function setsHTML(a){
  if (a.kind !== 'strength') return '';
  if (!a.sets || !a.sets.length) return `<h3>Sätze</h3><div class="panel"><p class="small muted" style="margin:0">In dieser Aufzeichnung sind keine Sätze gespeichert. Mit dem Uhr-Profil „Krafttraining“ werden Übungen, Wiederholungen und Gewichte mit aufgezeichnet.</p></div>`;
  const groups = [];
  for (const x of a.sets){
    const key = x.cat + ':' + (x.sub != null ? x.sub : (x.name || ''));
    let g = groups[groups.length-1];
    if (!g || g.key !== key){ g = {key, label: catName(x.cat), name: x.name || exerciseName(x.cat, x.sub), sets: []}; groups.push(g); }
    g.sets.push(x);
  }
  const reps = a.sets.reduce((s,x) => s + (x.reps || 0), 0), ton = a.sets.reduce((s,x) => s + (x.kg || 0) * (x.reps || 0), 0);
  return `<h3>Sätze</h3><p class="small muted" style="margin:0 0 8px">${a.sets.length} Sätze · ${reps} Wiederholungen${ton ? ' · ' + num(ton) + ' kg bewegt' : ''}</p>
    <div class="list">${groups.map(g => `<div class="item"><div class="main"><div class="t1">${esc(g.label)}</div>${g.name ? `<div class="t2">${esc(g.name)}</div>` : ''}
      <div class="chips">${g.sets.map(x => `<span>${x.reps != null ? x.reps : '–'}${x.kg ? ' × ' + num(x.kg, x.kg % 1 ? 1 : 0) + ' kg' : ''}${x.reps == null && x.dur ? fmtDur(x.dur) : ''}</span>`).join('')}</div></div></div>`).join('')}</div>`;
}
function openAct(id){
  const a = state.acts.find(x => x.id === id); if (!a) return;
  const d = state.der[id], st = a.stream, b = hrBounds(state.P.lthr), n = st.t.length;
  const sm = i => { let s=0,c=0; for (let k=Math.max(0,i-6); k<=Math.min(n-1,i+6); k++){ if (st.v[k] > 0){ s+=st.v[k]; c++; } } return c ? s/c : 0; };
  const hr = st.hr.map(x => x > 0 ? x : null);
  const spd = st.v.map((_, i) => sm(i));
  const hasHR = hr.some(x => x), moving = spd.some(v => v > 1);
  const pace = spd.map(v => a.isRun && v > 1.3 ? 1000/v : null), pv = pace.filter(x => x).sort((x,y) => x-y);
  const alt = (st.a || []).map(x => x != null ? x : null), av = alt.filter(x => x != null);
  const hasAlt = av.length > 20 && Math.max(...av) - Math.min(...av) > 8;
  const cad = a.isRun ? st.c.map((c, i) => c > 100 && spd[i] > 1.5 ? c : null) : [];
  const grp = 'act:' + a.id, xs = st.t, fmtX = (t, k) => fmtDur(t) + (st.d[k] > 0 ? ' · ' + fmtKm(st.d[k], 2) + ' km' : '');
  const annot = state.annot[a.id] || {}, vo2 = vo2maxRun(a, state.P);
  const isStr = a.kind === 'strength', isTeam = a.kind === 'team';
  const tiles = [];
  if (a.dist > 50) tiles.push([fmtKm(a.dist, 2), 'km']);
  tiles.push([fmtDur(a.timer), 'Zeit']);
  if (a.isRun) tiles.push([a.avgSpd ? fmtPace(1000/a.avgSpd) : '–', 'Ø Pace /km']);
  else if (a.dist > 50 && !isTeam) tiles.push([num(a.avgSpd*3.6, 1), 'Ø km/h']);
  if (isStr && a.sets) tiles.push([a.sets.length, 'Sätze']);
  if (isTeam && a.sprints != null) tiles.push([a.sprints, 'Sprints']);
  if (a.avgHR) tiles.push([a.avgHR, 'Ø HF']);
  tiles.push([num(d.trimp), 'Belastung' + (d.src === 'est' ? ' (geschätzt)' : d.src === 'rpe' ? ' (RPE)' : '')]);
  const more = [];
  if (a.maxHR) more.push([a.maxHR, 'max. HF']);
  if (annot.rpe) more.push([annot.rpe, 'Anstrengung']);
  if (a.ascent) more.push([a.ascent + ' m', 'Anstieg']);
  if (a.kcal) more.push([a.kcal, 'kcal']);
  if (a.te != null) more.push([num(a.te,1), 'Training Effect']);
  while (tiles.length % 3 && more.length) tiles.push(more.shift());
  while (tiles.length % 3) tiles.pop();
  let h = `<div class="bar"><h2>${esc(a.name)}</h2><button class="icon-btn" data-action="close" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="wrap">
    <p class="muted" style="margin-top:0">${fmtDate(a.start,true)}, ${new Date(a.start).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} Uhr${a.profile && a.profile !== a.name ? ' · ' + esc(a.profile) : ''}${a.multiOf ? ' · Teil ' + (a.multi + 1) + ' von ' + a.multiOf : ''}</p>
    <div class="stats">${tiles.map(t => `<div><div class="v">${t[0]}</div><div class="l">${t[1]}</div></div>`).join('')}</div>`;
  if (st.la && st.la.some(x => x != null)) h += `<h3>Strecke</h3>${RouteMap.html(a)}<p class="small muted" style="margin:6px 0 0">Farbe = Herzfrequenzzone. Wische in einem Diagramm, um die Stelle auf der Karte zu sehen.${state.S.mapTiles ? '' : ' Kartenhintergrund in den Einstellungen einschaltbar.'}</p>`;
  if (hasHR) h += `<h3>Herzfrequenz</h3><div class="panel">${chart([{v:hr, c:'var(--hr)', w:1.6, name:'HF', fmt:x=>Math.round(x)+' bpm'}], {h:130, group:grp, xs, fmtX, min: Math.max(60, Math.min(...hr.filter(x=>x)) - 5), max: Math.max(...hr.filter(x=>x)) + 3, bands: [0,1,2,3,4].map(i => ({from: i ? b[i-1] : 0, to: i < 4 ? b[i] : 250, c: ZC[i]})), label:'Herzfrequenzverlauf', title:'Herzfrequenz'})}</div>`;
  if (a.isRun && pv.length > 10) h += `<h3>Pace</h3><div class="panel">${chart([{v:pace, c:'var(--pace)', w:1.6, name:'Pace', fmt:x=>fmtPace(x)+'/km', area:true, areaBase: pv[Math.floor(pv.length*0.98)] + 15}], {h:120, group:grp, xs, fmtX, invert:true, min: pv[Math.floor(pv.length*0.02)] - 10, max: pv[Math.floor(pv.length*0.98)] + 15, label:'Paceverlauf', title:'Pace (schneller oben)'})}</div>`;
  else if (!a.isRun && moving && !isStr) h += `<h3>Geschwindigkeit</h3><div class="panel">${chart([{v:spd.map(v => v > 0 ? Math.round(v*36)/10 : null), c:'var(--pace)', w:1.6, name:'Tempo', fmt:x=>num(x,1)+' km/h', area:true}], {h:110, group:grp, xs, fmtX, min:0, label:'Geschwindigkeit', title:'Geschwindigkeit'})}</div>`;
  if (hasAlt) h += `<h3>Höhe</h3><div class="panel">${chart([{v:alt, c:'var(--muted)', w:1.6, name:'Höhe', fmt:x=>Math.round(x)+' m', area:true}], {h:90, group:grp, xs, fmtX, label:'Höhenprofil', title:'Höhenprofil'})}</div>`;
  if (cad.some(x => x)) h += `<h3>Schrittfrequenz</h3><div class="panel">${chart([{v:cad, c:'var(--z3)', w:1.2, name:'Schritte', fmt:x=>Math.round(x)+' /min'}], {h:80, group:grp, xs, fmtX, label:'Schrittfrequenz', title:'Schrittfrequenz'})}</div>`;
  const zt = d.zs.reduce((x,y)=>x+y,0);
  if (zt) h += `<h3>Zeit in Zonen</h3><div class="panel">${d.zs.map((v,i) => `<div class="hbar zone"><span>Z${i+1}</span><i><b style="width:${v/zt*100}%;background:${ZC[i]}"></b></i><em>${fmtDur(v)}</em></div>`).join('')}</div>`;
  h += lapsHTML(a);
  h += setsHTML(a);
  // Anstrengung
  h += `<h3>Anstrengung (RPE)</h3><div class="panel"><div class="seg rpe" data-rpe="${esc(a.id)}" role="group" aria-label="Anstrengung 1 bis 10">${[1,2,3,4,5,6,7,8,9,10].map(i => `<button type="button" data-val="${i}" aria-pressed="${annot.rpe === i}">${i}</button>`).join('')}</div>
    <p class="small muted" style="margin:8px 0 0">1 = sehr leicht, 10 = maximal. ${isStr || !hasHR ? 'Wird für die Belastung genutzt (Dauer × Anstrengung), weil hier der Puls fehlt oder Krafttraining unterschätzt.' : 'Hilft der App, Einheiten ohne Puls (z. B. Krafttraining) richtig einzuordnen.'} Nochmal tippen entfernt die Angabe.</p></div>`;
  const rows = [];
  if (vo2) rows.push(['VO2max-Schätzung', num(vo2,1), 'Aus gleichmäßigen Abschnitten dieses Laufs.']);
  if (d.dec !== null) rows.push(['Aerobe Entkopplung', num(d.dec,1)+' %', d.dec < 5 ? 'Unter 5 %: Puls bleibt stabil, gute Ausdauer für dieses Tempo.' : 'Über 5 %: Der Puls driftet in der zweiten Hälfte nach oben.']);
  if (d.ef) rows.push(['Effizienzfaktor', num(d.ef,2), 'Meter pro Minute je Herzschlag – im Verlauf vergleichen.']);
  if (a.topSpd) rows.push(['Höchstgeschwindigkeit', num(a.topSpd*3.6,1)+' km/h', a.sprints != null ? a.sprints + ' Sprints über 20 km/h' : '']);
  if (a.te != null) rows.push(['Training Effect (Garmin)', num(a.te,1)+(a.ane != null ? ' / '+num(a.ane,1)+' anaerob' : ''), '']);
  if (a.gLoad != null) rows.push(['Trainingsbelastung (Garmin)', num(a.gLoad), '']);
  if (a.cad) rows.push(['Schrittfrequenz', a.cad+' /min', '']);
  if (a.gct) rows.push(['Bodenkontaktzeit', a.gct+' ms', '']);
  if (a.vo) rows.push(['Vertikale Bewegung', num(a.vo,1)+' cm', '']);
  if (a.ascent != null) rows.push(['Anstieg', a.ascent+' m', '']);
  if (a.kcal != null) rows.push(['Kalorien', a.kcal+' kcal', '']);
  if (rows.length) h += `<h3>Kennzahlen</h3><div class="list">${rows.map(r => `<div class="item"><div class="main"><div class="t1">${r[0]}</div>${r[2] ? `<div class="t2">${r[2]}</div>` : ''}</div><div class="big" style="font-size:20px">${r[1]}</div></div>`).join('')}</div>`;
  const bd = Object.keys(a.bestD).sort((x,y)=>x-y);
  if (bd.length) h += `<h3>Schnellste Abschnitte</h3><div class="list">${bd.map(k => `<div class="item"><div class="main"><div class="t1">${({1000:'1 km',5000:'5 km',10000:'10 km',21097.5:'Halbmarathon',42195:'Marathon'})[k]}</div></div><div class="big" style="font-size:20px">${fmtDur(a.bestD[k])}</div></div>`).join('')}</div>`;
  if (a.v == null || a.v < SCHEMA) h += `<p class="small muted" style="margin-top:16px">Diese Aktivität wurde mit einer älteren Version importiert. Importiere die FIT-Datei erneut, um Karte, Runden und Sätze zu sehen – deine Angaben bleiben erhalten.</p>`;
  h += `<p style="margin-top:22px"><button class="btn danger" data-action="delact" data-id="${esc(a.id)}">Aktivität löschen</button></p></div>`;
  openSheet(h);
}

/* ---------- Einstellungen ---------- */
function openSettings(){
  const S = state.S, P = state.P;
  const cur = name => name === 'mapTiles' ? (S.mapTiles ? '1' : '0') : String(S[name] != null ? S[name] : '');
  const seg = (name, opts, label) => `<div class="seg" data-seg="${name}" role="group" aria-label="${label}">${opts.map(o => `<button type="button" data-val="${o[0]}" aria-pressed="${cur(name) === String(o[0])}">${o[1]}</button>`).join('')}</div>`;
  // Zeit als drei Felder (Std/Min/Sek) mit Zifferntastatur – kein Doppelpunkt nötig
  const timeField = (id, sec, ph, hideZeroH) => {
    const v = splitDuration(sec); if (hideZeroH && v[0] === '0') v[0] = '';
    const f = (k, i, name, max) => `<label class="tpart"><input id="${id}-${k}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="${max}" placeholder="${ph[i]}" value="${esc(v[i])}" aria-label="${name}"><span>${name}</span></label>`;
    return `<div class="tfield" role="group" aria-labelledby="${id}-l">${f('h',0,'Std',1)}<b>:</b>${f('m',1,'Min',2)}<b>:</b>${f('s',2,'Sek',2)}</div>`;
  };
  const numField = (id, label, val, ph, unit, mode = 'numeric') => `<div class="field"><label for="${id}">${label}</label><div class="unit"><input id="${id}" type="text" inputmode="${mode}" autocomplete="off" placeholder="${esc(ph)}" value="${esc(val||'')}">${unit ? `<span>${unit}</span>` : ''}</div></div>`;
  const goalPh = S.goal === 'hm' ? ['1','45','00'] : ['3','45','00'];
  const h = `<div class="bar"><h2>Einstellungen</h2><button class="icon-btn" data-action="close" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <div class="wrap form">
    <h2 style="margin-top:6px">Ziel</h2>
    <div class="field"><label>Distanz</label>${seg('goal', [['hm','Halbmarathon'],['m','Marathon']], 'Zieldistanz')}</div>
    <div class="field"><label for="raceDate">Wettkampfdatum</label><input type="date" id="raceDate" value="${esc(S.raceDate||'')}"></div>
    <div class="field"><label id="targetTime-l">Zielzeit</label>${timeField('targetTime', parseGoalTime(S.targetTime), goalPh, false)}</div>
    <div class="field"><label>Läufe pro Woche</label>${seg('runsPerWeek', [[3,'3'],[4,'4'],[5,'5'],[6,'6']], 'Läufe pro Woche')}</div>

    <h2>Kraft & feste Termine</h2>
    <div class="field"><label>Krafteinheiten pro Woche</label>${seg('strengthPerWeek', [[0,'keine'],[1,'1'],[2,'2'],[3,'3']], 'Krafteinheiten pro Woche')}</div>
    <div class="hint">Der Plan setzt sie an Tage mit Qualitätseinheit oder lockerem Lauf, gern auch samstags kombiniert mit einem lockeren Lauf. Vor langen Läufen nur Rumpf & Oberkörper.</div>
    <div class="field"><label>Fester Termin an</label><div class="chips-pick" data-chips="teamDays" role="group" aria-label="Wochentage für feste Termine">${WD.map((w,i) => `<button type="button" data-val="${i}" aria-pressed="${(S.teamDays||[]).map(Number).includes(i)}">${w}</button>`).join('')}</div></div>
    ${numField('teamSport', 'Was für ein Termin?', S.teamSport, 'Fußball', '', 'text')}
    <div class="hint">Zählt als harte Einheit: Am Folgetag plant die App keine Qualitätseinheit. Fällt der Termin aus, schlägt „Heute“ am nächsten Tag einen lockeren Lauf vor.</div>

    <h2>Körperwerte</h2>
    <p class="small muted">Leer lassen = automatisch aus deinen Daten geschätzt. Der Schätzwert steht grau im Feld.</p>
    <div class="two">
      ${numField('maxHR', 'HFmax', S.maxHR, P.maxHR, 'bpm')}
      ${numField('restHR', 'Ruhepuls', S.restHR, P.restHR, 'bpm')}
    </div>
    ${numField('lthr', 'Laktatschwellen-Puls', S.lthr, P.lthr, 'bpm')}
    <div class="hint">Aktuell: ${esc(P.src.lthr)}. Wichtigster Wert für deine Zonen.</div>
    <div class="two">
      ${numField('age', 'Alter', S.age, '', 'Jahre')}
      ${numField('sleepTarget', 'Schlafziel', String(S.sleepTarget||'').replace('.', ','), '7,5', 'Std', 'decimal')}
    </div>
    <div class="field"><label>Geschlecht</label>${seg('sex', [['m','männlich'],['f','weiblich']], 'Geschlecht')}</div>
    <div class="hint">Beeinflusst nur die Belastungsformel (TRIMP). Das Schlafziel ist die Grundlage für die Schlafbewertung.</div>

    <h2>Letztes Wettkampfergebnis</h2>
    <p class="small muted">Optional, macht Tempobereiche und Prognosen deutlich genauer. Nimm ein Rennen der letzten 2–3 Monate.</p>
    <div class="field"><label for="raceDist">Distanz</label><div class="select"><select id="raceDist">${[['','– keins –'],['5','5 km'],['10','10 km'],['21.0975','Halbmarathon'],['42.195','Marathon']].map(o => `<option value="${o[0]}" ${String(S.raceDist||'')===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></div></div>
    <div class="field"><label id="raceTime-l">Zeit</label>${timeField('raceTime', parseDuration(S.raceTime), ['0','45','30'], true)}</div>

    <h2>Karte</h2>
    <div class="field"><label>Kartenhintergrund</label>${seg('mapTiles', [['0','aus'],['1','OpenStreetMap']], 'Kartenhintergrund')}</div>
    <div class="hint">Die Strecke wird immer lokal gezeichnet. Mit Kartenhintergrund lädt die App Kartenkacheln von OpenStreetMap – der Kartenserver sieht dabei deine IP-Adresse und welchen Kartenausschnitt du ansiehst. Deine GPS-Daten selbst werden nicht übertragen.</div>
    <div class="savebar"><button class="btn" data-action="save">Speichern</button><span class="small muted">Änderungen gelten sofort für Zonen, Prognose und Plan.</span></div>

    <h2>Daten</h2>
    <p class="small">${state.acts.length} Aktivitäten gespeichert. Die Original-FIT-Dateien bleiben in Garmin Connect, du kannst sie jederzeit neu importieren.</p>
    <p class="small">Tageswerte: ${Object.keys(state.W.rhr).length} Tage Ruhepuls, ${Object.keys(state.W.sleep).length} Nächte Schlaf.</p>
    <p style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn danger" data-action="clearall">Alle Aktivitäten löschen</button><button class="btn danger" data-action="clearwell">Tageswerte löschen</button></p>
    ${privacyNote()}
    <p class="version">Laufbuch · Version ${esc(APP_VERSION)}</p>
  </div>`;
  openSheet(h);
}
async function saveSettings(){
  const g = id => { const el = $('#'+id); return el ? el.value.trim() : ''; };
  const time = id => joinDuration(g(id+'-h'), g(id+'-m'), g(id+'-s'));
  const bad = (id, msg) => { const el = $('#'+id); if (el){ el.setAttribute('aria-invalid', 'true'); el.focus(); } toast(msg); };
  document.querySelectorAll('.form [aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  const tt = time('targetTime'), rt = time('raceTime');
  if (tt === null) return bad('targetTime-m', 'Zielzeit prüfen: nur Ziffern, Minuten und Sekunden höchstens 59.');
  if (rt === null) return bad('raceTime-m', 'Wettkampfzeit prüfen: nur Ziffern, Minuten und Sekunden höchstens 59.');
  const nums = [['maxHR', 120, 230, 'HFmax'], ['restHR', 25, 100, 'Ruhepuls'], ['lthr', 100, 220, 'Laktatschwellen-Puls'], ['age', 10, 99, 'Alter']];
  for (const [id, lo, hi, name] of nums){ const v = g(id); if (v && !(+v >= lo && +v <= hi)) return bad(id, `${name}: bitte eine Zahl zwischen ${lo} und ${hi} eingeben.`); }
  const sl = g('sleepTarget'); if (sl && !(parseNum(sl) >= 4 && parseNum(sl) <= 12)) return bad('sleepTarget', 'Schlafziel: bitte zwischen 4 und 12 Stunden eingeben.');
  const S = state.S;
  S.raceDate = g('raceDate'); S.targetTime = tt; S.raceTime = rt;
  S.maxHR = g('maxHR'); S.restHR = g('restHR'); S.lthr = g('lthr'); S.age = g('age');
  S.raceDist = g('raceDist'); S.sleepTarget = sl; S.teamSport = g('teamSport') || 'Fußball';
  try { await DB.setMeta('settings', JSON.parse(JSON.stringify(S))); } catch(e){}
  recompute(); closeSheet(); render(); toast('Gespeichert');
}

async function importFiles(files){
  const existing = new Map(state.acts.map(a => [a.id, a]));
  let added = 0, dup = 0, other = 0, failed = 0, seen = 0, upgraded = 0;
  const hk = [];
  let hkSeen = false;
  toast('Lese Dateien …', true);
  const lineSink = () => { let carry = ''; return { push(c){ const ls = (carry + c).split('\n'); carry = ls.pop(); for (const l of ls) parseHealthXmlLine(l, hk); }, end(){ if (carry) parseHealthXmlLine(carry, hk); } }; };
  async function healthFromEntry(e){
    hkSeen = true; const sink = lineSink(); let lastP = -5;
    await new Promise((res, rej) => {
      e.internalStream('string').on('data', (c, meta) => { sink.push(c); if (meta && meta.percent - lastP >= 2){ lastP = meta.percent; toast('Apple-Health-Export wird gelesen … '+Math.round(meta.percent)+' %', true); } })
        .on('error', rej).on('end', () => { sink.end(); res(); }).resume();
    });
  }
  async function healthFromFile(f){
    hkSeen = true; const sink = lineSink(), rd = f.stream().pipeThrough(new TextDecoderStream()).getReader(); let n = 0;
    for (;;){ const {done, value} = await rd.read(); if (done) break; sink.push(value); n += value.length; if (n > 2e7){ n = 0; toast('Apple-Health-Export wird gelesen …', true); } }
    sink.end();
  }
  async function handle(buf){
    const u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (u[0] === 0x50 && u[1] === 0x4B){
      if (!window.JSZip) throw new Error('zip');
      const z = await JSZip.loadAsync(buf);
      const entries = Object.values(z.files).filter(f => !f.dir && /\.(fit|zip)$/i.test(f.name) && !/(^|\/)(__MACOSX|\._)/.test(f.name));
      const hx = Object.values(z.files).find(f => !f.dir && /(^|\/)(export|Export)\.xml$/.test(f.name));
      if (hx) await healthFromEntry(hx);
      for (const e of entries){ try { await handle(await e.async('arraybuffer')); } catch(err){ if (err.message === 'zip') throw err; failed++; } }
      return;
    }
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(8, buf.byteLength)));
    if (/^\s*(LB1|R;|S;)/.test(head)){ hkSeen = true; hk.push(...parseShortcutText(new TextDecoder().decode(buf))); return; }
    seen++;
    if (seen % 15 === 0){ toast(`Lese Dateien … ${seen} verarbeitet`, true); await new Promise(r => setTimeout(r, 0)); }
    const list = buildActivities(parseFit(buf));
    if (!list.length){ other++; return; }
    for (const a of list){
      const old = existing.get(a.id);
      if (old && old.src !== 'manual'){
        // älteres Format: durch die neue Auswertung ersetzen (GPS-Spur, Runden, Sätze); eigene Eingaben liegen getrennt in „annot“
        if ((old.v || 1) < SCHEMA){ await DB.put(a); state.acts[state.acts.indexOf(old)] = a; existing.set(a.id, a); upgraded++; }
        else dup++;
        continue;
      }
      existing.set(a.id, a); await DB.put(a); state.acts.push(a); added++;
    }
  }
  for (const f of files){
    try { if (/\.xml$/i.test(f.name)) await healthFromFile(f); else await handle(await f.arrayBuffer()); }
    catch(e){ if (e.message === 'zip'){ toast('ZIP-Dateien können gerade nicht gelesen werden. Entpacke die ZIP in der Dateien-App (antippen) und importiere die .fit-Datei.'); return; } failed++; }
  }
  let wr = null;
  if (hk.length){ wr = ingestWellness(state.W, hk); await DB.setMeta('wellness', state.W); }
  recompute(); render();
  const parts = [];
  if (added || dup || upgraded || !hkSeen) parts.push(`${added} Aktivitäten neu importiert`);
  if (hkSeen) parts.push(wr && (wr.rhr || wr.nights) ? `Tageswerte: ${wr.rhr} Ruhepuls-Werte, ${wr.nights} Nächte` : 'keine Ruhepuls- oder Schlafdaten im Export gefunden');
  if (upgraded) parts.push(`${upgraded} mit Karte, Runden und Sätzen ergänzt`);
  if (dup) parts.push(`${dup} schon vorhanden`);
  if (failed) parts.push(`${failed} nicht lesbar`);
  if (added === 0 && !dup && other && !hkSeen) parts.push('keine Aktivitäten gefunden');
  toast(parts.join(', '));
}

/* ---------- Grundgerüst ---------- */
const TABS = ['heute','laeufe','plan','zonen','trends'];
function render(){
  const v = $('#view');
  if (!state.acts.length && state.tab !== 'laeufe') v.innerHTML = emptyView();
  else v.innerHTML = ({heute:viewHeute, laeufe:viewLaeufe, plan:viewPlan, zonen:viewZonen, trends:viewTrends})[state.tab]();
  v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  const tabs = $('#tabs'); if (tabs) tabs.style.setProperty('--tab', Math.max(0, TABS.indexOf(state.tab)));
  Charts.mount(v);
}
function mountMaps(root){
  for (const el of root.querySelectorAll('[data-map]')){
    const a = state.acts.find(x => x.id === el.dataset.map); if (!a || el._map) continue; el._map = true;
    RouteMap.mount(el, a, {tiles: !!state.S.mapTiles, bounds: hrBounds(state.P.lthr), full: el.classList.contains('map-full')});
  }
}
function openSheet(html){ const s = $('#sheet'); s.innerHTML = html; s.classList.add('open'); s.scrollTop = 0; document.body.style.overflow = 'hidden'; Charts.mount(s); mountMaps(s); }
function closeSheet(){ const s = $('#sheet'); s.classList.remove('open'); s.innerHTML = ''; document.body.style.overflow = ''; RouteMap.cleanup(); }
function openZoom(html){ const z = $('#zoom'); z.innerHTML = html; z.classList.add('open'); Charts.mount(z); mountMaps(z); }
function closeZoom(){ const z = $('#zoom'); if (!z.classList.contains('open')) return false; Charts.closeFull(); RouteMap.cleanup(); return true; }
let tt;
function toast(msg, sticky){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); if (!sticky) tt = setTimeout(() => t.classList.remove('show'), 4200); }
async function saveAnnot(){ try { await DB.setMeta('annot', state.annot); } catch(e){} }

// Karte folgt dem Wischen in den Diagrammen einer Aktivität
Charts.onScrub((group, xv) => { if (String(group).startsWith('act:')) RouteMap.mark(String(group).slice(4).replace(/-full$/, ''), xv); });

// dezenter Tipp-Effekt
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('.btn, .item, .seg button, #tabs button, .chips-pick button, .icon-btn');
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect(), d = Math.max(r.width, r.height) * 1.2, sp = document.createElement('span');
  sp.className = 'ripple'; sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d/2}px;top:${e.clientY - r.top - d/2}px`;
  el.appendChild(sp); setTimeout(() => sp.remove(), 500);
}, {passive: true});

document.addEventListener('click', async e => {
  const tab = e.target.closest('#tabs button');
  if (tab){ state.tab = tab.dataset.tab; render(); window.scrollTo(0,0); return; }
  const act = e.target.closest('[data-act]'); if (act){ openAct(act.dataset.act); return; }
  const ex = e.target.closest('[data-ex]'); if (ex){ openExercise(ex.dataset.ex); return; }
  const fb = e.target.closest('[data-filter] button'); if (fb){ state.filter = fb.dataset.val; state.showAll = false; render(); return; }
  const rp = e.target.closest('[data-rpe] button');
  if (rp){ const id = rp.parentNode.dataset.rpe, v = +rp.dataset.val, cur = state.annot[id] && state.annot[id].rpe;
    if (cur === v){ if (state.annot[id]) delete state.annot[id].rpe; } else state.annot[id] = {...(state.annot[id] || {}), rpe: v};
    rp.parentNode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', cur !== v && b === rp));
    await saveAnnot(); recompute(); render(); toast(cur === v ? 'Anstrengung entfernt' : `Anstrengung ${v} gespeichert`); return; }
  const chip = e.target.closest('[data-chips] button');
  if (chip){ const name = chip.parentNode.dataset.chips, v = +chip.dataset.val, arr = (state.S[name] || []).map(Number);
    state.S[name] = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v].sort((x,y) => x-y);
    chip.setAttribute('aria-pressed', state.S[name].includes(v)); return; }
  const segb = e.target.closest('[data-seg] button');
  if (segb){ const box = segb.parentNode, name = box.dataset.seg; let v = segb.dataset.val;
    box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === segb));
    if (box.hasAttribute('data-local')) return;
    if (name === 'runsPerWeek' || name === 'strengthPerWeek') v = +v; else if (name === 'mapTiles') v = v === '1';
    state.S[name] = v; return; }
  if (e.target.closest('.map-open')){ const el = e.target.closest('[data-map]'), a = state.acts.find(x => x.id === el.dataset.map);
    if (a) openZoom(`<div class="zoom-bar"><h2>${esc(a.name)} · Strecke</h2><button class="icon-btn" data-zoom-close aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="zoom-body">${RouteMap.html(a, true)}</div>`);
    return; }
  if (e.target.closest('[data-zoom-close]')){ closeZoom(); return; }
  // Krafttraining-Formular
  if (e.target.closest('.ex-add')){ const b = e.target.closest('.exblock'), rows = b.querySelectorAll('.setrow'), last = rows[rows.length-1];
    b.querySelector('.ex-sets').insertAdjacentHTML('beforeend', setRow(last ? last.querySelector('.s-reps').value : '', last ? last.querySelector('.s-kg').value : '')); return; }
  if (e.target.closest('.s-del')){ const r = e.target.closest('.setrow'); if (r.parentNode.children.length > 1) r.remove(); return; }
  if (e.target.closest('.ex-del')){ const b = e.target.closest('.exblock'); if (document.querySelectorAll('#exlist .exblock').length > 1) b.remove(); return; }
  const a = e.target.closest('[data-action]'); if (!a) return;
  const k = a.dataset.action;
  if (k === 'import') $('#fileIn').click();
  else if (k === 'close') closeSheet();
  else if (k === 'settings') openSettings();
  else if (k === 'wellness') openWellness();
  else if (k === 'tab'){ state.tab = a.dataset.tab; render(); window.scrollTo(0,0); }
  else if (k === 'addstrength') openStrengthForm();
  else if (k === 'addex'){ const list = $('#exlist'), cats = [...list.querySelectorAll('.ex-cat')].map(x => +x.value), next = EX_PICK.find(c => !cats.includes(c)); list.insertAdjacentHTML('beforeend', exBlock(next != null ? next : EX_PICK[0])); }
  else if (k === 'savestrength') saveStrength();
  else if (k === 'wapply'){ const t = $('#wtext').value; if (!t.trim()) return toast('Das Feld ist leer. Erst den Kurzbefehl ausführen, dann einfügen.'); const r = await applyWellness(parseShortcutText(t)); if (r.rhr || r.nights){ closeSheet(); toast(`Übernommen: ${r.rhr} Ruhepuls-Werte, ${r.nights} Nächte`); } }
  else if (k === 'wclip'){ try { const t = await navigator.clipboard.readText(); $('#wtext').value = t; if (t.trim()){ const r = await applyWellness(parseShortcutText(t)); if (r.rhr || r.nights){ closeSheet(); toast(`Übernommen: ${r.rhr} Ruhepuls-Werte, ${r.nights} Nächte`); } } else toast('Die Zwischenablage ist leer.'); } catch(err){ toast('Kein Zugriff auf die Zwischenablage. Tippe lange ins Feld und wähle „Einfügen“.'); } }
  else if (k === 'clearwell'){ if (!confirm('Alle Ruhepuls- und Schlafdaten löschen?')) return; state.W = newWellness(); await DB.setMeta('wellness', state.W); recompute(); closeSheet(); render(); toast('Tageswerte gelöscht'); }
  else if (k === 'save') saveSettings();
  else if (k === 'showall'){ state.showAll = true; render(); }
  else if (k === 'delact'){ if (!confirm('Diese Aktivität löschen?')) return; await DB.del(a.dataset.id); state.acts = state.acts.filter(x => x.id !== a.dataset.id); if (state.annot[a.dataset.id]){ delete state.annot[a.dataset.id]; await saveAnnot(); } recompute(); closeSheet(); render(); toast('Aktivität gelöscht'); }
  else if (k === 'clearall'){ if (!confirm('Wirklich alle importierten Aktivitäten löschen? Einstellungen bleiben erhalten.')) return; await DB.clear(); state.acts = []; recompute(); closeSheet(); render(); toast('Alle Aktivitäten gelöscht'); }
});
$('#importBtn').addEventListener('click', () => $('#fileIn').click());
$('#settingsBtn').addEventListener('click', openSettings);
$('#fileIn').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importFiles(f); });
document.addEventListener('keydown', e => { if (e.key === 'Escape'){ if (!closeZoom()) closeSheet(); } });
// App-Gefühl: kein Seiten-Zoom per Doppeltipp oder zwei Fingern (Diagramme und Karte zoomen selbst)
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => { if (!e.target.closest || !e.target.closest('.leaflet-container')) e.preventDefault(); }, {passive: false}));
document.addEventListener('dblclick', e => { if (!e.target.closest('.leaflet-container, input, textarea')) e.preventDefault(); }, {passive: false});

(async function init(){
  await DB.open();
  const s = await DB.getMeta('settings'); if (s) Object.assign(state.S, s);
  const w = await DB.getMeta('wellness'); if (w && w.rhr && w.sleep) state.W = w;
  const an = await DB.getMeta('annot'); if (an && typeof an === 'object') state.annot = an;
  state.acts = (await DB.all()) || [];
  recompute(); render();
  // Offline-Start: Hintergrundhelfer anmelden (nur über http/https, nicht beim Öffnen als lokale Datei)
  try { if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch(e){}
})();
})();
