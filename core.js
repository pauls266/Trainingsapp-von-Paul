/* ================= Analyse-Kern (läuft komplett lokal) ================= */
const APP_VERSION = '2.3.0';
const FIT_EPOCH_OFFSET = 631065600;
const BT = {0:[1,'u8',0xFF],1:[1,'s8',0x7F],2:[1,'u8',0xFF],3:[2,'s16',0x7FFF],4:[2,'u16',0xFFFF],5:[4,'s32',0x7FFFFFFF],6:[4,'u32',0xFFFFFFFF],7:[1,'str',null],8:[4,'f32',null],9:[8,'f64',null],10:[1,'u8',0],11:[2,'u16',0],12:[4,'u32',0],13:[1,'u8',0xFF],14:[8,'x',null],15:[8,'x',null],16:[8,'x',null]};
const GMSG = {0:'file_id',3:'user_profile',7:'zones_target',12:'sport',18:'session',19:'lap',20:'record',225:'set'};
const SCHEMA = 2; // Version des gespeicherten Aktivitäts-Formats (2: GPS-Spur, Runden, Sätze, Sportart-Gruppe)
const DAY = 864e5;

function parseFit(buffer){
  const dv = new DataView(buffer);
  if (buffer.byteLength < 14) throw new Error('Datei zu klein');
  const hs = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8),dv.getUint8(9),dv.getUint8(10),dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('Keine FIT-Datei');
  const end = Math.min(hs + dv.getUint32(4,true), buffer.byteLength);
  const out = {file_id:[],user_profile:[],zones_target:[],sport:[],session:[],lap:[],record:[],set:[]};
  const defs = {};
  let p = hs, lastTs = 0;
  const readVal = (t,le,q = p) => {
    switch(t){
      case 'u8': return dv.getUint8(q); case 's8': return dv.getInt8(q);
      case 'u16': return dv.getUint16(q,le); case 's16': return dv.getInt16(q,le);
      case 'u32': return dv.getUint32(q,le); case 's32': return dv.getInt32(q,le);
      case 'f32': return dv.getFloat32(q,le); case 'f64': return dv.getFloat64(q,le);
    } return null;
  };
  const valid = (b,v) => !(b[2] !== null && v === b[2]) && !Number.isNaN(v);
  const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  const readData = def => {
    const m = {};
    for (const f of def.fields){
      const b = BT[f.bt & 0x1F];
      if (!b || b[1] === 'x'){ p += f.size; continue; }
      if (b[1] === 'str'){
        if (td && p + f.size <= end){ let k = 0; while (k < f.size && dv.getUint8(p+k) !== 0) k++;
          if (k) m[f.num] = td.decode(new Uint8Array(dv.buffer, dv.byteOffset + p, k)); }
      } else if (f.size === b[0]){
        const v = readVal(b[1], def.le); if (valid(b,v)) m[f.num] = v;
      } else if (f.size > b[0] && f.size % b[0] === 0){ // Array-Feld, z. B. Übungskategorie
        const arr = []; for (let k=0; k<f.size; k+=b[0]){ const v = readVal(b[1], def.le, p+k); if (valid(b,v)) arr.push(v); }
        if (arr.length) m[f.num] = arr;
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

// Sportarten nach dem offiziellen Garmin FIT SDK (Profile 21.x, Typ „sport“ und „sub_sport“)
const SPORTS = {0:'Sonstiges',1:'Laufen',2:'Radfahren',3:'Wechsel',4:'Fitnessgerät',5:'Schwimmen',6:'Basketball',7:'Fußball',8:'Tennis',9:'American Football',
  10:'Training',11:'Gehen',12:'Skilanglauf',13:'Ski alpin',14:'Snowboard',15:'Rudern',16:'Bergsteigen',17:'Wandern',18:'Multisport',19:'Paddeln',20:'Fliegen',
  21:'E-Bike',22:'Motorrad',23:'Bootfahren',24:'Autofahren',25:'Golf',26:'Drachenfliegen',27:'Reiten',28:'Jagen',29:'Angeln',30:'Inlineskaten',31:'Klettern',
  32:'Segeln',33:'Eislaufen',34:'Fallschirmspringen',35:'Schneeschuhwandern',36:'Schneemobil',37:'Stand-up-Paddling',38:'Surfen',39:'Wakeboarden',40:'Wasserski',
  41:'Kajak',42:'Rafting',43:'Windsurfen',44:'Kitesurfen',45:'Taktik',46:'Jumpmaster',47:'Boxen',48:'Treppensteigen',49:'Baseball',53:'Tauchen',56:'Schießen',
  58:'Wintersport',59:'Grinding',62:'HIIT',63:'Videospiele',64:'Rückschlagsport',65:'Rollstuhl (Gehen)',66:'Rollstuhl (Laufen)',67:'Meditation',68:'Parasport',
  69:'Discgolf',70:'Mannschaftssport',71:'Cricket',72:'Rugby',73:'Hockey',74:'Lacrosse',75:'Volleyball',76:'Tubing',77:'Wakesurfen',78:'Wassersport',
  79:'Bogenschießen',80:'Mixed Martial Arts',81:'Motorsport',82:'Schnorcheln',83:'Tanzen',84:'Seilspringen',85:'Apnoe',86:'Mobilität',87:'Geocaching',88:'Kanu'};
const SUBSPORTS = {1:'Laufband',2:'Straße',3:'Trail',4:'Bahn',5:'Spinning',6:'Indoor',7:'Rennrad',8:'Mountainbike',9:'Downhill',10:'Liegerad',11:'Cyclocross',
  12:'Handbike',13:'Bahnrad',14:'Indoor-Rudern',15:'Crosstrainer',16:'Stepper',17:'Schwimmbad',18:'Freiwasser',19:'Beweglichkeit',20:'Krafttraining',21:'Aufwärmen',
  22:'Spiel',26:'Cardiotraining',27:'Indoor-Gehen',29:'BMX',30:'Spazieren',31:'Walking',43:'Yoga',44:'Pilates',45:'Indoor',46:'Gravel',47:'E-MTB',48:'Pendeln',
  58:'Virtuell',59:'Hindernislauf',62:'Atemübung',67:'Ultra',68:'Indoor-Klettern',69:'Bouldern',70:'HIIT',73:'AMRAP',74:'EMOM',75:'Tabata',84:'Pickleball',
  85:'Padel',94:'Squash',95:'Badminton',96:'Racquetball',97:'Tischtennis',124:'Rucking'};
const SUBSPORTS_RUN = {1:'Laufband',3:'Trail',4:'Bahn',45:'Indoor',58:'Virtuell',59:'Hindernislauf',67:'Ultra'};
// Gruppen für Auswertung und Plan
const KINDS = {run:'Laufen', strength:'Kraft', team:'Ballsport', bike:'Rad', swim:'Schwimmen', walk:'Gehen & Wandern', other:'Sonstiges'};
const KIND_COLORS = {run:'var(--data)', strength:'var(--accent)', team:'var(--z4)', bike:'var(--z3)', swim:'var(--z2)', walk:'var(--z1)', other:'var(--muted)'};
function sportKind(sport, sub, hasSets){
  if (sport === 1 || sport === 66) return 'run';
  if ((sport === 10 && sub === 20) || hasSets) return 'strength';
  if ([6,7,8,9,49,64,70,71,72,73,74,75].includes(sport)) return 'team';
  if (sport === 2 || sport === 21) return 'bike';
  if (sport === 5) return 'swim';
  if ([11,16,17,35,65].includes(sport)) return 'walk';
  return 'other';
}
function sportName(sport, sub, kind){
  if (sport === 1) return SUBSPORTS_RUN[sub] ? 'Lauf ('+SUBSPORTS_RUN[sub]+')' : 'Lauf';
  if (kind === 'strength') return 'Krafttraining';
  if (sport === 10 || sport === 4) return SUBSPORTS[sub] && sub !== 21 ? SUBSPORTS[sub] : SPORTS[sport];
  const base = SPORTS[sport] || 'Aktivität', sn = SUBSPORTS[sub];
  return sn && sub !== 22 && sub !== 2 ? base + ' (' + sn + ')' : base;
}
const SEMI = 180 / 2147483648; // Semicircles -> Grad

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

// Eine FIT-Datei kann mehrere Sessions enthalten (Mehrsport). Jede wird eine eigene Aktivität.
function buildActivities(fit){
  const recsAll = fit.record.filter(r => r[253] != null).sort((a,b)=>a[253]-b[253]);
  let sess = fit.session.filter(x => x[5] !== 3 && x[5] !== 18).sort((a,b) => (a[2]||0) - (b[2]||0));
  if (!sess.length && fit.session.length) sess = [fit.session[0]];
  if (!sess.length){ if (recsAll.length < 10) return []; sess = [{}]; }
  const out = [];
  sess.forEach((s, i) => {
    let recs = recsAll, laps = fit.lap, sets = fit.set;
    if (sess.length > 1){
      const st = s[2] != null ? s[2] : -Infinity;
      const en = s[253] != null ? s[253] : (s[7] != null ? st + s[7]/1000 : Infinity);
      const last = i === sess.length - 1, inR = ts => ts != null && ts >= st && (last ? ts <= en : ts < en);
      recs = recsAll.filter(r => inR(r[253]));
      laps = fit.lap.filter(l => inR(l[2] != null ? l[2] : l[253]));
      sets = fit.set.filter(x => inR(x[6] != null ? x[6] : x[254]));
    }
    const a = buildOne(fit, s, recs, laps, sets);
    if (a){ if (sess.length > 1){ a.multi = i; a.multiOf = sess.length; } out.push(a); }
  });
  return out;
}
function buildActivity(fit){ return buildActivities(fit)[0] || null; }

function buildOne(fit, s, recs, lapsIn, setsIn){
  const startFit = s[2] != null ? s[2] : (recs[0] && recs[0][253]);
  if (startFit == null) return null;
  const sport = s[5] != null ? s[5] : 0, subSport = s[6] != null ? s[6] : 0, isRun = sport === 1;
  const n = recs.length;
  const T = new Float64Array(n), HR = new Float64Array(n), D = new Float64Array(n), V = new Float64Array(n), C = new Float64Array(n), A = new Float64Array(n);
  const LA = new Float64Array(n), LO = new Float64Array(n);
  let gSum=0,gN=0,oSum=0,oN=0,lastD=0,gps=0;
  for (let i=0;i<n;i++){
    const r = recs[i];
    T[i] = r[253]-startFit; HR[i] = r[3] || 0;
    D[i] = r[5] != null ? r[5]/100 : lastD; if (D[i] < lastD) D[i] = lastD; lastD = D[i];
    V[i] = r[73] != null ? r[73]/1000 : (r[6] != null ? r[6]/1000 : NaN);
    C[i] = r[4] != null ? (r[4] + (r[53]||0)/128) * (isRun?2:1) : 0;
    A[i] = r[78] != null ? r[78]/5-500 : (r[2] != null ? r[2]/5-500 : NaN);
    if (r[0] != null && r[1] != null && (r[0] !== 0 || r[1] !== 0)){ LA[i] = r[0]*SEMI; LO[i] = r[1]*SEMI; gps++; } else { LA[i] = NaN; LO[i] = NaN; }
    if (r[41] != null){ gSum += r[41]/10; gN++; }
    if (r[39] != null){ oSum += r[39]/10; oN++; }
  }
  for (let i=1;i<n;i++){ if (Number.isNaN(V[i])){ const dt = T[i]-T[i-1]; V[i] = dt > 0 ? (D[i]-D[i-1])/dt : 0; } }
  if (n && Number.isNaN(V[0])) V[0] = 0;

  // 5-Sekunden-Stream für Diagramme, Karte & zonenabhängige Werte
  const B = 5, bins = new Map();
  for (let i=0;i<n;i++){
    const k = Math.floor(T[i]/B);
    let b = bins.get(k);
    if (!b){ b = {h:0,hn:0,v:0,vn:0,c:0,cn:0,a:0,an:0,d:D[i],la:0,lo:0,gn:0}; bins.set(k,b); }
    if (HR[i] > 0){ b.h += HR[i]; b.hn++; }
    if (V[i] >= 0 && V[i] < 12){ b.v += V[i]; b.vn++; }
    if (C[i] > 0){ b.c += C[i]; b.cn++; }
    if (!Number.isNaN(A[i])){ b.a += A[i]; b.an++; }
    if (!Number.isNaN(LA[i])){ b.la += LA[i]; b.lo += LO[i]; b.gn++; }
    b.d = D[i];
  }
  const keys = [...bins.keys()].sort((a,b)=>a-b);
  const st = {t:[],hr:[],v:[],c:[],d:[],a:[]};
  if (gps >= 10){ st.la = []; st.lo = []; }
  for (const k of keys){
    const b = bins.get(k);
    st.t.push(k*B); st.hr.push(b.hn ? Math.round(b.h/b.hn) : 0);
    st.v.push(b.vn ? Math.round(b.v/b.vn*100)/100 : 0);
    st.c.push(b.cn ? Math.round(b.c/b.cn) : 0); st.d.push(Math.round(b.d));
    st.a.push(b.an ? Math.round(b.a/b.an*10)/10 : null);
    if (st.la){ st.la.push(b.gn ? Math.round(b.la/b.gn*1e5) : null); st.lo.push(b.gn ? Math.round(b.lo/b.gn*1e5) : null); }
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

  // Krafttraining: aktive Sätze (FIT-Nachricht „set“, 225)
  const first = x => Array.isArray(x) ? x[0] : x;
  const sets = (setsIn || []).filter(x => x[5] === 1).map(x => {
    const t0 = x[6] != null ? x[6] : (x[254] != null && x[0] != null ? x[254] - x[0]/1000 : null);
    return { t0: t0 != null ? Math.max(0, Math.round(t0 - startFit)) : null, dur: x[0] != null ? Math.round(x[0]/100)/10 : null,
      reps: x[3] != null ? x[3] : null, kg: x[4] != null ? Math.round(x[4]/16*10)/10 : null,
      cat: first(x[7]) != null ? first(x[7]) : null, sub: first(x[8]) != null ? first(x[8]) : null };
  }).filter(x => x.reps != null || x.kg != null || x.dur != null);
  const kind = sportKind(sport, subSport, sets.length > 0);

  // Runden (FIT-Nachricht „lap“, 19)
  const laps = (lapsIn || []).filter(l => l[2] != null || l[253] != null).sort((x,y) => (x[2]||x[253]) - (y[2]||y[253])).map(l => ({
    t0: l[2] != null ? Math.max(0, l[2] - startFit) : null,
    dur: l[8] != null ? Math.round(l[8]/100)/10 : null, el: l[7] != null ? Math.round(l[7]/100)/10 : null,
    dist: l[9] != null ? Math.round(l[9])/100 : null,
    spd: l[110] != null ? l[110]/1000 : (l[13] != null ? l[13]/1000 : null),
    hr: l[15] != null ? l[15] : null, hrMax: l[16] != null ? l[16] : null,
    cad: l[17] != null ? l[17] * (isRun ? 2 : 1) : null, asc: l[21] != null ? l[21] : null, trig: l[24] != null ? l[24] : null
  })).filter(l => (l.dur || 0) > 0);

  // Sprints bei Ballsport mit GPS: Abschnitte über 5,5 m/s (≥ 1 s, Pausen < 3 s werden zusammengefasst)
  let sprints = null, topSpd = null;
  if (kind === 'team' && gps >= 10){
    sprints = 0; let inS = false, sStart = 0, lastHigh = -1e9;
    for (let i=0;i<n;i++){
      const v = V[i]; if (v < 12) topSpd = Math.max(topSpd || 0, v);
      if (v > 5.5 && v < 12){ if (!inS){ inS = true; sStart = T[i]; } lastHigh = T[i]; }
      else if (inS && T[i] - lastHigh >= 3){ if (lastHigh - sStart >= 1) sprints++; inS = false; }
    }
    if (inS && lastHigh - sStart >= 1) sprints++;
    topSpd = topSpd ? Math.round(topSpd*100)/100 : null;
  }

  const zt = fit.zones_target[0] || {}, up = fit.user_profile[0] || {}, sp = fit.sport[0] || {};
  const start = (startFit + FIT_EPOCH_OFFSET)*1000;
  const act = {
    id: String(start), v: SCHEMA, start, sport, subSport, isRun, kind,
    name: sportName(sport, subSport, kind),
    profile: s[110] || sp[3] || null,
    dist, timer, avgHR, maxHR, avgSpd,
    ascent: s[22] != null ? s[22] : null, kcal: s[11] != null ? s[11] : null,
    te: s[24] != null ? s[24]/10 : null, ane: s[137] != null ? s[137]/10 : null,
    gLoad: s[168] != null ? Math.round(s[168]/65536) : null,
    cad: cads.length ? Math.round(cads.reduce((a,b)=>a+b,0)/cads.length) : null,
    gct: gN ? Math.round(gSum/gN) : null, vo: oN ? Math.round(oSum/oN*10)/100 : null,
    hr30, bestD, bestT,
    watch: { lthr: zt[2] != null ? zt[2] : null, maxHR: zt[1] != null ? zt[1] : null, rest: up[8] != null ? up[8] : null, sex: up[1] === 0 ? 'f' : (up[1] === 1 ? 'm' : null) },
    stream: st
  };
  if (laps.length) act.laps = laps;
  if (sets.length) act.sets = sets;
  if (sprints !== null){ act.sprints = sprints; act.topSpd = topSpd; }
  return act;
}
// Ältere Datensätze (vor Schema 2) bekommen die neuen Felder sinnvoll ergänzt, ohne neu zu importieren
function normalizeAct(a){
  if (!a) return a;
  if (!a.kind) a.kind = sportKind(a.sport, a.subSport, !!(a.sets && a.sets.length));
  if (!a.v && a.src !== 'manual' && a.sport != null) a.name = sportName(a.sport, a.subSport || 0, a.kind); // alte Namenstabelle war teils falsch (z. B. Yoga)
  if (!a.stream) a.stream = {t:[],hr:[],v:[],c:[],d:[],a:[]};
  if (!a.bestD) a.bestD = {}; if (!a.bestT) a.bestT = {};
  return a;
}

/* ---------------- Parameter & Zonen ---------------- */
function estimateParams(acts, S){
  const now = Date.now();
  const recent = acts.filter(a => now - a.start < 365*DAY).sort((a,b)=>b.start-a.start);
  const src = {};
  let maxHR = +S.maxHR || null;
  if (maxHR) src.maxHR = 'eigene Eingabe';
  else {
    // zweithöchster Aktivitätswert: robust gegen einzelne Messfehler des optischen Sensors
    const peaks = recent.map(a => (a.maxHR && a.maxHR < 225) ? a.maxHR : 0).sort((x,y) => y-x);
    const obs = peaks.length >= 2 ? peaks[1] : (peaks[0] || 0);
    const wm = recent.find(a => a.watch && a.watch.maxHR >= 150 && a.watch.maxHR <= 225);
    if (wm && obs > wm.watch.maxHR){ maxHR = obs; src.maxHR = 'gemessen, höher als die Uhr-Einstellung'; }
    else if (wm){ maxHR = wm.watch.maxHR; src.maxHR = 'Einstellung aus der Uhr'; }
    else if (obs >= 150){ maxHR = obs; src.maxHR = 'höchster Wert der letzten 12 Monate'; }
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
  const zoneModel = ZONE_MODELS[S.zoneModel] ? S.zoneModel : 'hrr';
  const P = {maxHR, restHR, lthr, sex, src, zoneModel};
  P.bounds = zoneBounds(P, zoneModel);
  return P;
}
// Zonenmodelle: Untergrenzen von Z2..Z5
const ZONE_MODELS = {
  hrr:  {name:'Herzfrequenzreserve (Karvonen)', short:'HF-Reserve', info:'Zonen in Prozent der Herzfrequenzreserve (HFmax − Ruhepuls): Z1 bis 60 %, Z2 60–70 %, Z3 70–80 %, Z4 80–90 %, Z5 ab 90 %. Berücksichtigt deinen Ruhepuls; so rechnet auch Garmin, wenn „% HFR“ eingestellt ist.'},
  lthr: {name:'Laktatschwelle (Friel)', short:'Schwelle', info:'Zonen in Prozent der Laktatschwellen-HF: Z1 unter 85 %, Z2 85–89 %, Z3 90–94 %, Z4 95–99 %, Z5 ab 100 %. Genau an der Schwelle orientiert; Friels „Zone 2“ ist dabei schon recht zügig – lockere Läufe liegen oft in Z1.'},
  max:  {name:'% der HFmax', short:'% HFmax', info:'Zonen in Prozent der maximalen Herzfrequenz: Z1 bis 70 %, Z2 70–80 %, Z3 80–87 %, Z4 87–93 %, Z5 ab 93 %. Einfach, aber ohne Ruhepuls und Schwelle.'}
};
function zoneBounds(P, model = 'hrr'){
  if (model === 'lthr') return hrBounds(P.lthr);
  if (model === 'max') return [0.70,0.80,0.87,0.93].map(f => Math.round(f*P.maxHR));
  const r = P.maxHR - P.restHR;
  return [0.60,0.70,0.80,0.90].map(f => Math.round(P.restHR + f*r));
}
function hrBounds(lthr){ return [0.85,0.90,0.95,1.0].map(f => Math.round(f*lthr)); } // Untergrenzen Z2..Z5
function zoneOf(hr, b){ let z = 0; while (z < 4 && hr >= b[z]) z++; return z; }

// opts.rpe: Anstrengung 1–10 (Session-RPE nach Foster), opts.k: Umrechnung RPE-Minuten -> TRIMP-Skala
function derive(act, P, opts = {}){
  const st = act.stream || {t:[],hr:[],v:[]}, b = P.bounds || zoneBounds(P, P.zoneModel), zs = [0,0,0,0,0];
  const k = P.sex === 'f' ? [0.86,1.67] : [0.64,1.92];
  let trimp = 0, hrN = 0;
  for (let i=0;i<st.hr.length;i++){
    const hr = st.hr[i]; if (!(hr > 0)) continue;
    hrN++; zs[zoneOf(hr,b)] += 5;
    const x = Math.min(1, Math.max(0, (hr-P.restHR)/(P.maxHR-P.restHR)));
    trimp += (5/60) * x * k[0] * Math.exp(k[1]*x);
  }
  let hrEst = false, src = 'hr';
  const rpe = +opts.rpe, rk = opts.k || RPE_K_DEFAULT, mins = (act.timer || 0)/60;
  if (rpe >= 1 && rpe <= 10 && (hrN < 30 || act.kind === 'strength')){ trimp = mins * rpe * rk; src = 'rpe'; }
  else if (hrN < 30){ trimp = mins * (act.kind === 'walk' ? 0.5 : 1); hrEst = true; src = 'est'; }
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
  return {zs, trimp: Math.round(trimp*10)/10, hrEst, src, dec, ef};
}

// Session-RPE (Minuten × Anstrengung) auf die TRIMP-Skala bringen: aus eigenen Einheiten mit HF und RPE lernen
const RPE_K_DEFAULT = 0.28;
function rpeFactor(acts, P, annot){
  const r = [];
  for (const a of acts){
    const x = annot && annot[a.id]; if (!x || !(x.rpe >= 1) || !a.timer) continue;
    const d = derive(a, P); if (d.src !== 'hr' || a.kind === 'strength') continue;
    r.push(d.trimp / (a.timer/60 * x.rpe));
  }
  if (r.length < 5) return {k: RPE_K_DEFAULT, n: r.length, learned: false};
  r.sort((x,y) => x-y);
  return {k: Math.min(0.6, Math.max(0.12, r[Math.floor(r.length/2)])), n: r.length, learned: true};
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

/* ---------------- VO2max-Schätzung aus Tempo und Herzfrequenz ----------------
   Für gleichmäßige, flache Abschnitte (2 min konstantes Tempo, Steigung ≤ 3 %, ab Minute 10, bis Minute 60):
   Sauerstoffbedarf des Tempos nach Daniels, Anteil der Herzfrequenzreserve nach Swain (%HFR ≈ %VO2-Reserve):
   VO2max ≈ 3,5 + (VO2_Tempo − 3,5) / %HFR. Ergebnis ist der Median aller Abschnitte. */
function vo2maxRun(act, P){
  if (!act || !act.isRun || !act.stream) return null;
  const st = act.stream, n = st.t.length, hrr = P.maxHR - P.restHR;
  if (n < 200 || !(hrr >= 40)) return null;
  const hasAlt = st.a && st.a.some(x => x != null);
  const est = [];
  for (let i = 24; i < n; i += 6){
    const t = st.t[i]; if (t < 600 || t > 3600) continue;
    let vs = 0, vmin = 99, vmax = 0, ok = true;
    for (let j = i-23; j <= i; j++){ const v = st.v[j]; if (!(v > 1.5)){ ok = false; break; } vs += v; vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
    if (!ok) continue;
    const vm = vs/24; if (vm < 1.8 || vm > 6.5 || vmax > vm*1.1 || vmin < vm*0.9) continue;
    let hs = 0, hn = 0; for (let j = i-11; j <= i; j++) if (st.hr[j] > 0){ hs += st.hr[j]; hn++; }
    if (hn < 10) continue;
    const frac = (hs/hn - P.restHR)/hrr; if (frac < 0.5 || frac > 0.95) continue;
    if (hasAlt){ const a0 = st.a[i-23], a1 = st.a[i], dd = st.d[i] - st.d[i-23];
      if (a0 == null || a1 == null || dd <= 0 || Math.abs((a1-a0)/dd) > 0.03) continue; }
    const vmm = vm*60, vo2 = -4.60 + 0.182258*vmm + 0.000104*vmm*vmm;
    est.push(3.5 + (vo2 - 3.5)/frac);
  }
  if (est.length < 20) return null;
  est.sort((x,y) => x-y);
  const m = est[Math.floor(est.length/2)];
  return m >= 25 && m <= 85 ? Math.round(m*10)/10 : null;
}
function median(arr){ if (!arr.length) return null; const a = [...arr].sort((x,y)=>x-y), h = Math.floor(a.length/2); return a.length % 2 ? a[h] : (a[h-1]+a[h])/2; }
function vo2Trend(acts, P, today = Date.now()){
  const list = [];
  for (const a of acts) if (a.isRun && today - a.start < 365*DAY && a.start <= today){ const v = vo2maxRun(a, P); if (v) list.push({start: a.start, id: a.id, vo2: v}); }
  list.sort((x,y) => x.start - y.start);
  const win = (from, to) => list.filter(x => today - x.start >= from*DAY && today - x.start < to*DAY).slice(-8).map(x => x.vo2);
  const c = win(0, 28), p = win(28, 56), c42 = win(0, 42);
  const cur = c.length >= 2 ? median(c) : (c42.length >= 2 ? median(c42) : null);
  const prev = p.length >= 2 ? median(p) : null;
  return {list, cur: cur != null ? Math.round(cur*10)/10 : null, prev: prev != null ? Math.round(prev*10)/10 : null,
    delta: cur != null && prev != null ? Math.round((cur - prev)*10)/10 : null};
}

/* ---------------- Krafttraining ---------------- */
// Übungskategorien nach FIT-Profil („exercise_category“) mit deutschem Namen und beanspruchten Muskelgruppen
const MUSCLES = ['Beine', 'Gesäß & Hüfte', 'Rumpf', 'Rücken', 'Brust', 'Schultern', 'Arme', 'Waden', 'Ganzkörper'];
const EX_CATS = {
  0:['Bankdrücken',{'Brust':1}], 1:['Wadenheben',{'Waden':1}], 2:['Cardio',{'Ganzkörper':1}], 3:['Tragen',{'Ganzkörper':1}],
  4:['Holzhacker',{'Rumpf':1}], 5:['Rumpf',{'Rumpf':1}], 6:['Crunch',{'Rumpf':1}], 7:['Bizepscurl',{'Arme':1}],
  8:['Kreuzheben',{'Beine':.5,'Rücken':.5}], 9:['Fliegende',{'Brust':1}], 10:['Hüftheben',{'Gesäß & Hüfte':1}], 11:['Hüftstabilität',{'Gesäß & Hüfte':1}],
  12:['Kettlebell-Swing',{'Gesäß & Hüfte':1}], 13:['Rückenstrecker',{'Rücken':1}], 14:['Seitheben',{'Schultern':1}], 15:['Beinbeuger',{'Beine':1}],
  16:['Beinheben',{'Rumpf':1}], 17:['Ausfallschritt',{'Beine':.6,'Gesäß & Hüfte':.4}], 18:['Olympisches Heben',{'Ganzkörper':1}], 19:['Unterarmstütz',{'Rumpf':1}],
  20:['Sprungkraft',{'Beine':.7,'Waden':.3}], 21:['Klimmzug',{'Rücken':.7,'Arme':.3}], 22:['Liegestütz',{'Brust':.7,'Arme':.3}], 23:['Rudern',{'Rücken':1}],
  24:['Schulterdrücken',{'Schultern':1}], 25:['Schulterstabilität',{'Schultern':1}], 26:['Schulterheben',{'Schultern':1}], 27:['Sit-up',{'Rumpf':1}],
  28:['Kniebeuge',{'Beine':.7,'Gesäß & Hüfte':.3}], 29:['Ganzkörper',{'Ganzkörper':1}], 30:['Trizeps',{'Arme':1}], 31:['Aufwärmen',{}], 32:['Laufen',{}],
  33:['Rad',{}], 37:['Bandübung',{'Ganzkörper':1}], 38:['Battle Rope',{'Ganzkörper':1}], 44:['Sandsack',{'Ganzkörper':1}], 45:['Schlitten',{'Beine':1}],
  46:['Vorschlaghammer',{'Ganzkörper':1}], 49:['Schlingentraining',{'Ganzkörper':1}], 50:['Reifen',{'Ganzkörper':1}], 65534:['Unbekannte Übung',{}]
};
// Auswahl für die manuelle Erfassung (häufig für Läufer sinnvoll)
const EX_PICK = [28, 8, 17, 10, 15, 1, 20, 19, 5, 6, 16, 23, 21, 22, 0, 24, 14, 7, 30, 12, 29];
function exerciseName(cat, sub){
  const names = typeof EXERCISE_NAMES !== 'undefined' ? EXERCISE_NAMES : null;
  if (!names || cat == null || sub == null || !names[cat]) return null;
  for (const [i, part] of names[cat].split('|').entries()){
    const m = part.match(/^(\d+)=(.*)$/);
    if (m ? +m[1] === sub : i === sub) return m ? m[2] : part;
  }
  return null;
}
function catName(cat){ return (EX_CATS[cat] || EX_CATS[65534])[0]; }
function e1rm(kg, reps){ return kg > 0 && reps >= 1 && reps <= 12 ? kg * (1 + reps/30) : null; } // Epley
function strengthSummary(acts, today = Date.now(), weeks = 8){
  const m0 = mondayOf(today), out = {weeks: [], exercises: [], sessions4: 0, setsWeek: {}, total: 0};
  const str = acts.filter(a => a.kind === 'strength' && a.start <= today).sort((a,b) => a.start - b.start);
  out.total = str.length;
  for (let w = weeks-1; w >= 0; w--){
    const ws = new Date(m0); ws.setDate(ws.getDate() - 7*w); const we = new Date(ws); we.setDate(we.getDate() + 7);
    const inW = str.filter(a => a.start >= ws.getTime() && a.start < we.getTime());
    const muscles = {}; let sets = 0, tonnage = 0;
    for (const a of inW) for (const x of (a.sets || [])){
      sets++; if (x.kg > 0 && x.reps > 0) tonnage += x.kg * x.reps;
      for (const [g, f] of Object.entries((EX_CATS[x.cat] || EX_CATS[65534])[1])) muscles[g] = (muscles[g] || 0) + f;
    }
    out.weeks.push({start: ws.getTime(), sessions: inW.length, minutes: inW.reduce((s,a) => s + (a.timer||0)/60, 0), sets, tonnage: Math.round(tonnage), muscles});
  }
  out.sessions4 = out.weeks.slice(-5, -1).reduce((s,w) => s + w.sessions, 0) / 4;
  // Muskelgruppen der letzten 7 Tage
  for (const a of str) if (today - a.start < 7*DAY) for (const x of (a.sets || []))
    for (const [g, f] of Object.entries((EX_CATS[x.cat] || EX_CATS[65534])[1])) out.setsWeek[g] = (out.setsWeek[g] || 0) + f;
  // Entwicklung pro Übung
  const ex = {};
  for (const a of str) for (const x of (a.sets || [])){
    if (x.cat == null || x.cat === 31 || x.cat === 32) continue;
    const key = x.cat + ':' + (x.sub != null ? x.sub : (x.name || ''));
    const e = ex[key] = ex[key] || {key, cat: x.cat, sub: x.sub, name: x.name || exerciseName(x.cat, x.sub), label: catName(x.cat), hist: {}};
    const h = e.hist[a.id] = e.hist[a.id] || {start: a.start, sets: 0, reps: 0, topKg: 0, best: 0, volume: 0, dur: 0};
    h.sets++; h.reps += x.reps || 0; if (x.reps == null && x.dur) h.dur += x.dur; h.topKg = Math.max(h.topKg, x.kg || 0); h.volume += (x.kg || 0) * (x.reps || 0);
    const r = e1rm(x.kg, x.reps); if (r) h.best = Math.max(h.best, r);
  }
  out.exercises = Object.values(ex).map(e => {
    const hist = Object.values(e.hist).sort((a,b) => a.start - b.start).map(h => ({...h, best: Math.round(h.best*10)/10, volume: Math.round(h.volume)}));
    const withKg = hist.filter(h => h.best > 0), last = hist[hist.length-1];
    let trend = null;
    if (withKg.length >= 2){ const f = withKg[0].best, l = withKg[withKg.length-1].best; trend = Math.round((l - f)/f*1000)/10; }
    return {key: e.key, cat: e.cat, sub: e.sub, name: e.name, label: e.label, hist, last: last.start, count: hist.length, trend};
  }).sort((a,b) => b.last - a.last || b.count - a.count);
  return out;
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
const WD_LONG = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
function buildPlan(ctx){
  const {S, acts, der, P, paces, series, today = Date.now()} = ctx;
  const goal = S.goal === 'hm' ? 'hm' : 'm';
  const nRuns = Math.min(6, Math.max(3, +S.runsPerWeek || 4));
  // Vorschau der nächsten Woche: Umfang aus dem aktuellen Stand ableiten (die laufende Woche ist noch nicht fertig)
  const volRef = ctx.preview ? today - 7*DAY : today;
  const wk = weeklyKm(acts, 9, volRef);
  const done = wk.slice(0, 8);            // abgeschlossene Wochen
  const last4 = done.slice(-4), vol4 = last4.reduce((s,w)=>s+w.km,0)/4;
  const peak8 = Math.max(0, ...done.map(w=>w.km));
  const longest6 = Math.max(0, ...acts.filter(a => a.isRun && volRef - a.start < 42*DAY && a.start <= today).map(a => a.dist/1000));
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
  const b = P.bounds || zoneBounds(P, P.zoneModel);
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

  // Wochenraster: feste Termine (z. B. Fußball), langer Lauf, Qualität, lockere Läufe, Krafttraining
  const team = [...new Set((Array.isArray(S.teamDays) ? S.teamDays : []).map(Number).filter(d => d >= 0 && d <= 6))];
  const teamName = String(S.teamSport || 'Fußball').trim() || 'Fußball';
  const plan = Array(7).fill(null);
  for (const d of team) plan[d] = 'T';
  const isT = d => team.includes((d+7)%7);
  const free = d => !plan[d];
  // langer Lauf: Sonntag oder Samstag, möglichst nicht direkt nach einem festen Termin
  let Ld = [6,5].find(d => free(d) && !isT(d-1));
  if (Ld === undefined) Ld = [6,5,4,3,2,1,0].find(free);
  if (Ld !== undefined) plan[Ld] = 'L';
  // Qualität: nicht am Tag nach einem festen Termin, nicht direkt vor/nach dem langen Lauf, nie zwei Tage hintereinander
  const qWanted = Math.min(Q.length, Math.max(0, nRuns - 1));
  const qDays = [];
  const rules = [
    d => !isT(d-1) && !isT(d+1) && (d+1)%7 !== Ld && (d+6)%7 !== Ld,
    d => !isT(d-1) && (d+1)%7 !== Ld && (d+6)%7 !== Ld,
    d => !isT(d-1) && (d+1)%7 !== Ld
  ];
  // alle Kombinationen prüfen (max. 7 Tage): möglichst viele Einheiten, strengste Regel, bevorzugte Tage (Di, Do, Mi, Fr, Mo, Sa)
  const pref = [1,3,2,4,0,5], rank = d => { const i = pref.indexOf(d); return i < 0 ? 9 : i; };
  let bestQ = null;
  for (let want = qWanted; want > 0 && !bestQ; want--){
    for (let r = 0; r < rules.length && !bestQ; r++){
      const cand = pref.filter(d => free(d) && rules[r](d));
      const pick = (startIdx, chosen) => {
        if (chosen.length === want){ const score = chosen.reduce((s,d) => s + rank(d), 0); if (!bestQ || score < bestQ.score) bestQ = {days: [...chosen], score}; return; }
        for (let i = startIdx; i < cand.length; i++){ const d = cand[i]; if (chosen.some(x => Math.abs(x-d) <= 1)) continue; chosen.push(d); pick(i+1, chosen); chosen.pop(); }
      };
      pick(0, []);
    }
  }
  if (bestQ) bestQ.days.sort((a,b) => a-b).forEach((d, q) => { plan[d] = 'Q'+q; qDays.push(d); });
  // lockere Läufe auf die restlichen freien Tage
  let eLeft = Math.max(0, nRuns - (Ld !== undefined ? 1 : 0) - qDays.length);
  for (const d of [5,2,4,0,3,1,6]) if (eLeft > 0 && free(d)){ plan[d] = 'E'; eLeft--; }
  const nEasy = plan.filter(x => x === 'E').length;
  const qKm = qDays.reduce((s,d) => s + Q[+plan[d][1]].km, 0);
  const eKm = nEasy ? km(Math.min(16, Math.max(5, (V - (Ld !== undefined ? L : 0) - qKm)/nEasy))) : 0;
  const sessions = [];
  for (let d=0; d<7; d++){
    const t = plan[d];
    let item;
    if (!t) item = {day:d, type:'R', title:'Ruhetag', detail:'Frei oder lockeres Mobilisieren.', km:0};
    else if (t === 'T') item = {day:d, type:'T', title:teamName, detail:'Fester Termin, falls du hingehst. Zählt als harte Einheit – am Folgetag nur locker oder frei.', km:0, optional:true};
    else if (t === 'L') item = {day:d, type:'L', title:'Langer Lauf', detail:longDetail, tempo:longTempo, km:L};
    else if (t === 'E') item = {day:d, type:'E', title:'Lockerer Lauf', detail:'Im Gesprächstempo. Lieber zu langsam als zu schnell.', tempo:tempo('E', hrE), km:eKm};
    else { const q = Q[+t[1]]; item = {day:d, type:'Q', ...q}; }
    sessions.push(item);
  }
  if (qWanted > qDays.length) notes.push('Wegen deiner festen Termine passt diese Woche nur '+(qDays.length ? 'eine' : 'keine')+' Qualitätseinheit sinnvoll in den Plan.');
  if (team.length && qDays.length) notes.push(teamName+' ('+team.map(d => WD[d]).join(', ')+') zählt als harte Einheit. Deshalb liegt die Qualitätseinheit am '+qDays.map(d => WD_LONG[d]).join(' und ')+' und nie direkt am Tag danach. Fällt der Termin aus, schlägt dir „Heute“ am Folgetag einen lockeren Lauf vor.');

  // Rennwoche: Rennen am Wettkampftag einsetzen
  if (phase === 'Tapering' && wtr === 0 && raceTs){
    const rd = (new Date(raceTs).getDay()+6)%7;
    sessions[rd] = {day:rd, type:'W', title: goal==='m' ? 'Marathon' : 'Halbmarathon', detail:'Wettkampf! Erste Kilometer bewusst kontrolliert.', tempo: tempo(goal==='m'?'M':'HM', goal==='m'?hrM:hrHM), km: goal==='m'?42.2:21.1};
    if (rd > 0 && sessions[rd-1].type !== 'R') sessions[rd-1] = {day:rd-1, type:'E', title:'Kurzer Lockerer', detail:'20–25 min ganz locker, 3 kurze Steigerungen.', tempo:tempo('E',hrE), km:4};
    if (rd < 6) for (let d=rd+1; d<7; d++) sessions[d] = {day:d, type:'R', title:'Erholung', detail:'Nach dem Rennen: Pause oder Spaziergang.', km:0};
    for (const s of sessions){
      if (s.type === 'L'){ s.type='E'; s.title='Lockerer Lauf'; s.km = Math.min(s.km, 8); s.detail='Kurz und locker.'; }
      if (s.type === 'T' && s.day >= rd-3 && s.day < rd) s.detail = 'In der Wettkampfwoche lieber auslassen oder nur locker mitmachen – Verletzungsrisiko und Ermüdung vor dem Rennen vermeiden.';
    }
  }

  // Krafttraining: an Qualitätstagen nach dem Lauf („harte Tage hart“) oder an lockeren Tagen;
  // vor langen Läufen und Qualitätseinheiten nur Rumpf & Oberkörper, damit die Beine frisch bleiben.
  let nK = Math.min(3, Math.max(0, S.strengthPerWeek != null && S.strengthPerWeek !== '' ? +S.strengthPerWeek || 0 : 0));
  const lightK = recovery || fatigued || phase === 'Tapering';
  if (phase === 'Tapering' && wtr === 0) nK = 0; else if (lightK) nK = Math.min(nK, 1);
  const K = {
    full: {type:'K', focus:'full', title:'Krafttraining Ganzkörper', detail:'Nach dem Lauf oder mit ein paar Stunden Abstand: Kniebeuge, Rumänisches Kreuzheben, Ausfallschritte, Wadenheben, Rudern, Unterarmstütz. 3 Sätze à 6–10 Wiederholungen, 1–2 Wiederholungen Reserve. 35–45 min.'},
    core: {type:'K', focus:'core', title:'Rumpf & Oberkörper', detail:'Ohne schwere Beinübungen, damit die Beine am nächsten Tag frisch sind: Unterarmstütz, Seitstütz, Dead Bug, Rudern, Liegestütze. 2–3 Runden, 20–30 min.'},
    light: {type:'K', focus:'light', title:'Leichtes Krafttraining', detail:'Halbe Satzzahl, kein schweres Gewicht – nur Bewegung und Spannung erhalten. 20 min.'}
  };
  const kDays = [];
  for (let k = 0; k < nK; k++){
    let best = null;
    for (let d = 0; d < 7; d++){
      const t = sessions[d].type, next = d < 6 ? sessions[d+1].type : null;
      if (t === 'T' || t === 'L' || t === 'W' || kDays.some(x => Math.abs(x-d) <= 1)) continue;
      const beforeHard = next === 'L' || next === 'Q' || next === 'T' || next === 'W';
      let score, focus;
      if (t === 'Q'){ score = 3; focus = beforeHard ? 'core' : 'full'; }
      else if (next === 'L'){ score = d === 5 ? 2.5 : 1; focus = 'core'; }  // Samstag: lockerer Lauf + Rumpf/Oberkörper
      else if (beforeHard){ score = 0.8; focus = 'core'; }
      else if (isT(d-1)){ score = 0.7; focus = 'core'; }
      else if (t === 'E'){ score = 2; focus = 'full'; }
      else { score = 1.5; focus = 'full'; }
      if (!best || score > best.score) best = {d, score, focus};
    }
    if (!best) break;
    kDays.push(best.d);
    const ks = {...K[lightK ? 'light' : best.focus]};
    const sd = sessions[best.d];
    if (sd.type === 'R') sessions[best.d] = {day:best.d, km:0, ...ks};
    else sd.extra = [ks];
  }
  if (nK > 0){
    const k28 = acts.filter(a => a.kind === 'strength' && today - a.start < 28*DAY && a.start <= today).length;
    if (k28 < nK * 2) notes.push('Krafttraining: '+k28+' Einheit'+(k28 === 1 ? '' : 'en')+' in den letzten 4 Wochen. Zwei kurze Einheiten pro Woche für Beine, Hüfte und Rumpf machen dich robuster und ökonomischer.');
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
  const tt = parseGoalTime(S.targetTime);
  if (tt > 0 && ctx.vd){
    const dist = goal === 'm' ? 42195 : 21097.5, need = vdotFrom(dist, tt), pred = predictTime(dist, ctx.vd.vdot);
    const diff = need - ctx.vd.vdot;
    goalCheck = {need, pred, pace: tt/(dist/1000), verdict: diff <= 0 ? 'Laut aktueller Form realistisch.' : diff <= 2 ? 'Ambitioniert, aber mit gutem Aufbau erreichbar.' : 'Sehr ambitioniert – dafür fehlen aktuell rund '+diff.toFixed(1)+' VDOT-Punkte.'};
  }

  // Heute
  const tIdx = (new Date(today).getDay()+6)%7;
  const todays = acts.filter(a => dayKey(a.start) === dayKey(today));
  const yest = acts.filter(a => dayKey(a.start) === dayKey(today - DAY));
  const yHard = yest.some(a => der[a.id] && (der[a.id].zs[3]+der[a.id].zs[4] >= 600 || (a.te||0) >= 3.5 || (a.kind === 'team' && a.timer >= 2700)));
  let todayRec = {...sessions[tIdx]};
  const yPlan = sessions[(tIdx+6)%7];
  if (todays.length){
    const k = todays.filter(a=>a.isRun).reduce((s,a)=>s+a.dist/1000,0);
    const kOpen = todayRec.extra && todayRec.extra.length && !todays.some(a => a.kind === 'strength') ? todayRec.extra[0] : null;
    todayRec = {type:'X', title:'Heute schon erledigt', detail: todays.length+' Aktivität(en)'+(k>0?', '+k.toFixed(1).replace('.',',')+' km gelaufen':'')+'.'+(kOpen ? ' Wenn du magst, steht noch „'+kOpen.title+'“ an.' : ' Gute Erholung!'), km:0};
  }
  else if (tIdx > 0 && yPlan.type === 'T' && !yest.length && (todayRec.type === 'R' || todayRec.type === 'K'))
    todayRec = {type:'E', title:'Lockerer Lauf', detail:'Gestern kein '+teamName+'? Dann passt heute ein lockerer Lauf.'+(todayRec.type === 'K' ? ' Das Krafttraining kannst du danach trotzdem machen.' : ''), tempo:tempo('E', hrE), km:Math.max(5, Math.min(eKm || 8, 8)), extra: todayRec.type === 'K' ? [{...todayRec}] : undefined};
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


/* ---------------- Krafttraining verknüpfen ----------------
   Eine von Hand eingetragene Krafteinheit und eine Uhr-Aufzeichnung gehören zusammen, wenn sie sich zeitlich
   überschneiden oder höchstens 30 Minuten auseinander beginnen. */
function sameSession(a, b, tolMin = 30){
  const a1 = a.start + (a.timer || 0)*1000, b1 = b.start + (b.timer || 0)*1000;
  return (a.start < b1 && b.start < a1) || Math.abs(a.start - b.start) <= tolMin*60000;
}
function findStrengthPartner(act, acts){
  const want = act.src === 'manual' ? (x => x.src !== 'manual' && (x.kind === 'strength' || (x.sport === 10 || x.sport === 4))) : (x => x.src === 'manual' && x.kind === 'strength');
  return acts.find(x => x.id !== act.id && want(x) && sameSession(act, x)) || null;
}
// Herzfrequenz-Einzelwerte (Health) als 5-s-Stream für ein Zeitfenster; Lücken bis 3 min werden überbrückt
function hrSamples(W){
  if (!W || !W.hr) return [];
  return Object.keys(W.hr).map(k => [+k*1000, W.hr[k]]).sort((a,b) => a[0] - b[0]);
}
function hrStreamFromSamples(samples, start, end){
  let lo = 0, hi = samples.length;
  while (lo < hi){ const m = (lo+hi) >> 1; if (samples[m][0] < start - 180000) lo = m + 1; else hi = m; }
  const win = []; for (let i = lo; i < samples.length && samples[i][0] <= end + 60000; i++) win.push(samples[i]);
  if (win.filter(x => x[0] >= start && x[0] <= end).length < 3) return null;
  const st = {t:[], hr:[], v:[], c:[], d:[], a:[]};
  let j = 0;
  for (let t = start; t <= end; t += 5000){
    while (j < win.length - 1 && win[j+1][0] <= t) j++;
    const p = win[j], q = win[j+1];
    let hr = 0;
    if (p && p[0] <= t){
      if (q && q[0] - p[0] <= 180000) hr = p[1] + (q[1] - p[1]) * (t - p[0]) / (q[0] - p[0]);   // zwischen zwei Werten interpolieren
      else if (t - p[0] <= 180000) hr = p[1];
    } else if (p && p[0] - t <= 60000) hr = p[1];
    st.t.push(Math.round((t - start)/1000)); st.hr.push(Math.round(hr)); st.v.push(0); st.c.push(0); st.d.push(0); st.a.push(null);
  }
  const have = st.hr.filter(x => x > 0);
  return have.length >= 30 ? {stream: st, avgHR: Math.round(have.reduce((a,b) => a+b, 0)/have.length), maxHR: Math.max(...have)} : null;
}
// Ergänzt von Hand eingetragene Krafteinheiten ohne Puls um Werte aus Health (nicht gespeichert, wird jedes Mal neu berechnet)
function attachHealthHR(acts, W){
  const S = hrSamples(W); let n = 0;
  if (!S.length) return 0;
  for (const a of acts){
    if (a.src !== 'manual' || a.hrSrc === 'watch' || !a.timer) continue;
    const r = hrStreamFromSamples(S, a.start, a.start + a.timer*1000);
    if (!r) continue;
    a.stream = r.stream; a.avgHR = r.avgHR; a.maxHR = r.maxHR; a.hrSrc = 'health'; n++;
  }
  return n;
}

/* ---------------- Laufschuhe ----------------
   shoes: [{id, name, startKm, limitKm, retired, since}] (Store „meta“, Schlüssel „shoes“)
   Zuordnung pro Lauf in annot[id].shoe (Schuh-ID oder 'none' = bewusst ohne Zuordnung) */
function shoeStats(shoes, acts, annot = {}){
  const runs = acts.filter(a => a.kind === 'run');
  return (shoes || []).map(sh => {
    const mine = runs.filter(a => annot[a.id] && annot[a.id].shoe === sh.id);
    const runKm = mine.reduce((s, a) => s + (a.dist || 0)/1000, 0);
    const km = (+sh.startKm || 0) + runKm, limit = +sh.limitKm || 700;
    return {...sh, km: Math.round(km*10)/10, runKm: Math.round(runKm*10)/10, runs: mine.length, limit,
      pct: Math.min(1.5, km/limit), last: mine.length ? Math.max(...mine.map(a => a.start)) : null};
  });
}
// Läufe, für die noch gefragt werden soll: ab Beginn der Schuh-Erfassung (ältere nicht, sonst wären es Hunderte)
function unassignedRuns(acts, annot = {}, since = 0){
  return acts.filter(a => a.kind === 'run' && a.start >= (since || 0) && !(annot[a.id] && annot[a.id].shoe)).sort((a,b) => b.start - a.start);
}

/* ---------------- Trainingszustand ----------------
   Kombiniert Belastungsverlauf (Fitness/Ermüdung), VO2max-Trend und weitere Signale zu einer klaren Aussage
   plus konkreten Punkten „Das verbessert sich“ und „Darauf achten“. */
function trainingStatus(ctx){
  const {acts, der, series, S = {}, W, vo2, today = Date.now(), rec} = ctx;
  const better = [], watch = [];
  const recent = acts.filter(a => today - a.start < 28*DAY && a.start <= today);
  const avg = arr => arr.length ? arr.reduce((x,y)=>x+y,0)/arr.length : null;
  const pct = (a, b) => b ? (a - b)/b*100 : 0;
  const f1 = x => (Math.round(x*10)/10).toFixed(1).replace('.', ',');
  if (recent.length < 3 || !series.length)
    return {key:'none', label:'Zu wenig Daten', tone:'neutral', text:'Für eine Einschätzung braucht es mindestens drei Einheiten in den letzten vier Wochen.', better, watch, acwr:null};

  const cur = series[series.length-1], past = series[Math.max(0, series.length-29)];
  const acwr = cur.ctl > 5 ? cur.atl/cur.ctl : 1, rel = cur.ctl > 5 ? cur.tsb/cur.ctl : 0;
  const ctlChg = past && past.ctl > 3 ? pct(cur.ctl, past.ctl) : null;
  const vd = vo2 && vo2.delta;
  let raceSoon = false;
  if (S.raceDate){ const r = new Date(S.raceDate+'T12:00').getTime(); raceSoon = r >= today - DAY && r - today < 21*DAY; }

  let key, label, tone, text;
  if (acwr > 1.5 || rel < -0.4){ key='over'; label='Überlastet'; tone='bad'; text='Die Belastung der letzten Tage liegt deutlich über dem, was du gewohnt bist. Jetzt bringt Erholung mehr als zusätzliches Training.'; }
  else if (ctlChg !== null && ctlChg < -25 && acwr < 0.8){ key='detrain'; label='Formverlust'; tone='warn'; text='Du trainierst seit einigen Wochen deutlich weniger. Die Fitness sinkt – mit regelmäßigen lockeren Einheiten baust du sie wieder auf.'; }
  else if (raceSoon && rel > 0.05 && (vd === null || vd >= -0.5)){ key='peak'; label='Topform'; tone='good'; text='Ermüdung ist abgebaut, die Fitness ist da. Gute Voraussetzungen für deinen Wettkampf.'; }
  else if (acwr < 0.8){ key='recovery'; label='Erholung'; tone='neutral'; text='Die Belastung ist gerade niedriger als gewohnt. Gut nach harten Wochen – auf Dauer aber zu wenig für Fortschritt.'; }
  else if (vd !== null && vd >= 0.5){ key='productive'; label='Produktiv'; tone='good'; text='Dein Training wirkt: Die geschätzte VO2max steigt bei passender Belastung.'; }
  else if (vd !== null && vd <= -0.8){ key='unproductive'; label='Unproduktiv'; tone='warn'; text='Du trainierst normal, aber die geschätzte VO2max sinkt. Häufige Gründe: zu wenig Erholung, Schlafmangel, Stress oder Krankheit.'; }
  else if (ctlChg !== null && ctlChg > 8){ key='building'; label='Aufbau'; tone='good'; text='Deine Fitness steigt, die Belastung ist im Rahmen. Weiter so, aber Entlastungswochen einplanen.'; }
  else { key='maintain'; label='Stabil'; tone='neutral'; text='Deine Fitness hält sich. Für Fortschritt braucht es einen etwas höheren Umfang oder gezielte Qualitätseinheiten.'; }

  // --- Signale: was verbessert sich, worauf achten
  if (vd !== null){
    if (vd >= 0.3) better.push({t:'VO2max steigt', d:`Geschätzt ${f1(vo2.cur)} (vor einem Monat ${f1(vo2.prev)}).`});
    else if (vd <= -0.5) watch.push({t:'VO2max sinkt', d:`Geschätzt ${f1(vo2.cur)} (vor einem Monat ${f1(vo2.prev)}). Kann auch an Hitze oder Müdigkeit liegen.`});
  }
  if (ctlChg !== null){
    if (ctlChg > 5) better.push({t:'Fitness wächst', d:`Fitnesswert +${Math.round(ctlChg)} % in vier Wochen.`});
    else if (ctlChg < -10) watch.push({t:'Fitness sinkt', d:`Fitnesswert ${Math.round(ctlChg)} % in vier Wochen.`});
  }
  if (acwr > 1.3 && key !== 'over') watch.push({t:'Belastung steigt schnell', d:`Akut/Chronisch ${acwr.toFixed(2).replace('.', ',')} – über 1,3 steigt das Verletzungsrisiko.`});
  // Effizienz lockerer Läufe
  const efs = acts.filter(a => der[a.id] && der[a.id].ef && today - a.start < 70*DAY && a.start <= today).sort((a,b)=>a.start-b.start).map(a => der[a.id].ef);
  if (efs.length >= 6){
    const e = pct(avg(efs.slice(-3)), avg(efs.slice(-6, -3)));
    if (e > 2) better.push({t:'Lockere Läufe werden effizienter', d:`Bei gleichem Puls rund ${Math.round(e)} % schneller als zuvor.`});
    else if (e < -3) watch.push({t:'Effizienz lockerer Läufe sinkt', d:`Bei gleichem Puls rund ${Math.round(-e)} % langsamer – Ermüdung oder Wärme?`});
  }
  // Entkopplung langer Läufe
  const decs = acts.filter(a => der[a.id] && der[a.id].dec !== null && a.timer >= 3600 && today - a.start < 84*DAY && a.start <= today).sort((a,b)=>a.start-b.start).map(a => der[a.id].dec);
  if (decs.length >= 4){
    const d1 = avg(decs.slice(-2)), d0 = avg(decs.slice(-4, -2));
    if (d1 < d0 - 1.5) better.push({t:'Ausdauer auf langen Läufen', d:`Entkopplung von ${f1(d0)} % auf ${f1(d1)} % gesunken.`});
    else if (d1 > 5 && d1 > d0 + 1.5) watch.push({t:'Puls driftet auf langen Läufen', d:`Entkopplung zuletzt ${f1(d1)} %. Langsamer starten, unterwegs trinken.`});
  }
  // langer Lauf
  const longest = (from, to) => Math.max(0, ...acts.filter(a => a.isRun && today - a.start >= from*DAY && today - a.start < to*DAY).map(a => a.dist/1000));
  const l1 = longest(0, 28), l0 = longest(28, 56);
  if (l1 >= 12 && l1 > l0 + 1.5) better.push({t:'Längere lange Läufe', d:`Längster Lauf ${f1(l1)} km (Monat davor ${f1(l0)} km).`});
  // Umfang
  const wk = weeklyKm(acts, 9, today).slice(0, 8), v1 = avg(wk.slice(4).map(w=>w.km)), v0 = avg(wk.slice(0,4).map(w=>w.km));
  const lastW = wk[wk.length-1] ? wk[wk.length-1].km : 0;
  if (v0 > 5 && v1 > v0*1.1 && v1 < v0*1.35) better.push({t:'Umfang steigt kontrolliert', d:`Ø ${Math.round(v1)} km pro Woche (vorher ${Math.round(v0)} km).`});
  if (v1 > 5 && lastW > v1*1.3) watch.push({t:'Sprung im Wochenumfang', d:`Letzte Woche ${Math.round(lastW)} km statt Ø ${Math.round(v1)} km. Mehr als 10–15 % pro Woche ist riskant.`});
  // Zonenverteilung
  const z = [0,0,0,0,0]; for (const a of recent) if (der[a.id]) der[a.id].zs.forEach((v,i) => z[i] += v);
  const zt = z.reduce((x,y)=>x+y,0);
  if (zt > 3600){
    const easy = (z[0]+z[1])/zt, grey = z[2]/zt;
    if (grey > 0.25) watch.push({t:'Zu viel „Grauzone“', d:`${Math.round(grey*100)} % deiner Zeit in Zone 3. Lockere Läufe lockerer, harte Einheiten gezielter.`});
    else if (easy >= 0.72) better.push({t:'Gute Intensitätsverteilung', d:`${Math.round(easy*100)} % deiner Zeit locker (Z1–Z2).`});
  }
  // Regelmäßigkeit
  const runsW = []; for (let w = 1; w <= 4; w++) runsW.push(acts.filter(a => a.isRun && today - a.start >= (w-1)*7*DAY && today - a.start < w*7*DAY).length);
  const target = Math.min(6, Math.max(3, +S.runsPerWeek || 4));
  if (runsW.every(x => x >= target - 1)) better.push({t:'Regelmäßig trainiert', d:`In allen vier Wochen ${Math.min(...runsW)}–${Math.max(...runsW)} Läufe.`});
  else if (runsW.filter(x => x < target - 1).length >= 2) watch.push({t:'Unregelmäßiges Training', d:`Läufe pro Woche zuletzt: ${runsW.slice().reverse().join(', ')}. Regelmäßigkeit bringt mehr als einzelne lange Einheiten.`});
  // Erholungswerte
  if (rec && rec.streak >= 3) watch.push({t:'Ruhepuls erhöht', d:`Seit ${rec.streak} Tagen deutlich über deinem Schnitt.`});
  if (W){
    const sl = []; for (let i = 0; i < 7; i++){ const x = sleepOf(W, dayKey(today - i*DAY)); if (x) sl.push(x.tot); }
    const tgt = (parseNum(S.sleepTarget) || 7.5)*60;
    if (sl.length >= 5){ const a = avg(sl); if (a < tgt - 30) watch.push({t:'Zu wenig Schlaf', d:`Ø ${fmtHM(a)} in den letzten Nächten (Ziel ${fmtHM(tgt)}).`}); else if (a >= tgt - 10) better.push({t:'Ausreichend Schlaf', d:`Ø ${fmtHM(a)} in den letzten Nächten.`}); }
    const base = rhrBaseline(W, dayKey(today)), r7 = []; for (let i = 0; i < 7; i++){ const x = rhrOf(W, dayKey(today - i*DAY)); if (x != null) r7.push(x); }
    if (base && r7.length >= 4 && avg(r7) < base - 1.5) better.push({t:'Ruhepuls sinkt', d:`Ø ${Math.round(avg(r7))} bpm, Schnitt ${Math.round(base)} bpm.`});
  }
  // Krafttraining
  const kWant = S.strengthPerWeek != null ? +S.strengthPerWeek : 0;
  const k14 = acts.filter(a => a.kind === 'strength' && today - a.start < 14*DAY && a.start <= today).length;
  if (kWant > 0){
    if (k14 === 0) watch.push({t:'Krafttraining fehlt', d:'In den letzten zwei Wochen keine Krafteinheit. Kraft für Beine, Hüfte und Rumpf schützt vor Verletzungen.'});
    else if (k14 >= kWant*2 - 1) better.push({t:'Krafttraining regelmäßig', d:`${k14} Einheiten in zwei Wochen.`});
  }
  return {key, label, tone, text, better: better.slice(0, 6), watch: watch.slice(0, 6), acwr, ctlChg};
}

// Die nächsten 7 Tage ab heute: Tage dieser Woche aus dem aktuellen Plan, danach aus der Vorschau der nächsten Woche
function nextSevenDays(cur, next, today = Date.now()){
  const out = [], t0 = new Date(today); t0.setHours(12, 0, 0, 0);
  const tIdx = (t0.getDay()+6)%7;
  for (let i = 0; i < 7; i++){
    const d = new Date(t0); d.setDate(d.getDate() + i);
    const wd = (d.getDay()+6)%7, fromNext = tIdx + i > 6;
    const src = fromNext ? next : cur;
    const s = src && src.sessions[wd];
    if (!s) continue;
    out.push({...s, ts: d.getTime(), offset: i, preview: fromNext, phase: src.phase, recovery: src.recovery});
  }
  return out;
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
    else if (p[0] === 'H' && p.length >= 3) recs.push({k:'H', t:parseHKDate(p[1]), v:parseNum(p[2]), src:p[3] || ''}); // Herzfrequenz (optional, ab 2.3)
  }
  return recs;
}
function xmlAttr(line, name){ const i = line.indexOf(' '+name+'="'); if (i < 0) return null; const st = i + name.length + 3; return line.slice(st, line.indexOf('"', st)); }
function parseHealthXmlLine(line, recs){
  if (line.indexOf('<Record') < 0) return;
  if (line.indexOf('HKQuantityTypeIdentifierRestingHeartRate"') >= 0) recs.push({k:'R', t:parseHKDate(xmlAttr(line,'startDate')), v:parseNum(xmlAttr(line,'value')), src:xmlAttr(line,'sourceName') || ''});
  else if (line.indexOf('HKQuantityTypeIdentifierHeartRate"') >= 0){ const t = parseHKDate(xmlAttr(line,'startDate')); if (t && Date.now() - t < HR_KEEP_DAYS*DAY) recs.push({k:'H', t, v:parseNum(xmlAttr(line,'value')), src:xmlAttr(line,'sourceName') || ''}); }
  else if (line.indexOf('HKCategoryTypeIdentifierSleepAnalysis"') >= 0) recs.push({k:'S', s:parseHKDate(xmlAttr(line,'startDate')), e:parseHKDate(xmlAttr(line,'endDate')), kind:sleepKind(xmlAttr(line,'value')), src:xmlAttr(line,'sourceName') || ''});
}
function newWellness(){ return {rhr:{}, sleep:{}, hr:{}}; }
const HR_KEEP_DAYS = 21; // Herzfrequenz-Einzelwerte aus Health nur 3 Wochen aufbewahren (für Krafttraining ohne Uhr-Aufzeichnung)
const sleepTotal = x => x.deep + x.rem + x.core + x.asleep;
function ingestWellness(W, recs, today = Date.now()){
  const cutoff = today - 730*DAY, nights = {}, seen = new Set(); let nr = 0, nh = 0;
  const hrCut = today - HR_KEEP_DAYS*DAY;
  for (const r of recs){
    if (r.k === 'H'){
      if (!r.t || r.t < hrCut || r.t > today + DAY || !(r.v >= 30 && r.v <= 230)) continue;
      (W.hr = W.hr || {})[Math.round(r.t/1000)] = Math.round(r.v); nh++; continue;
    }
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
  if (W.hr) for (const k in W.hr) if (+k*1000 < hrCut) delete W.hr[k];
  return {rhr:nr, nights:Object.keys(nights).length, hr:nh};
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
// Zielzeit für HM/Marathon: „3:15“ bedeutet hier 3 h 15 min (unter 10 h ist mm:ss unplausibel)
function parseGoalTime(str){
  const p = String(str == null ? '' : str).trim().split(':').map(Number);
  if (p.length === 2 && !p.some(isNaN) && p[0] < 10) return p[0]*3600 + p[1]*60;
  return parseDuration(str);
}
// Sekunden -> [Stunden, Minuten, Sekunden] als Texte für die Eingabefelder
function splitDuration(sec){
  if (!(sec > 0)) return ['', '', ''];
  sec = Math.round(sec);
  return [String(Math.floor(sec/3600)), String(Math.floor(sec%3600/60)).padStart(2,'0'), String(sec%60).padStart(2,'0')];
}
// Eingabefelder -> „h:mm:ss“; leer -> ''; ungültig (keine Zahl, Minuten/Sekunden > 59) -> null
function joinDuration(h, m, s){
  const raw = [h, m, s].map(x => String(x == null ? '' : x).trim());
  if (raw.every(x => x === '')) return '';
  if (raw.some(x => x !== '' && !/^\d{1,3}$/.test(x))) return null;
  const [hh, mm, ss] = raw.map(x => x === '' ? 0 : parseInt(x, 10));
  if (mm > 59 || ss > 59) return null;
  if (hh + mm + ss === 0) return '';
  return hh + ':' + String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
}

if (typeof module !== 'undefined') module.exports = {APP_VERSION, SCHEMA, SPORTS, KINDS, KIND_COLORS, buildActivities, sportKind, sportName, normalizeAct, rpeFactor, RPE_K_DEFAULT, vo2maxRun, vo2Trend, median, trainingStatus, shoeStats, unassignedRuns, nextSevenDays, sameSession, findStrengthPartner, hrSamples, hrStreamFromSamples, attachHealthHR, HR_KEEP_DAYS, MUSCLES, EX_CATS, EX_PICK, exerciseName, catName, e1rm, strengthSummary, parseShortcutText, parseHealthXmlLine, ingestWellness, newWellness, recovery, sleepOf, rhrOf, rhrBaseline, parseHKDate, sleepKind, dayKey, shiftDay, fmtHM, parseFit, buildActivity, estimateParams, derive, vdotFrom, predictTime, trainingPaces, estimateVdot, loadSeries, weeklyKm, buildPlan, fmtPace, fmtDur, hrBounds, zoneBounds, ZONE_MODELS, zoneOf, parseDuration, parseGoalTime, splitDuration, joinDuration, bestByDistance, bestByTime, mondayOf};

