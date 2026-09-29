/* ================= Analyse-Kern (läuft komplett lokal) ================= */
const APP_VERSION = '2.1.0';
const FIT_EPOCH_OFFSET = 631065600;
const BT = {0:[1,'u8',0xFF],1:[1,'s8',0x7F],2:[1,'u8',0xFF],3:[2,'s16',0x7FFF],4:[2,'u16',0xFFFF],5:[4,'s32',0x7FFFFFFF],6:[4,'u32',0xFFFFFFFF],7:[1,'str',null],8:[4,'f32',null],9:[8,'f64',null],10:[1,'u8',0],11:[2,'u16',0],12:[4,'u32',0],13:[1,'u8',0xFF],14:[8,'x',null],15:[8,'x',null],16:[8,'x',null]};
const GMSG = {0:'file_id',3:'user_profile',7:'zones_target',18:'session',19:'lap',20:'record'};
const DAY = 864e5;

function parseFit(buffer){
  const dv = new DataView(buffer);
  if (buffer.byteLength < 14) throw new Error('Datei zu klein');
  const hs = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8),dv.getUint8(9),dv.getUint8(10),dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('Keine FIT-Datei');
  const end = Math.min(hs + dv.getUint32(4,true), buffer.byteLength);
  const out = {file_id:[],user_profile:[],zones_target:[],session:[],lap:[],record:[]};
  const defs = {};
  let p = hs, lastTs = 0;
  const readVal = (t,le) => {
    switch(t){
      case 'u8': return dv.getUint8(p); case 's8': return dv.getInt8(p);
      case 'u16': return dv.getUint16(p,le); case 's16': return dv.getInt16(p,le);
      case 'u32': return dv.getUint32(p,le); case 's32': return dv.getInt32(p,le);
      case 'f32': return dv.getFloat32(p,le); case 'f64': return dv.getFloat64(p,le);
    } return null;
  };
  const readData = def => {
    const m = {};
    for (const f of def.fields){
      const b = BT[f.bt & 0x1F];
      if (b && f.size === b[0] && b[1] !== 'str' && b[1] !== 'x'){
        const v = readVal(b[1], def.le);
        if (!(b[2] !== null && v === b[2]) && !Number.isNaN(v)) m[f.num] = v;
      }
      p += f.size;
    }
    p += def.devSize;
    return m;
  };
  const store = (def,m) => { const n = GMSG[def.gnum]; if (n) out[n].push(m); };
  try {
    while (p < end){
      const h = dv.getUint8(p++);
      if (h & 0x80){
        const def = defs[(h >> 5) & 3]; if (!def) throw new Error('Defekte FIT-Datei');
        const off = h & 0x1F, low = lastTs % 32;
        let ts = lastTs - low + off; if (off < low) ts += 32;
        lastTs = ts;
        const m = readData(def); m[253] = ts; store(def,m);
      } else if (h & 0x40){
        const lt = h & 0x0F, hasDev = (h & 0x20) !== 0;
        p++;
        const le = dv.getUint8(p++) === 0;
        const gnum = dv.getUint16(p, le); p += 2;
        const nf = dv.getUint8(p++), fields = [];
        for (let i=0;i<nf;i++){ fields.push({num:dv.getUint8(p), size:dv.getUint8(p+1), bt:dv.getUint8(p+2)}); p += 3; }
        let devSize = 0;
        if (hasDev){ const nd = dv.getUint8(p++); for (let i=0;i<nd;i++){ devSize += dv.getUint8(p+1); p += 3; } }
        defs[lt] = {gnum, le, fields, devSize};
      } else {
        const def = defs[h & 0x0F]; if (!def) throw new Error('Defekte FIT-Datei');
        const m = readData(def);
        if (m[253] != null) lastTs = m[253];
        store(def,m);
      }
    }
  } catch(e){
    if (!(e instanceof RangeError) || !out.record.length) throw e; // abgeschnittene Datei: vorhandene Daten nutzen
  }
  return out;
}

const SPORTS = {0:'Sonstiges',1:'Laufen',2:'Radfahren',4:'Fitnessgerät',5:'Schwimmen',10:'Krafttraining',11:'Gehen',15:'Rudern',17:'Wandern',19:'Paddeln',21:'E-Bike',25:'Yoga'};
const SUBSPORTS_RUN = {1:'Laufband',2:'Straße',3:'Trail',4:'Bahn',45:'Virtuell',58:'Ultra'};

function bestByDistance(T, D, target){
  let best = Infinity, i = 0; const n = T.length;
  for (let j=0;j<n;j++){
    while (i < j-1 && D[j]-D[i+1] >= target) i++;
    const dd = D[j]-D[i];
    if (dd >= target){ const dt = (T[j]-T[i]) * target/dd; if (dt < best && target/dt < 6.7) best = dt; }
  }
  return best === Infinity ? null : Math.round(best);
}
function bestByTime(T, D, dur){
  let best = 0, i = 0; const n = T.length;
  for (let j=0;j<n;j++){
    while (i < j-1 && T[j]-T[i+1] >= dur) i++;
    const dt = T[j]-T[i];
    if (dt >= dur){ const d = (D[j]-D[i]) * dur/dt; if (d > best && d/dur < 6.7) best = d; }
  }
  return best > 0 ? Math.round(best) : null;
}

