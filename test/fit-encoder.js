// Kleiner FIT-Encoder für Tests: erzeugt synthetische Garmin-Dateien ohne echte Nutzerdaten.
// Unterstützt normale und komprimierte Zeitstempel-Header, Big-Endian, Entwicklerfelder
// und Array-/Textfelder (für die Robustheit des Parsers).

const FIT_EPOCH_OFFSET = 631065600;
// Basistypen: Name -> [Größe, Basistyp-Byte, ungültiger Wert]
const T = {
  enum:   [1, 0x00, 0xFF], s8:  [1, 0x01, 0x7F], u8:  [1, 0x02, 0xFF],
  s16:    [2, 0x83, 0x7FFF], u16: [2, 0x84, 0xFFFF], s32: [4, 0x85, 0x7FFFFFFF],
  u32:    [4, 0x86, 0xFFFFFFFF], str: [1, 0x07, 0], f32: [4, 0x88, null],
  u8z:    [1, 0x0A, 0], u16z: [2, 0x8B, 0], u32z: [4, 0x8C, 0]
};

const toFitTs = ms => Math.round(ms/1000) - FIT_EPOCH_OFFSET;
const SEMI = 180 / 2147483648;

class FitWriter {
  constructor({bigEndian = false} = {}){ this.be = bigEndian; this.bytes = []; this.defs = {}; }
  u8(v){ this.bytes.push(v & 0xFF); }
  num(type, v){
    const [size] = T[type], b = new ArrayBuffer(size), dv = new DataView(b), le = !this.be;
    switch (type){
      case 'enum': case 'u8': case 'u8z': dv.setUint8(0, v); break;
      case 's8': dv.setInt8(0, v); break;
      case 'u16': case 'u16z': dv.setUint16(0, v, le); break;
      case 's16': dv.setInt16(0, v, le); break;
      case 'u32': case 'u32z': dv.setUint32(0, v, le); break;
      case 's32': dv.setInt32(0, v, le); break;
      case 'f32': dv.setFloat32(0, v, le); break;
    }
    for (const x of new Uint8Array(b)) this.u8(x);
  }
  // fields: [{num, type, count?}] – count > 1 ergibt ein Array-Feld, bei 'str' die Länge in Bytes
  // dev: [{num, size, devIdx}] – Entwicklerfelder
  define(local, gnum, fields, dev = []){
    this.u8(0x40 | (dev.length ? 0x20 : 0) | local);
    this.u8(0); this.u8(this.be ? 1 : 0);
    const g = new DataView(new ArrayBuffer(2)); g.setUint16(0, gnum, !this.be);
    this.u8(g.getUint8(0)); this.u8(g.getUint8(1));
    this.u8(fields.length);
    for (const f of fields){ const [size, bt] = T[f.type]; this.u8(f.num); this.u8(size * (f.count || 1)); this.u8(bt); }
    if (dev.length){ this.u8(dev.length); for (const d of dev){ this.u8(d.num); this.u8(d.size); this.u8(d.devIdx || 0); } }
    this.defs[local] = {fields, dev};
    return this;
  }
  // values: {Feldnummer: Wert}; fehlende Werte werden als „ungültig“ geschrieben
  data(local, values, {compressedOffset = null} = {}){
    const def = this.defs[local];
    if (compressedOffset !== null) this.u8(0x80 | (local << 5) | (compressedOffset & 0x1F));
    else this.u8(local);
    for (const f of def.fields){
      const [size, , inv] = T[f.type], n = f.count || 1, v = values[f.num];
      if (f.type === 'str'){
        const enc = new TextEncoder().encode(v || '');
        for (let i=0;i<n;i++) this.u8(i < enc.length ? enc[i] : 0);
        continue;
      }
      const arr = Array.isArray(v) ? v : [v];
      for (let i=0;i<n;i++){
        const x = arr[i];
        if (x == null) { if (inv === null) this.num(f.type, NaN); else this.num(f.type, inv); }
        else this.num(f.type, x);
      }
      void size;
    }
    for (const d of def.dev) for (let i=0;i<d.size;i++) this.u8(0xAB);
    return this;
  }
  build({truncateBy = 0} = {}){
    const body = this.bytes, dataSize = body.length;
    const out = new Uint8Array(14 + dataSize + 2);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, 14); dv.setUint8(1, 0x20); dv.setUint16(2, 2132, true); dv.setUint32(4, dataSize, true);
    out.set([0x2E, 0x46, 0x49, 0x54], 8); // ".FIT"
    dv.setUint16(12, 0, true);
    out.set(body, 14);
    // CRC wird vom Parser nicht geprüft
    const len = out.length - truncateBy;
    return out.buffer.slice(0, len);
  }
}

