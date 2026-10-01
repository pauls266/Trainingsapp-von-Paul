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
const state = { acts:[], S:{goal:'m', runsPerWeek:4, sleepTarget:'7.5'}, tab:'heute', P:null, der:{}, vd:null, paces:null, series:[], plan:null, W:newWellness(), rec:null };

function recompute(){
  const {acts, S} = state;
  acts.sort((a,b) => b.start - a.start);
  state.P = estimateParams(acts, S);
  state.der = {}; for (const a of acts) state.der[a.id] = derive(a, state.P);
  state.vd = estimateVdot(acts, S);
  state.paces = state.vd ? trainingPaces(state.vd.vdot) : null;
  state.series = loadSeries(acts, state.der);
  state.rec = recovery(state.W, state.series, S);
  state.plan = buildPlan({S, acts, der:state.der, P:state.P, paces:state.paces, series:state.series, vd:state.vd, rec:state.rec, W:state.W});
}

/* ---------- Diagramme (SVG) ---------- */
function lineSVG(sets, o = {}){
  const W = 320, H = o.h || 120, pad = 6;
  const all = sets.flatMap(s => s.v).filter(x => x != null && isFinite(x));
  if (!all.length) return '<p class="muted small">Noch keine Daten.</p>';
  let mn = o.min != null ? o.min : Math.min(...all), mx = o.max != null ? o.max : Math.max(...all);
  if (mx === mn){ mx += 1; mn -= 1; }
  const n = Math.max(...sets.map(s => s.v.length));
  const X = i => n <= 1 ? W/2 : (i/(n-1))*W;
  const Y = v => { const f = (v-mn)/(mx-mn); return pad + (H-2*pad)*(o.invert ? f : 1-f); };
  let g = '';
  if (o.bands) for (const b of o.bands){ const y1 = Y(Math.min(b.to, mx)), y2 = Y(Math.max(b.from, mn)); if (b.to > mn && b.from < mx) g += `<rect x="0" y="${Math.min(y1,y2)}" width="${W}" height="${Math.abs(y2-y1)}" fill="${b.c}" opacity=".13"/>`; }
  if (o.zero && mn < 0 && mx > 0) g += `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  for (const s of sets){
    if (s.bars){ const bw = W/n*0.7; s.v.forEach((v,i) => { if (v == null) return; const y0 = Y(Math.max(mn,0)), y = Y(v); g += `<rect x="${X(i)-bw/2}" y="${Math.min(y,y0)}" width="${bw}" height="${Math.abs(y0-y)}" fill="${s.c}" opacity="${s.op||.5}"/>`; }); continue; }
    if (s.dots){ s.v.forEach((v,i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="2.6" fill="${s.c}"/>`; }); continue; }
    let d = '', pen = false;
    s.v.forEach((v,i) => { if (v == null || !isFinite(v)){ pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
    g += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${s.w||2}" ${s.dash?'stroke-dasharray="4 3"':''} vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="img" aria-label="${esc(o.label||'Diagramm')}">${g}</svg>`;
}
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
  const {plan, series, acts, vd, der} = state;
  const t = plan.today, now = new Date();
  const kmTxt = t.km ? `<div class="kmnum">${num(t.km, t.km % 1 ? 1 : 0)}<small>km</small></div>` : `<div class="kmnum">–</div>`;
  let h = `<div class="bib"><span class="pin"></span><span class="pin"></span><span class="pin"></span><span class="pin"></span>
    <div class="date">Heute, ${now.toLocaleDateString('de-DE',{weekday:'long', day:'numeric', month:'long'})}</div>
    <div class="row">${kmTxt}<div class="title">${esc(t.title)}</div></div>
    ${t.tempo ? `<div class="tempo">${esc(t.tempo)}</div>` : ''}
    <div class="detail">${esc(t.detail)}</div></div>`;

  h += recoveryPanel();
  const c = series[series.length-1] || {ctl:0, atl:0, tsb:0}, fs = formState();
  const last = series.slice(-42);
  h += `<h2>Form</h2><div class="stats">
    <div><div class="v">${num(c.ctl)}</div><div class="l">Fitness</div></div>
    <div><div class="v">${num(c.atl)}</div><div class="l">Ermüdung</div></div>
    <div><div class="v">${c.tsb > 0 ? '+' : ''}${num(c.tsb)}</div><div class="l">Form</div></div></div>
    <div class="panel" style="margin-top:10px"><span class="state">${fs.label}</span><p class="small muted" style="margin:8px 0 10px">${fs.text}</p>
    <div class="legend"><span><b style="background:var(--data)"></b>Fitness</span><span><b style="background:var(--hr)"></b>Ermüdung</span></div>
    ${lineSVG([{v:last.map(x=>x.ctl), c:'var(--data)', w:2.4},{v:last.map(x=>x.atl), c:'var(--hr)', w:1.6}], {h:90, min:0, label:'Fitness und Ermüdung der letzten 6 Wochen'})}
    <div class="axis"><span>vor 6 Wochen</span><span>heute</span></div></div>`;

  if (vd){
    const hm = predictTime(21097.5, vd.vdot), m = predictTime(42195, vd.vdot);
    h += `<h2>Aktuelle Prognose</h2><div class="stats" style="grid-template-columns:repeat(3,1fr)">
      <div><div class="v">${num(vd.vdot,1)}</div><div class="l">VDOT</div></div>
      <div><div class="v">${fmtDur(hm)}</div><div class="l">Halbmarathon</div></div>
      <div><div class="v">${fmtDur(m)}</div><div class="l">Marathon</div></div></div>
      <p class="small muted" style="margin-top:6px">Grundlage: ${esc(vd.src)}.${vd.fromTraining ? ' Aus Trainingsdaten geschätzt – mit einem echten Wettkampfergebnis in den Einstellungen wird es genauer.' : ''}${state.S.goal === 'm' ? ' Die Marathonprognose setzt ausreichend lange Läufe voraus.' : ''}</p>`;
    if (plan.goalCheck) h += `<div class="panel"><b>Dein Ziel ${fmtDur(parseGoalTime(state.S.targetTime))}</b> (${fmtPace(plan.goalCheck.pace)}/km)<p class="small" style="margin:4px 0 0">${esc(plan.goalCheck.verdict)}</p></div>`;
  }

  const lastRun = acts.find(a => a.isRun);
  if (lastRun){ h += `<h2>Letzter Lauf</h2><div class="list">${actItem(lastRun)}</div>`; }
  if (plan.notes.length) h += `<h2>Hinweise</h2><ul class="notes">${plan.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
  h += privacyNote();
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
  const d = state.der[a.id] || {zs:[0,0,0,0,0]};
  const pace = a.isRun && a.avgSpd > 0 ? fmtPace(1000/a.avgSpd)+'/km' : '';
  return `<button class="item" data-act="${esc(a.id)}"><div class="main">
    <div class="t1">${esc(a.name)}</div>
    <div class="t2">${fmtDate(a.start,true)} · ${fmtDur(a.timer)}${pace ? ' · '+pace : ''}${a.avgHR ? ' · Ø '+a.avgHR+' bpm' : ''}</div>
    ${zbarHTML(d.zs)}</div>
    <div class="big">${a.dist > 0 ? fmtKm(a.dist)+'<span class="small muted"> km</span>' : ''}</div></button>`;
}

function viewLaeufe(){
  if (!state.acts.length) return emptyView();
  let h = '', cur = '';
  const show = state.acts.slice(0, state.showAll ? undefined : 150);
  for (const a of show){
    const m = new Date(a.start).toLocaleDateString('de-DE', {month:'long', year:'numeric'});
    if (m !== cur){ if (cur) h += '</div>'; cur = m; h += `<div class="month">${m}</div><div class="list">`; }
    h += actItem(a);
  }
  h += '</div>';
  if (!state.showAll && state.acts.length > 150) h += `<p style="margin-top:14px"><button class="btn ghost" data-action="showall">Alle ${state.acts.length} anzeigen</button></p>`;
  return h;
}

function viewPlan(){
  const p = state.plan;
  const TC = {Q:'var(--z4)', L:'var(--ink)', E:'var(--z2)', R:'var(--line)', W:'var(--z5)'};
  const total = p.sessions.reduce((s,x) => s + x.km, 0);
  let h = `<h2 style="margin-top:8px">Diese Woche: ${esc(p.phase)}${p.recovery ? ' (Entlastung)' : ''}</h2>
    <p class="muted small">${p.wtr !== null ? (p.wtr === 0 ? 'Wettkampfwoche. ' : `Noch ${p.wtr} Woche${p.wtr===1?'':'n'} bis zum ${p.goal==='m'?'Marathon':'Halbmarathon'}. `) : 'Kein Wettkampfdatum eingetragen – der Plan baut Grundlage auf. '}Rund ${num(total)} km geplant, Schnitt der letzten 4 Wochen ${num(p.vol4)} km.</p>
    <div class="list week">`;
  for (const s of p.sessions){
    h += `<div class="item${s.day === p.tIdx ? ' today' : ''}"><div class="wd">${WD[s.day]}</div><div class="main">
      <div class="t1"><span class="tag" style="background:${TC[s.type]||'var(--line)'}"></span>${esc(s.title)}${s.km ? ` · ${num(s.km, s.km % 1 ? 1 : 0)} km` : ''}</div>
      ${s.tempo ? `<div class="t2" style="color:var(--ink);font-weight:500">${esc(s.tempo)}</div>` : ''}
      <div class="t2">${esc(s.detail)}</div></div></div>`;
  }
  h += `</div>`;
  if (p.notes.length) h += `<h2>Warum so?</h2><ul class="notes">${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
  h += `<p class="small muted">Der Plan wird bei jedem Import neu berechnet – aus deinem Umfang, deiner Form, deiner Zonenverteilung und deinem Wettkampfdatum. Trainingstage und Ziel änderst du in den Einstellungen.</p>
    <button class="btn ghost" data-action="settings">Ziel & Trainingstage ändern</button>`;
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
  const wk = weeklyKm(acts, 12);
  let h = `<h2 style="margin-top:8px">Wochenumfang</h2><div class="panel">
    ${lineSVG([{v:wk.map(w=>w.km), c:'var(--data)', bars:true, op:.85}], {h:110, min:0, label:'Laufkilometer pro Woche'})}
    <div class="axis"><span>vor 12 Wochen</span><span>max. ${num(Math.max(...wk.map(w=>w.km)))} km</span><span>diese Woche ${num(wk[wk.length-1].km)} km</span></div></div>`;

  const s90 = series.slice(-90);
  h += `<h2>Fitness, Ermüdung, Form</h2><div class="panel">
    <div class="legend"><span><b style="background:var(--data)"></b>Fitness (42 Tage)</span><span><b style="background:var(--hr)"></b>Ermüdung (7 Tage)</span><span><b style="background:var(--z3)"></b>Form</span></div>
    ${lineSVG([{v:s90.map(x=>x.tsb), c:'var(--z3)', bars:true, op:.45},{v:s90.map(x=>x.ctl), c:'var(--data)', w:2.4},{v:s90.map(x=>x.atl), c:'var(--hr)', w:1.5}], {h:150, zero:true, label:'Belastungsverlauf 90 Tage'})}
    <div class="axis"><span>vor 90 Tagen</span><span>heute</span></div>
    <p class="small muted" style="margin:8px 0 0">Basis ist der Banister-TRIMP aus deiner Herzfrequenz – also deine innere Belastung, nicht nur Kilometer.</p></div>`;

  const now = Date.now();
  const efp = acts.filter(a => der[a.id] && der[a.id].ef && now - a.start < 180*864e5).sort((a,b) => a.start-b.start);
  h += `<h2>Effizienz bei lockeren Läufen</h2><div class="panel">`;
  if (efp.length >= 3){
    const ys = efp.map(a => der[a.id].ef), n = ys.length, xs = ys.map((_,i)=>i);
    const mx = xs.reduce((a,c)=>a+c,0)/n, my = ys.reduce((a,c)=>a+c,0)/n;
    const sl = xs.reduce((a,x,i)=>a+(x-mx)*(ys[i]-my),0) / (xs.reduce((a,x)=>a+(x-mx)**2,0) || 1);
    const fit = xs.map(x => my + sl*(x-mx)), chg = (fit[n-1]-fit[0])/fit[0]*100;
    h += lineSVG([{v:ys, c:'var(--data)', dots:true},{v:fit, c:'var(--ink)', w:1.4, dash:true}], {h:110, label:'Effizienzfaktor'}) +
      `<div class="axis"><span>${fmtDate(efp[0].start)}</span><span>${fmtDate(efp[n-1].start)}</span></div>
      <p class="small" style="margin:8px 0 0">Meter pro Minute je Herzschlag. Trend: <b>${chg >= 0 ? '+' : ''}${num(chg,1)} %</b> – ${chg > 1 ? 'du läufst bei gleichem Puls schneller, die aerobe Basis wächst.' : chg < -1 ? 'leicht rückläufig. Ermüdung, Hitze oder Krankheit können das erklären.' : 'stabil.'}</p>`;
  } else h += `<p class="small muted" style="margin:0">Braucht mindestens drei lockere Läufe ab 20 Minuten mit Herzfrequenz.</p>`;
  h += `</div>`;

  const z = [0,0,0,0,0]; for (const a of acts) if (now - a.start < 28*864e5 && der[a.id]) der[a.id].zs.forEach((v,i)=>z[i]+=v);
  const zt = z.reduce((a,c)=>a+c,0);
  h += `<h2>Zonenverteilung (4 Wochen)</h2><div class="panel">`;
  if (zt){
    h += `<div class="zbar" style="height:16px;border-radius:5px;margin:2px 0 10px">${z.map((v,i)=> v ? `<i style="width:${v/zt*100}%;background:${ZC[i]}"></i>` : '').join('')}</div>` +
      z.map((v,i) => `<div style="display:flex;justify-content:space-between;font-size:14.5px;padding:3px 0"><span><span class="tag" style="background:${ZC[i]}"></span>Z${i+1} ${ZN[i]}</span><span>${fmtDur(v).replace(/:\d\d$/, '')} h · ${num(v/zt*100)} %</span></div>`).join('');
  } else h += `<p class="small muted" style="margin:0">Keine Herzfrequenzdaten in den letzten 4 Wochen.</p>`;
  h += `</div>`;

  const W = state.W;
  if (Object.keys(W.rhr).length || Object.keys(W.sleep).length){
    const days = []; for (let i=89;i>=0;i--) days.push(dayKey(now - i*864e5));
    const rv = days.map(d => rhrOf(W, d)), bv = days.map(d => rhrBaseline(W, d));
    const have = rv.filter(x => x != null);
    if (have.length >= 3){
      const f7 = have.slice(-7), f28 = rv.slice(-35, -7).filter(x=>x!=null);
      const a7 = f7.reduce((a,c)=>a+c,0)/f7.length, a28 = f28.length ? f28.reduce((a,c)=>a+c,0)/f28.length : null;
      h += `<h2>Ruhepuls (90 Tage)</h2><div class="panel"><div class="legend"><span><b style="background:var(--hr)"></b>Ruhepuls</span><span><b style="background:var(--muted)"></b>4-Wochen-Schnitt</span></div>
        ${lineSVG([{v:bv, c:'var(--muted)', w:1.3, dash:true},{v:rv, c:'var(--hr)', w:1.8}], {h:110, min:Math.min(...have)-3, max:Math.max(...have)+3, label:'Ruhepuls'})}
        <div class="axis"><span>vor 90 Tagen</span><span>heute</span></div>
        <p class="small" style="margin:8px 0 0">Letzte 7 Tage Ø <b>${num(a7,1)} bpm</b>${a28 !== null ? `, davor ${num(a28,1)} bpm. ${a7 < a28 - 1 ? 'Sinkender Ruhepuls ist meist ein Zeichen wachsender Fitness oder guter Erholung.' : a7 > a28 + 2 ? 'Der Ruhepuls steigt – Belastung, Schlaf und Stress im Blick behalten.' : 'Stabil.'}` : '.'}</p></div>`;
    }
    const sd = []; for (let i=29;i>=0;i--) sd.push(dayKey(now - i*864e5));
    const sls = sd.map(d => sleepOf(W, d)), tgt = (parseFloat(String(state.S.sleepTarget||'7.5').replace(',','.')) || 7.5);
    const valid = sls.filter(Boolean);
    if (valid.length >= 3){
      const avg = arr => arr.reduce((a,c)=>a+c,0)/arr.length;
      const l7 = sls.slice(-7).filter(Boolean), st = valid.filter(x => x.stages);
      h += `<h2>Schlaf (30 Nächte)</h2><div class="panel"><div class="legend"><span><b style="background:var(--data)"></b>Schlafdauer</span><span><b style="background:var(--z3)"></b>Ziel ${num(tgt,1)} h</span></div>
        ${lineSVG([{v:sls.map(x => x ? x.tot/60 : null), c:'var(--data)', bars:true, op:.75},{v:sd.map(()=>tgt), c:'var(--z3)', w:1.4, dash:true}], {h:110, min:0, max:Math.max(tgt+1, ...valid.map(x=>x.tot/60)), label:'Schlafdauer'})}
        <div class="axis"><span>vor 30 Tagen</span><span>letzte Nacht</span></div>
        <p class="small" style="margin:8px 0 0">Ø letzte 7 Nächte <b>${l7.length ? fmtHM(avg(l7.map(x=>x.tot))) : '–'}</b>, Ø 30 Nächte ${fmtHM(avg(valid.map(x=>x.tot)))}.${st.length ? ` Tiefschlaf im Schnitt ${num(avg(st.map(x=>x.deep/x.tot*100)))} %, REM ${num(avg(st.map(x=>x.rem/x.tot*100)))} %.` : ''}</p></div>`;
    }
  }

  const cadp = acts.filter(a => a.isRun && a.cad && now - a.start < 180*864e5).sort((a,b)=>a.start-b.start);
  if (cadp.length >= 3){
    h += `<h2>Schrittfrequenz</h2><div class="panel">${lineSVG([{v:cadp.map(a=>a.cad), c:'var(--z3)', dots:true}], {h:90, label:'Schrittfrequenz'})}
      <div class="axis"><span>${fmtDate(cadp[0].start)}</span><span>Ø ${num(cadp.reduce((s,a)=>s+a.cad,0)/cadp.length)} Schritte/min</span><span>${fmtDate(cadp[cadp.length-1].start)}</span></div></div>`;
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
function openAct(id){
  const a = state.acts.find(x => x.id === id); if (!a) return;
  const d = state.der[id], st = a.stream, b = hrBounds(state.P.lthr);
  const every = Math.max(1, Math.ceil(st.t.length / 400));
  const idx = st.t.map((_,i)=>i).filter(i => i % every === 0);
  const sm = i => { let s=0,n=0; for (let k=Math.max(0,i-6); k<=Math.min(st.v.length-1,i+6); k++){ if (st.v[k] > 0){ s+=st.v[k]; n++; } } return n ? s/n : 0; };
  const hr = idx.map(i => st.hr[i] > 0 ? st.hr[i] : null);
  const pace = idx.map(i => { const v = sm(i); return v > 1.3 ? 1000/v : null; });
  const hasHR = hr.some(x=>x), hasPace = a.isRun && pace.some(x=>x);
  const pv = pace.filter(x=>x).sort((x,y)=>x-y);
  let h = `<div class="bar"><h2>${esc(a.name)}</h2><button class="icon-btn" data-action="close" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="wrap">
    <p class="muted" style="margin-top:0">${fmtDate(a.start,true)}, ${new Date(a.start).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} Uhr</p>
    <div class="stats">
      <div><div class="v">${fmtKm(a.dist,2)}</div><div class="l">km</div></div>
      <div><div class="v">${fmtDur(a.timer)}</div><div class="l">Zeit</div></div>
      <div><div class="v">${a.isRun && a.avgSpd ? fmtPace(1000/a.avgSpd) : '–'}</div><div class="l">Ø Pace /km</div></div>
      <div><div class="v">${a.avgHR || '–'}</div><div class="l">Ø HF</div></div>
      <div><div class="v">${a.maxHR || '–'}</div><div class="l">max. HF</div></div>
      <div><div class="v">${num(d.trimp)}</div><div class="l">Belastung${d.hrEst?' (geschätzt)':''}</div></div>
    </div>`;
  if (hasHR) h += `<h3>Herzfrequenz</h3><div class="panel">${lineSVG([{v:hr, c:'var(--hr)', w:1.6}], {h:120, min: Math.max(60, Math.min(...hr.filter(x=>x)) - 5), max: Math.max(...hr.filter(x=>x)) + 3, bands: [0,1,2,3,4].map(i => ({from: i ? b[i-1] : 0, to: i < 4 ? b[i] : 250, c: ZC[i]})), label:'Herzfrequenzverlauf'})}<div class="axis"><span>0:00</span><span>${fmtDur(st.t[st.t.length-1]||0)}</span></div></div>`;
  if (hasPace) h += `<h3>Pace</h3><div class="panel">${lineSVG([{v:pace, c:'var(--pace)', w:1.6}], {h:110, invert:true, min: pv[Math.floor(pv.length*0.02)] - 10, max: pv[Math.floor(pv.length*0.98)] + 15, label:'Paceverlauf'})}<div class="axis"><span>schneller oben</span><span>${fmtPace(pv[Math.floor(pv.length*0.02)])} – ${fmtPace(pv[Math.floor(pv.length*0.98)])} /km</span></div></div>`;
  const zt = d.zs.reduce((x,y)=>x+y,0);
  if (zt) h += `<h3>Zeit in Zonen</h3><div class="panel">${d.zs.map((v,i) => `<div style="display:flex;align-items:center;gap:10px;padding:3px 0;font-size:14.5px"><span style="width:28px;font-weight:600">Z${i+1}</span><span style="flex:1;height:10px;background:var(--bg);border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:${v/zt*100}%;background:${ZC[i]}"></span></span><span style="width:74px;text-align:right">${fmtDur(v)}</span></div>`).join('')}</div>`;
  const rows = [];
  if (d.dec !== null) rows.push(['Aerobe Entkopplung', num(d.dec,1)+' %', d.dec < 5 ? 'Unter 5 %: Puls bleibt stabil, gute Ausdauer für dieses Tempo.' : 'Über 5 %: Der Puls driftet in der zweiten Hälfte nach oben.']);
  if (d.ef) rows.push(['Effizienzfaktor', num(d.ef,2), 'Meter pro Minute je Herzschlag – im Verlauf vergleichen.']);
  if (a.te != null) rows.push(['Training Effect (Garmin)', num(a.te,1)+(a.ane != null ? ' / '+num(a.ane,1)+' anaerob' : ''), '']);
  if (a.cad) rows.push(['Schrittfrequenz', a.cad+' /min', '']);
  if (a.gct) rows.push(['Bodenkontaktzeit', a.gct+' ms', '']);
  if (a.vo) rows.push(['Vertikale Bewegung', num(a.vo,1)+' cm', '']);
  if (a.ascent != null) rows.push(['Anstieg', a.ascent+' m', '']);
  if (a.kcal != null) rows.push(['Kalorien', a.kcal+' kcal', '']);
  if (rows.length) h += `<h3>Kennzahlen</h3><div class="list">${rows.map(r => `<div class="item"><div class="main"><div class="t1">${r[0]}</div>${r[2] ? `<div class="t2">${r[2]}</div>` : ''}</div><div class="big" style="font-size:20px">${r[1]}</div></div>`).join('')}</div>`;
  const bd = Object.keys(a.bestD).sort((x,y)=>x-y);
  if (bd.length) h += `<h3>Schnellste Abschnitte</h3><div class="list">${bd.map(k => `<div class="item"><div class="main"><div class="t1">${({1000:'1 km',5000:'5 km',10000:'10 km',21097.5:'Halbmarathon',42195:'Marathon'})[k]}</div></div><div class="big" style="font-size:20px">${fmtDur(a.bestD[k])}</div></div>`).join('')}</div>`;
  h += `<p style="margin-top:22px"><button class="btn danger" data-action="delact" data-id="${esc(a.id)}">Aktivität löschen</button></p></div>`;
  openSheet(h);
}

/* ---------- Einstellungen ---------- */
function openSettings(){
  const S = state.S, P = state.P;
  const seg = (name, opts, label) => `<div class="seg" data-seg="${name}" role="group" aria-label="${label}">${opts.map(o => `<button type="button" data-val="${o[0]}" aria-pressed="${String(S[name]) === String(o[0])}">${o[1]}</button>`).join('')}</div>`;
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
  S.raceDist = g('raceDist'); S.sleepTarget = sl;
  try { await DB.setMeta('settings', JSON.parse(JSON.stringify(S))); } catch(e){}
  recompute(); closeSheet(); render(); toast('Gespeichert');
}

async function importFiles(files){
  const existing = new Set(state.acts.map(a => a.id));
  let added = 0, dup = 0, other = 0, failed = 0, seen = 0;
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
    const a = buildActivity(parseFit(buf));
    if (!a){ other++; return; }
    if (existing.has(a.id)){ dup++; return; }
    existing.add(a.id); await DB.put(a); state.acts.push(a); added++;
  }
  for (const f of files){
    try { if (/\.xml$/i.test(f.name)) await healthFromFile(f); else await handle(await f.arrayBuffer()); }
    catch(e){ if (e.message === 'zip'){ toast('ZIP-Dateien können gerade nicht gelesen werden. Entpacke die ZIP in der Dateien-App (antippen) und importiere die .fit-Datei.'); return; } failed++; }
  }
  let wr = null;
  if (hk.length){ wr = ingestWellness(state.W, hk); await DB.setMeta('wellness', state.W); }
  recompute(); render();
  const parts = [];
  if (added || dup || !hkSeen) parts.push(`${added} Aktivitäten neu importiert`);
  if (hkSeen) parts.push(wr && (wr.rhr || wr.nights) ? `Tageswerte: ${wr.rhr} Ruhepuls-Werte, ${wr.nights} Nächte` : 'keine Ruhepuls- oder Schlafdaten im Export gefunden');
  if (dup) parts.push(`${dup} schon vorhanden`);
  if (failed) parts.push(`${failed} nicht lesbar`);
  if (added === 0 && !dup && other && !hkSeen) parts.push('keine Aktivitäten gefunden');
  toast(parts.join(', '));
}

/* ---------- Grundgerüst ---------- */
function render(){
  const v = $('#view');
  if (!state.acts.length && state.tab !== 'laeufe') v.innerHTML = emptyView();
  else v.innerHTML = ({heute:viewHeute, laeufe:viewLaeufe, plan:viewPlan, zonen:viewZonen, trends:viewTrends})[state.tab]();
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
}
function openSheet(html){ const s = $('#sheet'); s.innerHTML = html; s.classList.add('open'); s.scrollTop = 0; document.body.style.overflow = 'hidden'; }
function closeSheet(){ const s = $('#sheet'); s.classList.remove('open'); s.innerHTML = ''; document.body.style.overflow = ''; }
let tt;
function toast(msg, sticky){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); if (!sticky) tt = setTimeout(() => t.classList.remove('show'), 4200); }

document.addEventListener('click', async e => {
  const tab = e.target.closest('#tabs button');
  if (tab){ state.tab = tab.dataset.tab; render(); window.scrollTo(0,0); return; }
  const act = e.target.closest('[data-act]'); if (act){ openAct(act.dataset.act); return; }
  const segb = e.target.closest('[data-seg] button');
  if (segb){ const name = segb.parentNode.dataset.seg; let v = segb.dataset.val; if (name === 'runsPerWeek') v = +v; state.S[name] = v;
    segb.parentNode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === segb)); return; }
  const a = e.target.closest('[data-action]'); if (!a) return;
  const k = a.dataset.action;
  if (k === 'import') $('#fileIn').click();
  else if (k === 'close') closeSheet();
  else if (k === 'settings') openSettings();
  else if (k === 'wellness') openWellness();
  else if (k === 'wapply'){ const t = $('#wtext').value; if (!t.trim()) return toast('Das Feld ist leer. Erst den Kurzbefehl ausführen, dann einfügen.'); const r = await applyWellness(parseShortcutText(t)); if (r.rhr || r.nights){ closeSheet(); toast(`Übernommen: ${r.rhr} Ruhepuls-Werte, ${r.nights} Nächte`); } }
  else if (k === 'wclip'){ try { const t = await navigator.clipboard.readText(); $('#wtext').value = t; if (t.trim()){ const r = await applyWellness(parseShortcutText(t)); if (r.rhr || r.nights){ closeSheet(); toast(`Übernommen: ${r.rhr} Ruhepuls-Werte, ${r.nights} Nächte`); } } else toast('Die Zwischenablage ist leer.'); } catch(err){ toast('Kein Zugriff auf die Zwischenablage. Tippe lange ins Feld und wähle „Einfügen“.'); } }
  else if (k === 'clearwell'){ if (!confirm('Alle Ruhepuls- und Schlafdaten löschen?')) return; state.W = newWellness(); await DB.setMeta('wellness', state.W); recompute(); closeSheet(); render(); toast('Tageswerte gelöscht'); }
  else if (k === 'save') saveSettings();
  else if (k === 'showall'){ state.showAll = true; render(); }
  else if (k === 'delact'){ if (!confirm('Diese Aktivität löschen?')) return; await DB.del(a.dataset.id); state.acts = state.acts.filter(x => x.id !== a.dataset.id); recompute(); closeSheet(); render(); toast('Aktivität gelöscht'); }
  else if (k === 'clearall'){ if (!confirm('Wirklich alle importierten Aktivitäten löschen? Einstellungen bleiben erhalten.')) return; await DB.clear(); state.acts = []; recompute(); closeSheet(); render(); toast('Alle Aktivitäten gelöscht'); }
});
$('#importBtn').addEventListener('click', () => $('#fileIn').click());
$('#settingsBtn').addEventListener('click', openSettings);
$('#fileIn').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importFiles(f); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

(async function init(){
  await DB.open();
  const s = await DB.getMeta('settings'); if (s) Object.assign(state.S, s);
  const w = await DB.getMeta('wellness'); if (w && w.rhr && w.sleep) state.W = w;
  state.acts = (await DB.all()) || [];
  recompute(); render();
  // Offline-Start: Hintergrundhelfer anmelden (nur über http/https, nicht beim Öffnen als lokale Datei)
  try { if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch(e){}
})();
})();