function buildActivity(fit){
  const recs = fit.record.filter(r => r[253] != null).sort((a,b)=>a[253]-b[253]);
  const s = fit.session[0] || {};
  if (!fit.session.length && recs.length < 10) return null;
  const startFit = s[2] != null ? s[2] : (recs[0] && recs[0][253]);
  if (startFit == null) return null;
  const sport = s[5] != null ? s[5] : 0, subSport = s[6] != null ? s[6] : 0, isRun = sport === 1;
  const n = recs.length;
  const T = new Float64Array(n), HR = new Float64Array(n), D = new Float64Array(n), V = new Float64Array(n), C = new Float64Array(n), A = new Float64Array(n);
  let gSum=0,gN=0,oSum=0,oN=0,lastD=0;
  for (let i=0;i<n;i++){
    const r = recs[i];
    T[i] = r[253]-startFit; HR[i] = r[3] || 0;
    D[i] = r[5] != null ? r[5]/100 : lastD; if (D[i] < lastD) D[i] = lastD; lastD = D[i];
    V[i] = r[73] != null ? r[73]/1000 : (r[6] != null ? r[6]/1000 : NaN);
    C[i] = r[4] != null ? (r[4] + (r[53]||0)/128) * (isRun?2:1) : 0;
    A[i] = r[78] != null ? r[78]/5-500 : (r[2] != null ? r[2]/5-500 : NaN);
    if (r[41] != null){ gSum += r[41]/10; gN++; }
    if (r[39] != null){ oSum += r[39]/10; oN++; }
  }
  for (let i=1;i<n;i++){ if (Number.isNaN(V[i])){ const dt = T[i]-T[i-1]; V[i] = dt > 0 ? (D[i]-D[i-1])/dt : 0; } }
  if (n && Number.isNaN(V[0])) V[0] = 0;

  // 5-Sekunden-Stream für Diagramme & zonenabhängige Werte
  const B = 5, bins = new Map();
  for (let i=0;i<n;i++){
    const k = Math.floor(T[i]/B);
    let b = bins.get(k);
    if (!b){ b = {h:0,hn:0,v:0,vn:0,c:0,cn:0,a:0,an:0,d:D[i]}; bins.set(k,b); }
    if (HR[i] > 0){ b.h += HR[i]; b.hn++; }
    if (V[i] >= 0 && V[i] < 12){ b.v += V[i]; b.vn++; }
    if (C[i] > 0){ b.c += C[i]; b.cn++; }
    if (!Number.isNaN(A[i])){ b.a += A[i]; b.an++; }
    b.d = D[i];
  }
  const keys = [...bins.keys()].sort((a,b)=>a-b);
  const st = {t:[],hr:[],v:[],c:[],d:[],a:[]};
  for (const k of keys){
    const b = bins.get(k);
    st.t.push(k*B); st.hr.push(b.hn ? Math.round(b.h/b.hn) : 0);
    st.v.push(b.vn ? Math.round(b.v/b.vn*100)/100 : 0);
    st.c.push(b.cn ? Math.round(b.c/b.cn) : 0); st.d.push(Math.round(b.d));
    st.a.push(b.an ? Math.round(b.a/b.an*10)/10 : null);
  }

  const timer = s[8] != null ? s[8]/1000 : (n ? T[n-1] : 0);
  const dist = s[9] != null ? s[9]/100 : (n ? D[n-1] : 0);
  const hrs = st.hr.filter(x=>x>0);
  const avgHR = s[16] != null ? s[16] : (hrs.length ? Math.round(hrs.reduce((a,b)=>a+b,0)/hrs.length) : null);
  const maxHR = s[17] != null ? s[17] : (hrs.length ? Math.max(...hrs) : null);
  const avgSpd = s[124] != null ? s[124]/1000 : (s[14] != null ? s[14]/1000 : (timer > 0 ? dist/timer : 0));
  const cads = st.c.filter((c,i)=>c>0 && st.v[i]>1.5);

  // beste 30-min-Herzfrequenz (für Laktatschwellen-Schätzung)
  let hr30 = null;
  { let i=0, sum=0, cnt=0;
    for (let j=0;j<st.t.length;j++){
      if (st.hr[j] > 0){ sum += st.hr[j]; cnt++; }
      while (i < j && st.t[j]-st.t[i] > 1800){ if (st.hr[i] > 0){ sum -= st.hr[i]; cnt--; } i++; }
      if (st.t[j]-st.t[i] >= 1780 && cnt >= 300){ const a = sum/cnt; if (hr30 === null || a > hr30) hr30 = Math.round(a); }
    } }

  const bestD = {}, bestT = {};
  if (isRun && dist > 900){
    for (const d of [1000,5000,10000,21097.5,42195]) if (dist >= d){ const v = bestByDistance(T,D,d); if (v) bestD[d] = v; }
    for (const t of [180,300,720,1200,1800,3600]) if (timer >= t){ const v = bestByTime(T,D,t); if (v) bestT[t] = v; }
  }
  const zt = fit.zones_target[0] || {}, up = fit.user_profile[0] || {};
  const start = (startFit + FIT_EPOCH_OFFSET)*1000;
  return {
    id: String(start), start, sport, subSport, isRun,
    name: isRun ? (SUBSPORTS_RUN[subSport] ? 'Lauf ('+SUBSPORTS_RUN[subSport]+')' : 'Lauf') : (SPORTS[sport] || 'Aktivität'),
    dist, timer, avgHR, maxHR, avgSpd,
    ascent: s[22] != null ? s[22] : null, kcal: s[11] != null ? s[11] : null,
    te: s[24] != null ? s[24]/10 : null, ane: s[137] != null ? s[137]/10 : null,
    cad: cads.length ? Math.round(cads.reduce((a,b)=>a+b,0)/cads.length) : null,
    gct: gN ? Math.round(gSum/gN) : null, vo: oN ? Math.round(oSum/oN*10)/100 : null,
    hr30, bestD, bestT,
    watch: { lthr: zt[2] != null ? zt[2] : null, maxHR: zt[1] != null ? zt[1] : null, rest: up[8] != null ? up[8] : null, sex: up[1] === 0 ? 'f' : (up[1] === 1 ? 'm' : null) },
    stream: st
  };
}