// Erzeugt eine komplette Laufaktivität.
// opts: start (ms), seconds, speed (m/s oder Funktion t->m/s), hr (Zahl oder Funktion t->bpm),
//       sport, subSport, step (Sekunden zwischen Records), bigEndian, compressed, devFields,
//       noSession, watch {lthr, maxHR, rest, sex}, cadence
function makeActivity(opts = {}){
  const start = opts.start != null ? opts.start : Date.UTC(2026, 8, 1, 6, 0, 0);
  const seconds = opts.seconds || 1800, step = opts.step || 1;
  const spd = typeof opts.speed === 'function' ? opts.speed : () => (opts.speed != null ? opts.speed : 3.33);
  const hrF = typeof opts.hr === 'function' ? opts.hr : () => opts.hr;
  const sport = opts.sport != null ? opts.sport : 1, sub = opts.subSport != null ? opts.subSport : 0;
  const w = new FitWriter({bigEndian: opts.bigEndian});
  const ts0 = toFitTs(start);

  w.define(0, 0, [{num:0, type:'enum'}, {num:1, type:'u16'}, {num:4, type:'u32'}, {num:8, type:'str', count:8}]);
  w.data(0, {0:4, 1:1, 4:ts0, 8:'FR265'});
  if (opts.watch){
    const wa = opts.watch;
    w.define(1, 3, [{num:1, type:'enum'}, {num:8, type:'u8'}]);
    w.data(1, {1: wa.sex === 'f' ? 0 : (wa.sex === 'm' ? 1 : null), 8: wa.rest});
    w.define(1, 7, [{num:1, type:'u8'}, {num:2, type:'u8'}]);
    w.data(1, {1: wa.maxHR, 2: wa.lthr});
  }
  const dev = opts.devFields ? [{num:0, size:2}, {num:1, size:4}] : [];
  const recFields = [{num:253, type:'u32'}, {num:3, type:'u8'}, {num:5, type:'u32'}, {num:73, type:'u32'}, {num:4, type:'u8'}, {num:78, type:'u32'}];
  if (opts.gps) recFields.push({num:0, type:'s32'}, {num:1, type:'s32'});
  if (opts.profileName){ w.define(1, 12, [{num:0, type:'enum'}, {num:1, type:'enum'}, {num:3, type:'str', count:16}]); w.data(1, {0: sport, 1: sub, 3: opts.profileName}); }
  w.define(2, 20, recFields, dev);
  if (opts.compressed) w.define(3, 20, recFields.slice(1), dev);
  let dist = 0, hrSum = 0, hrN = 0, hrMax = 0;
  for (let t = 0; t <= seconds; t += step){
    if (t > 0) dist += spd(t) * step;
    const hr = hrF(t);
    if (hr){ hrSum += hr; hrN++; hrMax = Math.max(hrMax, hr); }
    const v = {253: ts0 + t, 3: hr || null, 5: Math.round(dist*100), 73: Math.round(spd(t)*1000), 4: opts.cadence || 85, 78: Math.round(((opts.alt ? opts.alt(t, dist) : 100)+500)*5)};
    if (opts.gps){ const [la, lo] = opts.gps(t, dist); v[0] = Math.round(la / SEMI); v[1] = Math.round(lo / SEMI); }
    if (opts.compressed && t % 60 !== 0) w.data(3, v, {compressedOffset: (ts0 + t) & 0x1F});
    else w.data(2, v);
  }
  if (opts.laps){ // [{t0, dur, dist, hr}]
    w.define(5, 19, [{num:253, type:'u32'}, {num:2, type:'u32'}, {num:7, type:'u32'}, {num:8, type:'u32'}, {num:9, type:'u32'}, {num:15, type:'u8'}, {num:110, type:'u32'}, {num:24, type:'enum'}]);
    for (const l of opts.laps) w.data(5, {253: ts0 + l.t0 + l.dur, 2: ts0 + l.t0, 7: l.dur*1000, 8: l.dur*1000, 9: Math.round(l.dist*100), 15: l.hr || null, 110: Math.round(l.dist/l.dur*1000), 24: 2});
  }
  if (opts.sets){ // [{t0, dur, reps, kg, cat, sub, rest}]
    w.define(6, 225, [{num:254, type:'u32'}, {num:0, type:'u32'}, {num:3, type:'u16'}, {num:4, type:'u16'}, {num:5, type:'u8'}, {num:6, type:'u32'}, {num:7, type:'u16', count:2}, {num:8, type:'u16', count:2}]);
    for (const x of opts.sets) w.data(6, {254: ts0 + x.t0 + x.dur, 0: x.dur*1000, 3: x.reps, 4: x.kg != null ? Math.round(x.kg*16) : null, 5: x.rest ? 0 : 1, 6: ts0 + x.t0, 7: x.cat != null ? [x.cat] : null, 8: x.sub != null ? [x.sub] : null});
  }
  if (!opts.noSession){
    w.define(4, 18, [{num:253, type:'u32'}, {num:2, type:'u32'}, {num:5, type:'enum'}, {num:6, type:'enum'},
      {num:7, type:'u32'}, {num:8, type:'u32'}, {num:9, type:'u32'}, {num:16, type:'u8'}, {num:17, type:'u8'}, {num:124, type:'u32'}]);
    w.data(4, {253: ts0 + seconds, 2: ts0, 5: sport, 6: sub, 7: seconds*1000, 8: seconds*1000, 9: Math.round(dist*100),
      16: hrN ? Math.round(hrSum/hrN) : null, 17: hrMax || null, 124: Math.round(dist/seconds*1000)});
  }
  return w.build({truncateBy: opts.truncateBy || 0});
}

module.exports = {FitWriter, makeActivity, toFitTs, FIT_EPOCH_OFFSET};