/* ---------------- Parameter & Zonen ---------------- */
function estimateParams(acts, S){
  const now = Date.now();
  const recent = acts.filter(a => now - a.start < 365*DAY).sort((a,b)=>b.start-a.start);
  const src = {};
  let maxHR = +S.maxHR || null;
  if (maxHR) src.maxHR = 'eigene Eingabe';
  else {
    const obs = Math.max(0, ...recent.map(a => (a.maxHR && a.maxHR < 225) ? a.maxHR : 0));
    if (obs >= 150){ maxHR = obs; src.maxHR = 'höchster Wert der letzten 12 Monate'; }
    else if (+S.age){ maxHR = Math.round(208 - 0.7*S.age); src.maxHR = 'Formel 208 − 0,7 × Alter'; }
    else { maxHR = 190; src.maxHR = 'Standardwert – bitte eintragen'; }
  }
  let restHR = +S.restHR || null;
  if (restHR) src.restHR = 'eigene Eingabe';
  else { const w = recent.find(a => a.watch && a.watch.rest >= 30 && a.watch.rest <= 100);
    if (w){ restHR = w.watch.rest; src.restHR = 'Uhr-Profil'; } else { restHR = 55; src.restHR = 'Standardwert – bitte eintragen'; } }
  let lthr = +S.lthr || null;
  if (lthr) src.lthr = 'eigene Eingabe';
  else {
    const w = recent.find(a => a.watch && a.watch.lthr >= 110 && a.watch.lthr <= maxHR - 3);
    if (w){ lthr = w.watch.lthr; src.lthr = 'Einstellung aus der Uhr'; }
    else {
      const h = Math.max(0, ...recent.filter(a => a.isRun && now - a.start < 180*DAY).map(a => a.hr30 || 0));
      if (h >= 0.85*maxHR && h < maxHR){ lthr = h; src.lthr = 'beste 30-Minuten-Belastung (Schätzung)'; }
      else { lthr = Math.round(0.9*maxHR); src.lthr = 'grobe Schätzung (90 % der HFmax)'; }
    }
  }
  let sex = S.sex || (recent.find(a => a.watch && a.watch.sex) || {watch:{}}).watch.sex || 'm';
  return {maxHR, restHR, lthr, sex, src};
}
function hrBounds(lthr){ return [0.85,0.90,0.95,1.0].map(f => Math.round(f*lthr)); } // Untergrenzen Z2..Z5
function zoneOf(hr, b){ let z = 0; while (z < 4 && hr >= b[z]) z++; return z; }

function derive(act, P){
  const st = act.stream, b = hrBounds(P.lthr), zs = [0,0,0,0,0];
  const k = P.sex === 'f' ? [0.86,1.67] : [0.64,1.92];
  let trimp = 0, hrN = 0;
  for (let i=0;i<st.hr.length;i++){
    const hr = st.hr[i]; if (!(hr > 0)) continue;
    hrN++; zs[zoneOf(hr,b)] += 5;
    const x = Math.min(1, Math.max(0, (hr-P.restHR)/(P.maxHR-P.restHR)));
    trimp += (5/60) * x * k[0] * Math.exp(k[1]*x);
  }
  let hrEst = false;
  if (hrN < 30){ trimp = act.timer/60; hrEst = true; }
  let dec = null, ef = null;
  const tot = zs.reduce((a,c)=>a+c,0);
  if (act.isRun && act.timer >= 2400 && tot > 0 && (zs[3]+zs[4]) < 0.15*tot){
    const idx = []; for (let i=0;i<st.t.length;i++) if (st.v[i] > 1.5 && st.hr[i] > 0) idx.push(i);
    const use = idx.slice(Math.floor(idx.length*0.1));
    if (use.length >= 200){
      const vs = use.map(i=>st.v[i]), m = vs.reduce((a,c)=>a+c,0)/vs.length;
      const sd = Math.sqrt(vs.reduce((a,c)=>a+(c-m)**2,0)/vs.length);
      if (sd/m < 0.15){
        const half = Math.floor(use.length/2);
        const efOf = arr => { let v=0,h=0; for (const i of arr){ v += st.v[i]; h += st.hr[i]; } return v/h; };
        const e1 = efOf(use.slice(0,half)), e2 = efOf(use.slice(half));
        dec = Math.round((e1-e2)/e1*1000)/10;
      }
    }
  }
  if (act.isRun && act.avgHR && act.avgHR < b[1] && act.timer >= 1200 && act.avgSpd > 1.5) ef = Math.round(act.avgSpd*60/act.avgHR*100)/100;
  return {zs, trimp: Math.round(trimp*10)/10, hrEst, dec, ef};
}

/* ---------------- VDOT & Tempobereiche (nach Jack Daniels, angenähert) ---------------- */
function vdotFrom(distM, sec){
  const t = sec/60, v = distM/t;
  const vo2 = -4.60 + 0.182258*v + 0.000104*v*v;
  const pct = 0.8 + 0.1894393*Math.exp(-0.012778*t) + 0.2989558*Math.exp(-0.1932605*t);
  return vo2/pct;
}
function velAtVO2(vo2){ const a = 0.000104, b = 0.182258, c = -4.60 - vo2; return (-b + Math.sqrt(b*b - 4*a*c))/(2*a); }
function predictTime(distM, vdot){
  let lo = distM/10, hi = distM/0.5;
  for (let i=0;i<80;i++){ const mid = (lo+hi)/2; if (vdotFrom(distM, mid) > vdot) lo = mid; else hi = mid; }
  return (lo+hi)/2;
}
function estimateVdot(acts, S){
  const rd = +S.raceDist, rt = parseDuration(S.raceTime);
  if (rd > 0 && rt > 0) return {vdot: vdotFrom(rd*1000, rt), src: 'Wettkampfergebnis (eigene Eingabe)'};
  const now = Date.now(); let best = null;
  for (const a of acts){
    if (!a.isRun || now - a.start > 120*DAY) continue;
    for (const d in a.bestD) if (+d >= 3000){ const v = vdotFrom(+d, a.bestD[d]); if (!best || v > best.vdot) best = {vdot:v, a, what: fmtDistLabel(+d)}; }
    for (const t in a.bestT) if (+t >= 720){ const v = vdotFrom(a.bestT[t], +t); if (!best || v > best.vdot) best = {vdot:v, a, what: (+t/60)+' min'}; }
  }
  if (best && best.vdot >= 20 && best.vdot <= 85) return {vdot: best.vdot, src: 'beste '+best.what+' der letzten 120 Tage ('+fmtDate(best.a.start)+')', fromTraining: true};
  return null;
}
function trainingPaces(vdot){
  const pace = v => 60000/v; // Sekunden pro km aus m/min
  return {
    E: [pace(velAtVO2(0.62*vdot)), pace(velAtVO2(0.70*vdot))],
    M: predictTime(42195, vdot)/42.195,
    HM: predictTime(21097.5, vdot)/21.0975,
    T: pace(velAtVO2(0.88*vdot)),
    I: pace(velAtVO2(0.975*vdot))
  };
}

/* ---------------- Belastung (TRIMP → Fitness/Ermüdung/Form) ---------------- */
function dayKey(ts){ const d = new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function mondayOf(ts){ const d = new Date(ts); d.setHours(0,0,0,0); d.setDate(d.getDate() - (d.getDay()+6)%7); return d.getTime(); }
function loadSeries(acts, der, today = Date.now()){
  if (!acts.length) return [];
  const loads = {};
  for (const a of acts){ const k = dayKey(a.start); loads[k] = (loads[k]||0) + (der[a.id] ? der[a.id].trimp : 0); }
  const first = Math.min(...acts.map(a=>a.start));
  const d = new Date(first); d.setHours(12,0,0,0);
  const endK = dayKey(today), out = [];
  let ctl = 0, atl = 0;
  for (let guard=0; guard<4000; guard++){
    const k = dayKey(d.getTime()), L = loads[k] || 0, tsb = ctl - atl;
    ctl += (L - ctl)/42; atl += (L - atl)/7;
    out.push({date:k, ts:d.getTime(), load:L, ctl, atl, tsb});
    if (k === endK) break;
    d.setDate(d.getDate()+1);
  }
  return out;
}
function weeklyKm(acts, weeks = 12, today = Date.now()){
  const m0 = mondayOf(today), res = [];
  for (let w=weeks-1; w>=0; w--){
    const ws = new Date(m0); ws.setDate(ws.getDate() - 7*w);
    const we = new Date(ws); we.setDate(we.getDate()+7);
    const km = acts.filter(a => a.isRun && a.start >= ws.getTime() && a.start < we.getTime()).reduce((s,a)=>s+a.dist/1000,0);
    res.push({start: ws.getTime(), km});
  }
  return res;
}

/* ---------------- Trainingsplan (regelbasiert) ---------------- */
const WD = ['Mo','Di','Mi','Do','Fr','Sa','So'];
function buildPlan(ctx){
  const {S, acts, der, P, paces, series, today = Date.now()} = ctx;
  const goal = S.goal === 'hm' ? 'hm' : 'm';
  const nRuns = Math.min(6, Math.max(3, +S.runsPerWeek || 4));
  const wk = weeklyKm(acts, 9, today);
  const done = wk.slice(0, 8);            // abgeschlossene Wochen
  const last4 = done.slice(-4), vol4 = last4.reduce((s,w)=>s+w.km,0)/4;
  const peak8 = Math.max(0, ...done.map(w=>w.km));
  const longest6 = Math.max(0, ...acts.filter(a => a.isRun && today - a.start < 42*DAY).map(a => a.dist/1000));
  const notes = [];

  // Phase
  let wtr = null, phase, raceTs = null;
  if (S.raceDate){ raceTs = new Date(S.raceDate+'T12:00').getTime(); wtr = Math.round((mondayOf(raceTs) - mondayOf(today))/(7*DAY)); const t0 = new Date(today); t0.setHours(0,0,0,0); if (wtr < 0 || raceTs < t0.getTime()){ wtr = null; raceTs = null; } }
  const tp = goal === 'm' ? {taper:2, spec:8, build:14} : {taper:1, spec:6, build:11};
  if (wtr === null) phase = 'Grundlage';
  else if (wtr <= tp.taper) phase = 'Tapering';
  else if (wtr <= tp.spec) phase = 'Spezifisch';
  else if (wtr <= tp.build) phase = 'Aufbau';
  else phase = 'Grundlage';

  // Form
  const cur = series.length ? series[series.length-1] : {ctl:0, atl:0, tsb:0};
  const rel = cur.ctl > 5 ? cur.tsb/cur.ctl : 0, acwr = cur.ctl > 5 ? cur.atl/cur.ctl : 1;
  const fatigued = rel < -0.3 || acwr > 1.5;
  const isoWeek = Math.floor((mondayOf(today) - new Date(2024,0,1).getTime())/(7*DAY));
  const recovery = phase !== 'Tapering' && !fatigued && (wtr !== null ? (wtr - tp.taper) % 4 === 0 && wtr - tp.taper > 0 : isoWeek % 4 === 3);

  // Umfang
  let V;
  if (vol4 < 5){ V = goal === 'm' ? 25 : 20; notes.push('Noch wenig Laufdaten der letzten 4 Wochen – der Plan startet mit einem vorsichtigen Einstiegsumfang. Importiere mehr Läufe für genauere Vorschläge.'); }
  else if (phase === 'Tapering'){ const f = goal === 'm' ? [0.45,0.65,0.8][wtr] : [0.55,0.75][wtr]; V = Math.max(peak8,vol4)*f; }
  else if (recovery) V = vol4*0.7;
  else if (fatigued) V = vol4*0.85;
  else V = Math.min(vol4*1.08, vol4+5);
  V = Math.max(12, Math.round(V));

  // Tempo-Texte
  const pt = paces ? {
    E: fmtPace(paces.E[0])+'–'+fmtPace(paces.E[1]), M: fmtPace(paces.M), HM: fmtPace(paces.HM), T: fmtPace(paces.T), I: fmtPace(paces.I)
  } : null;
  const b = hrBounds(P.lthr);
  const hrE = 'HF unter '+b[1], hrT = 'HF '+b[2]+'–'+b[3], hrM = 'HF '+b[0]+'–'+(b[2]-1), hrHM = 'HF '+b[2]+'–'+(b[3]+2);
  const tempo = (key, hr) => pt ? pt[key]+'/km · '+hr : hr;
  const Tp = paces ? paces.T : 330, Ip = paces ? paces.I : 300, HMp = paces ? paces.HM : 320;
  const km = x => Math.round(x*2)/2;

  // Qualitätseinheiten
  const Q = [];
  const light = recovery || fatigued;
  if (phase === 'Tapering' && wtr === 0){
    Q.push({title:'Aktivierung', detail:'3 km locker, dann 3×1 km im Wettkampftempo mit 2 min Trabpause, 2 km locker. 3–4 Tage vor dem Rennen.', tempo: tempo(goal==='m'?'M':'HM', goal==='m'?hrM:hrHM), km:8});
  } else if (light){
    Q.push({title:'Lockerer Lauf mit Steigerungen', detail:'Locker laufen, am Ende 6×20 s Steigerungen (zügig, nicht voll) mit voller Gehpause.', tempo: tempo('E', hrE), km:8});
  } else if (phase === 'Grundlage'){
    Q.push({title:'Lockerer Lauf mit Steigerungen', detail:'Locker laufen, am Ende 6–8×20 s Steigerungen.', tempo: tempo('E', hrE), km:9});
    if (nRuns >= 5) Q.push({title:'Fahrtspiel', detail:'2 km einlaufen, 8×1 min zügig im Schwellenbereich / 1 min locker, 2 km auslaufen.', tempo: tempo('T', hrT), km: km(4 + 16*60/((Tp+ (paces?paces.E[1]:360))/2))});
  } else if (phase === 'Aufbau'){
    Q.push({title:'Schwellenintervalle', detail:'2 km einlaufen, 3×10 min im Schwellentempo mit 2 min Trabpause, 2 km auslaufen.', tempo: tempo('T', hrT), km: km(4 + 1800/Tp + 0.6)});
    if (nRuns >= 5) Q.push({title:'Intervalle', detail:'2 km einlaufen, 5×1000 m im Intervalltempo mit 2:30 min Trabpause, 2 km auslaufen.', tempo: tempo('I', 'HF bis Z5'), km: 10.5});
  } else if (phase === 'Spezifisch'){
    if (goal === 'hm'){
      Q.push({title:'HM-Tempoblöcke', detail:'2 km einlaufen, 3×3 km im Halbmarathontempo mit 3 min Trabpause, 2 km auslaufen.', tempo: tempo('HM', hrHM), km: 14});
      if (nRuns >= 5) Q.push({title:'Tempodauerlauf', detail:'2 km einlaufen, 20–25 min im Schwellentempo am Stück, 2 km auslaufen.', tempo: tempo('T', hrT), km: km(4 + 1350/Tp)});
    } else {
      Q.push({title:'Schwellenblöcke', detail:'2 km einlaufen, 2×15 min im Schwellentempo mit 3 min Trabpause, 2 km auslaufen.', tempo: tempo('T', hrT), km: km(4 + 1800/Tp + 0.6)});
      if (nRuns >= 5) Q.push({title:'Marathontempo-Lauf', detail:'3 km einlaufen, 8–10 km im Marathontempo, 2 km auslaufen.', tempo: tempo('M', hrM), km: 14});
    }
  } else { // Tapering, nicht Rennwoche
    Q.push({title:'Tempo halten', detail:'2 km einlaufen, 4×1 km im Wettkampftempo mit 2 min Trabpause, 2 km auslaufen.', tempo: tempo(goal==='m'?'M':'HM', goal==='m'?hrM:hrHM), km: 9});
  }
  if (nRuns <= 3 && Q.length > 1) Q.length = 1;

  // langer Lauf
  const cap = Math.min(longest6 > 0 ? longest6 + 2 : 12, goal === 'm' ? 32 : 21);
  let L = km(Math.max(8, Math.min(V*(goal==='m'?0.3:0.28), cap)));
  if (phase === 'Tapering') L = km(Math.min(L, goal==='m' ? [0,18,26][wtr] || 14 : [0,14][wtr] || 12));
  let longDetail = 'Ruhig und gleichmäßig. Achte darauf, dass die HF in der zweiten Hälfte nicht davonläuft.';
  let longTempo = tempo('E', hrE);
  if (!light && phase === 'Spezifisch'){
    if (goal === 'hm') longDetail = 'Locker beginnen, die letzten 4 km im Halbmarathontempo.';
    else longDetail = 'Locker beginnen, im Mittelteil 3×4 km im Marathontempo mit je 1 km locker dazwischen.';
  }
  if (recovery) longDetail = 'Entlastungswoche: kürzer und bewusst locker.';

  // Wochenraster
  const layouts = {3:['Di:Q0','Do:E','So:L'], 4:['Di:Q0','Do:E','Sa:E','So:L'], 5:['Di:Q0','Mi:E','Do:Q1','Sa:E','So:L'], 6:['Mo:E','Di:Q0','Mi:E','Do:Q1','Sa:E','So:L']};
  const slots = layouts[nRuns].map(x => { const [d,t] = x.split(':'); return {day: WD.indexOf(d), t}; });
  slots.forEach(s => { if (s.t === 'Q1' && !Q[1]) s.t = 'E'; });
  const nEasy = slots.filter(s=>s.t==='E').length;
  const qKm = Q.reduce((s,q)=>s+q.km,0);
  const eKm = nEasy ? km(Math.min(16, Math.max(5, (V - L - qKm)/nEasy))) : 0;
  const sessions = [];
  for (let d=0; d<7; d++){
    const s = slots.find(x=>x.day===d);
    let item;
    if (!s) item = {day:d, type:'R', title:'Ruhetag', detail:'Frei oder lockeres Mobilisieren.', km:0};
    else if (s.t === 'L') item = {day:d, type:'L', title:'Langer Lauf', detail:longDetail, tempo:longTempo, km:L};
    else if (s.t === 'E') item = {day:d, type:'E', title:'Lockerer Lauf', detail:'Im Gesprächstempo. Lieber zu langsam als zu schnell.', tempo:tempo('E', hrE), km:eKm};
    else { const q = Q[+s.t[1]]; item = {day:d, type:'Q', ...q}; }
    sessions.push(item);
  }
  // Rennwoche: Rennen am Wettkampftag einsetzen
  if (phase === 'Tapering' && wtr === 0 && raceTs){
    const rd = (new Date(raceTs).getDay()+6)%7;
    sessions[rd] = {day:rd, type:'W', title: goal==='m' ? 'Marathon' : 'Halbmarathon', detail:'Wettkampf! Erste Kilometer bewusst kontrolliert.', tempo: tempo(goal==='m'?'M':'HM', goal==='m'?hrM:hrHM), km: goal==='m'?42.2:21.1};
    if (rd > 0 && sessions[rd-1].type !== 'R') sessions[rd-1] = {day:rd-1, type:'E', title:'Kurzer Lockerer', detail:'20–25 min ganz locker, 3 kurze Steigerungen.', tempo:tempo('E',hrE), km:4};
    if (rd < 6) for (let d=rd+1; d<7; d++) sessions[d] = {day:d, type:'R', title:'Erholung', detail:'Nach dem Rennen: Pause oder Spaziergang.', km:0};
    for (const s of sessions) if (s.type === 'L'){ s.type='E'; s.title='Lockerer Lauf'; s.km = Math.min(s.km, 8); s.detail='Kurz und locker.'; }
  }

  // Hinweise aus der Analyse
  const z = [0,0,0,0,0];
  for (const a of acts) if (today - a.start < 28*DAY && der[a.id]) der[a.id].zs.forEach((v,i)=> z[i]+=v);
  const zt = z.reduce((a,c)=>a+c,0);
  if (zt > 3600){
    const easy = (z[0]+z[1])/zt, grey = z[2]/zt;
    if (grey > 0.25) notes.push('In den letzten 4 Wochen lagen '+Math.round(grey*100)+' % deiner Zeit in Zone 3 („Grauzone“). Lockere Läufe lockerer, harte Einheiten gezielter – das bringt für '+(goal==='m'?'den Marathon':'den Halbmarathon')+' meist mehr.');
    else if (easy < 0.7) notes.push('Nur '+Math.round(easy*100)+' % deiner Trainingszeit war locker (Z1–Z2). Für Langdistanz sind etwa 75–80 % üblich.');
    else notes.push(Math.round(easy*100)+' % deiner Trainingszeit war locker (Z1–Z2) – gute Verteilung für die Langdistanz.');
  }
  if (fatigued) notes.push('Deine Ermüdung ist im Verhältnis zur Fitness hoch (Akut/Chronisch '+acwr.toFixed(2)+'). Diese Woche wird entlastet.');
  else if (acwr > 1.3) notes.push('Die Belastung steigt gerade schnell (Akut/Chronisch '+acwr.toFixed(2)+'). Nicht zusätzlich draufpacken.');
  if (recovery) notes.push('Entlastungswoche: etwa 30 % weniger Umfang, damit das Training der letzten Wochen wirken kann.');
  const decs = acts.filter(a => der[a.id] && der[a.id].dec !== null && today - a.start < 42*DAY && a.timer >= 3600).map(a => der[a.id].dec);
  if (decs.length){
    const md = decs.reduce((a,c)=>a+c,0)/decs.length;
    notes.push(md < 5 ? 'Aerobe Entkopplung deiner langen Läufe im Schnitt '+md.toFixed(1)+' % – deine Grundlagenausdauer trägt gut.' : 'Aerobe Entkopplung deiner langen Läufe im Schnitt '+md.toFixed(1)+' % – die HF driftet noch deutlich. Mehr ruhige lange Läufe helfen.');
  }
  if (goal === 'm' && wtr !== null && wtr <= 12 && Math.max(vol4, peak8) < 35) notes.push('Für einen Marathon ist dein aktueller Umfang noch niedrig. Plane das Rennen eher defensiv oder verschiebe das Ziel, wenn möglich.');

  // Ziel-Check
  let goalCheck = null;
  const tt = parseDuration(S.targetTime);
  if (tt > 0 && ctx.vd){
    const dist = goal === 'm' ? 42195 : 21097.5, need = vdotFrom(dist, tt), pred = predictTime(dist, ctx.vd.vdot);
    const diff = need - ctx.vd.vdot;
    goalCheck = {need, pred, pace: tt/(dist/1000), verdict: diff <= 0 ? 'Laut aktueller Form realistisch.' : diff <= 2 ? 'Ambitioniert, aber mit gutem Aufbau erreichbar.' : 'Sehr ambitioniert – dafür fehlen aktuell rund '+diff.toFixed(1)+' VDOT-Punkte.'};
  }

  // Heute
  const tIdx = (new Date(today).getDay()+6)%7;
  const todays = acts.filter(a => dayKey(a.start) === dayKey(today));
  const yest = acts.filter(a => dayKey(a.start) === dayKey(today - DAY));
  const yHard = yest.some(a => der[a.id] && (der[a.id].zs[3]+der[a.id].zs[4] >= 600 || (a.te||0) >= 3.5));
  let todayRec = {...sessions[tIdx]};
  if (todays.length){ const k = todays.filter(a=>a.isRun).reduce((s,a)=>s+a.dist/1000,0); todayRec = {type:'X', title:'Heute schon erledigt', detail: todays.length+' Aktivität(en)'+(k>0?', '+k.toFixed(1).replace('.',',')+' km gelaufen':'')+'. Gute Erholung!', km:0}; }
  else if (rel < -0.35 && todayRec.type !== 'R' && todayRec.type !== 'W') todayRec = {type:'R', title:'Erholung vorziehen', detail:'Deine Form ist deutlich im Minus. Heute Ruhetag oder höchstens 30 min sehr locker.', km:0};
  else if (yHard && todayRec.type === 'Q') todayRec = {...todayRec, detail: todayRec.detail + ' Gestern war schon intensiv – verschiebe diese Einheit notfalls um einen Tag.'};

  // Erholungswerte aus Apple Health
  const rec = ctx.rec;
  if (rec && rec.hasData && !todays.length && todayRec.type !== 'W'){
    if (rec.score < 40 && todayRec.type !== 'R') todayRec = {type:'R', title:'Erholung vorziehen', detail:'Deine Erholungswerte sind heute deutlich schlechter als sonst'+(rec.why ? ' ('+rec.why+')' : '')+'. Ruhetag oder höchstens 30 min sehr locker.', km:0};
    else if (rec.score < 60 && todayRec.type === 'Q') todayRec = {type:'E', title:'Locker statt '+todayRec.title, detail:'Erholung heute eingeschränkt'+(rec.why ? ' ('+rec.why+')' : '')+'. Lauf locker und hol die Qualitätseinheit an einem besseren Tag nach.', tempo:tempo('E', hrE), km:Math.min(todayRec.km, 8)};
    else if (rec.score >= 80 && todayRec.type === 'Q') todayRec = {...todayRec, detail: todayRec.detail + ' Deine Erholungswerte sind gut – beste Voraussetzungen.'};
  }
  if (rec && rec.streak >= 3) notes.unshift('Dein Ruhepuls liegt seit '+rec.streak+' Tagen deutlich über deinem Schnitt. Das kann auf Überlastung, Stress oder einen beginnenden Infekt hindeuten. Schalte einen Gang zurück, bis er sich normalisiert.');
  if (ctx.W){
    const sl7 = []; for (let i=0;i<7;i++){ const x = sleepOf(ctx.W, dayKey(today - i*DAY)); if (x) sl7.push(x.tot); }
    const tgt = (parseNum(S.sleepTarget) || 7.5)*60;
    if (sl7.length >= 5){ const a = sl7.reduce((x,y)=>x+y,0)/sl7.length; if (a < tgt - 45) notes.push('Du hast in den letzten Nächten im Schnitt nur '+fmtHM(a)+' geschlafen. Schlaf ist der größte Hebel für Anpassung und Verletzungsschutz – gerade in intensiven Trainingswochen.'); }
  }

  return {phase, wtr, recovery, fatigued, V, vol4, sessions, notes, goalCheck, today: todayRec, tIdx, raceTs, goal};
}


/* ---------------- Tageswerte: Ruhepuls & Schlaf aus Apple Health ---------------- */
function sleepKind(v){
  const s = String(v == null ? '' : v).toLowerCase().trim();
  if (/^\d$/.test(s)) return ['inbed','asleep','awake','core','deep','rem'][+s] || null;
  if (s.includes('rem')) return 'rem';
  if (s.includes('deep') || s.includes('tief')) return 'deep';
  if (s.includes('core') || s.includes('kern') || s.includes('leicht') || s.includes('light')) return 'core';
  if (s.includes('awake') || s.includes('wach')) return 'awake';
  if (s.includes('inbed') || s.includes('bett') || s.includes('in bed')) return 'inbed';
  if (s.includes('asleep') || s.includes('schlaf') || s.includes('sleep')) return 'asleep';
  return null;
}
function parseNum(v){ const m = String(v == null ? '' : v).match(/-?\d+(?:[.,]\d+)?/); return m ? parseFloat(m[0].replace(',','.')) : NaN; }
function parseHKDate(v){
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m){ let tz = m[4] || ''; if (tz && tz !== 'Z' && tz.indexOf(':') < 0) tz = tz.slice(0,3)+':'+tz.slice(3); const t = Date.parse(m[1]+'T'+m[2]+(m[3]||':00')+tz); return isNaN(t) ? null : t; }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4}),?\s+(?:um\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m){ const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, m[2]-1, +m[1], +m[4], +m[5], +(m[6]||0)).getTime(); }
  const t = Date.parse(s); return isNaN(t) ? null : t;
}
function parseShortcutText(txt){
  const recs = [];
  for (const line of String(txt).split(/\r?\n/)){
    const p = line.split(';').map(x => x.trim());
    if (p[0] === 'R' && p.length >= 3) recs.push({k:'R', t:parseHKDate(p[1]), v:parseNum(p[2]), src:p[3] || ''});
    else if (p[0] === 'S' && p.length >= 4) recs.push({k:'S', s:parseHKDate(p[1]), e:parseHKDate(p[2]), kind:sleepKind(p[3]), src:p[4] || ''});
  }
  return recs;
}
function xmlAttr(line, name){ const i = line.indexOf(' '+name+'="'); if (i < 0) return null; const st = i + name.length + 3; return line.slice(st, line.indexOf('"', st)); }
function parseHealthXmlLine(line, recs){
  if (line.indexOf('<Record') < 0) return;
  if (line.indexOf('HKQuantityTypeIdentifierRestingHeartRate"') >= 0) recs.push({k:'R', t:parseHKDate(xmlAttr(line,'startDate')), v:parseNum(xmlAttr(line,'value')), src:xmlAttr(line,'sourceName') || ''});
  else if (line.indexOf('HKCategoryTypeIdentifierSleepAnalysis"') >= 0) recs.push({k:'S', s:parseHKDate(xmlAttr(line,'startDate')), e:parseHKDate(xmlAttr(line,'endDate')), kind:sleepKind(xmlAttr(line,'value')), src:xmlAttr(line,'sourceName') || ''});
}
function newWellness(){ return {rhr:{}, sleep:{}}; }
const sleepTotal = x => x.deep + x.rem + x.core + x.asleep;
function ingestWellness(W, recs, today = Date.now()){
  const cutoff = today - 730*DAY, nights = {}, seen = new Set(); let nr = 0;
  for (const r of recs){
    if (r.k === 'R'){
      if (!r.t || r.t < cutoff || !(r.v >= 25 && r.v <= 120)) continue;
      const d = dayKey(r.t); (W.rhr[d] = W.rhr[d] || {})[r.src || '?'] = Math.round(r.v); nr++;
    } else if (r.k === 'S'){
      if (!r.s || !r.e || r.e <= r.s || r.e - r.s > 16*3600e3 || !r.kind || r.e < cutoff) continue;
      const src = r.src || '?', id = src+'|'+r.s+'|'+r.e+'|'+r.kind;
      if (seen.has(id)) continue; seen.add(id);
      const nk = dayKey(r.e + 6*3600e3);
      nights[nk] = nights[nk] || {};
      const n = nights[nk][src] = nights[nk][src] || {deep:0, rem:0, core:0, asleep:0, awake:0, inbed:0, start:r.s, end:r.e};
      n[r.kind] += (r.e - r.s)/60000; n.start = Math.min(n.start, r.s); n.end = Math.max(n.end, r.e);
    }
  }
  for (const nk in nights){
    W.sleep[nk] = W.sleep[nk] || {};
    for (const src in nights[nk]){
      const nw = nights[nk][src], old = W.sleep[nk][src];
      if (!old || sleepTotal(nw) > sleepTotal(old) || (sleepTotal(nw) === sleepTotal(old) && nw.inbed >= old.inbed)) W.sleep[nk][src] = nw;
    }
  }
  return {rhr:nr, nights:Object.keys(nights).length};
}
function rhrOf(W, d){
  const o = W && W.rhr[d]; if (!o) return null;
  const ks = Object.keys(o), pref = ks.find(k => /connect|garmin/i.test(k));
  if (pref) return o[pref];
  const v = ks.map(k => o[k]).sort((a,b) => a-b); return v[Math.floor(v.length/2)];
}
function sleepOf(W, d){
  const o = W && W.sleep[d]; if (!o) return null;
  let best = null;
  for (const k in o){ const x = o[k], t = sleepTotal(x);
    if (!best || t > best.tot || (best.tot === 0 && t === 0 && x.inbed > best.inbed)) best = {...x, tot:t, src:k}; }
  if (!best) return null;
  if (best.tot === 0){ if (best.inbed < 60) return null; best.tot = best.inbed - best.awake; best.est = true; }
  best.stages = best.deep + best.rem + best.core > 0;
  return best;
}
function lastWellnessDay(W){
  const ks = Object.keys(W.rhr).concat(Object.keys(W.sleep)).sort(); return ks.length ? ks[ks.length-1] : null;
}
function shiftDay(d, n){ const t = new Date(d+'T12:00'); t.setDate(t.getDate()+n); return dayKey(t.getTime()); }
function rhrBaseline(W, d){
  const v = []; for (let i=1;i<=28;i++){ const x = rhrOf(W, shiftDay(d, -i)); if (x != null) v.push(x); }
  return v.length >= 5 ? v.reduce((a,c)=>a+c,0)/v.length : null;
}
function fmtHM(min){ min = Math.round(min || 0); return Math.floor(min/60)+':'+String(min%60).padStart(2,'0')+' h'; }
function recovery(W, series, S, today = Date.now()){
  const d0 = dayKey(today), f = [];
  if (!W || (!Object.keys(W.rhr).length && !Object.keys(W.sleep).length)) return {hasData:false, empty:true, factors:f};
  let pts = 0, have = 0, why = [];
  let rd = d0, rhr = rhrOf(W, d0); if (rhr == null){ rd = shiftDay(d0, -1); rhr = rhrOf(W, rd); }
  const base = rhr != null ? rhrBaseline(W, rd) : null;
  if (rhr != null && base != null){
    have++; const dev = rhr - base;
    const p = dev <= -1 ? 8 : dev <= 2 ? 0 : dev <= 4 ? -10 : dev <= 7 ? -20 : -30;
    pts += p; if (p < 0) why.push('Ruhepuls +'+Math.round(dev)+' bpm');
    f.push({name:'Ruhepuls', val:rhr+' bpm', text:(dev >= 0 ? '+' : '−')+Math.abs(dev).toFixed(1).replace('.',',')+' zum 4-Wochen-Schnitt von '+Math.round(base)+(rd !== d0 ? ' (Wert von gestern)' : ''), p});
  } else if (rhr != null) f.push({name:'Ruhepuls', val:rhr+' bpm', text:'Noch zu wenige Tage für einen Vergleich (mind. 5).', p:0});
  const target = (parseNum(S.sleepTarget) || 7.5)*60;
  const sl = sleepOf(W, d0);
  if (sl){
    have++; const h = sl.tot;
    let p = h >= target ? 10 : h >= target-60 ? 0 : h >= target-120 ? -10 : -20;
    const l3 = [0,1,2].map(i => sleepOf(W, shiftDay(d0, -i))).filter(Boolean);
    const a3 = l3.length === 3 ? l3.reduce((a,c)=>a+c.tot,0)/3 : null;
    let txt = sl.stages ? 'Tief '+fmtHM(sl.deep)+', REM '+fmtHM(sl.rem) : (sl.est ? 'Nur Bettzeit bekannt, keine Schlafphasen' : 'ohne Schlafphasen');
    if (a3 !== null && a3 < target - 60){ p -= 8; txt += '. Schlafdefizit: Ø der letzten 3 Nächte '+fmtHM(a3); }
    pts += p; if (p < 0) why.push(fmtHM(h)+' Schlaf');
    f.push({name:'Schlaf letzte Nacht', val:fmtHM(h), text:txt, p});
  } else f.push({name:'Schlaf letzte Nacht', val:'–', text:'Keine Daten für letzte Nacht. Tageswerte aktualisieren.', p:0, missing:true});
  const c = series && series[series.length-1];
  if (c && c.ctl > 5){
    const r = c.tsb/c.ctl, p = r < -0.3 ? -15 : r < -0.1 ? -5 : r > 0.05 ? 5 : 0;
    pts += p; if (p <= -15) why.push('hohe Trainingsermüdung');
    f.push({name:'Trainingsbelastung', val:(c.tsb > 0 ? '+' : '')+Math.round(c.tsb), text: r < -0.3 ? 'Deutlich mehr Ermüdung als Fitness' : r < -0.1 ? 'Normale Trainingsermüdung' : 'Wenig Restermüdung', p});
  }
  let streak = 0;
  for (let i=0;i<14;i++){ const d = shiftDay(d0, -i), v = rhrOf(W, d), b = rhrBaseline(W, d); if (v == null){ if (i === 0) continue; break; } if (b != null && v >= b + 3) streak++; else break; }
  if (!have) return {hasData:false, factors:f, streak};
  const score = Math.max(0, Math.min(100, Math.round(70 + pts)));
  const lab = score >= 80 ? ['Gut erholt','Guter Tag für eine intensive Einheit, falls eine geplant ist.'] : score >= 60 ? ['Normal erholt','Training wie geplant.'] : score >= 40 ? ['Eingeschränkt','Intensität heute zurücknehmen.'] : ['Erholung nötig','Ruhetag oder nur sehr locker.'];
  return {hasData:true, score, label:lab[0], text:lab[1], factors:f, why:why.join(', '), streak, partial: have < 2};
}

/* ---------------- Formatierung ---------------- */
function fmtPace(sec){ if (!sec || !isFinite(sec)) return '–'; sec = Math.round(sec); return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'); }
function fmtDur(sec){ sec = Math.round(sec||0); const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60; return h ? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : m+':'+String(s).padStart(2,'0'); }
function fmtDate(ts, long){ return new Date(ts).toLocaleDateString('de-DE', long ? {weekday:'short', day:'numeric', month:'short', year:'numeric'} : {day:'numeric', month:'short'}); }
function fmtKm(m, dig=1){ return (m/1000).toFixed(dig).replace('.',','); }
function fmtDistLabel(d){ return {1000:'1 km',5000:'5 km',10000:'10 km',21097.5:'Halbmarathon',42195:'Marathon'}[d] || (d/1000+' km'); }
function parseDuration(str){
  if (!str) return 0; const p = String(str).trim().split(':').map(Number);
  if (p.some(isNaN)) return 0;
  if (p.length === 3) return p[0]*3600+p[1]*60+p[2];
  if (p.length === 2) return p[0]*60+p[1];
  return 0;
}

if (typeof module !== 'undefined') module.exports = {APP_VERSION, parseShortcutText, parseHealthXmlLine, ingestWellness, newWellness, recovery, sleepOf, rhrOf, rhrBaseline, parseHKDate, sleepKind, dayKey, shiftDay, fmtHM, parseFit, buildActivity, estimateParams, derive, vdotFrom, predictTime, trainingPaces, estimateVdot, loadSeries, weeklyKm, buildPlan, fmtPace, fmtDur, hrBounds, zoneOf, parseDuration, bestByDistance, bestByTime, mondayOf};

