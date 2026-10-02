/* ================= Interaktive Diagramme (eigenes SVG, keine Bibliothek) =================
   Bedienung:  Wischen (waagerecht) = Werte anzeigen · zwei Finger = zoomen/verschieben · Doppeltipp = zurücksetzen
               Maus: darüberfahren = Werte · Strg + Mausrad = zoomen · Ziehen = verschieben (wenn gezoomt)
   Diagramme mit derselben „group“ zeigen die Markierung synchron (z. B. HF, Pace und Karte einer Aktivität). */
const Charts = (() => {
  const reg = new Map(), listeners = [];
  let seq = 0;
  const W = 320; // interne Breite der SVG-Fläche (wird auf die echte Breite gestreckt)
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fin = v => v != null && isFinite(v);

  // spec: {series:[{v, c, w, bars, stack, dots, dash, op, name, fmt}], xs?, fmtX?, h, min, max, invert, zero, bands, label, group, title, unit}
  function html(spec){
    const n = Math.max(0, ...spec.series.map(s => s.v.length));
    if (!n || !spec.series.some(s => !s.hidden && s.v.some(fin))) return '<p class="muted small" style="margin:0">Noch keine Daten.</p>';
    const id = 'c' + (++seq);
    reg.set(id, {id, spec, n, i0: 0, i1: Math.max(1, n - 1), hover: null});
    const h = spec.h || 120;
    return `<div class="chart-box" data-chart="${id}" style="--ch:${h}px" role="img" aria-label="${escH(spec.label || 'Diagramm')}">
      <svg class="chart" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" style="height:${h}px">${draw(reg.get(id), h)}</svg>
      <div class="chart-tip" hidden></div>
      <button type="button" class="chart-reset" hidden aria-label="Zoom zurücksetzen">Zoom zurücksetzen</button>
      <button type="button" class="chart-full" aria-label="Diagramm im Vollbild öffnen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <div class="chart-axis"><span></span><span></span></div>
    </div>`;
  }

  function range(e){
    const {spec, n} = e, lo = Math.max(0, Math.floor(e.i0) - 1), hi = Math.min(n - 1, Math.ceil(e.i1) + 1);
    let mn = Infinity, mx = -Infinity;
    const stacked = spec.series.filter(s => s.stack);
    for (const s of spec.series){
      if (s.stack || s.hidden) continue;
      for (let i = lo; i <= hi; i++){ const v = s.v[i]; if (fin(v)){ if (v < mn) mn = v; if (v > mx) mx = v; } }
      if (s.bars){ mn = Math.min(mn, 0); }
    }
    if (stacked.length) for (let i = lo; i <= hi; i++){
      let sum = 0; for (const s of stacked) if (fin(s.v[i])) sum += s.v[i];
      mx = Math.max(mx, sum); mn = Math.min(mn, 0);
    }
    if (spec.min != null) mn = spec.min;
    if (spec.max != null) mx = spec.max;
    if (!isFinite(mn) || !isFinite(mx)){ mn = 0; mx = 1; }
    if (mx === mn){ mx += 1; mn -= 1; }
    return {mn, mx, lo, hi};
  }

  function draw(e, H){
    const {spec, n} = e, pad = 6, span = Math.max(1e-9, e.i1 - e.i0);
    const {mn, mx, lo, hi} = range(e);
    const X = i => n <= 1 ? W/2 : (i - e.i0) / span * W;
    const Y = v => { const f = (v - mn) / (mx - mn); return pad + (H - 2*pad) * (spec.invert ? f : 1 - f); };
    e.X = X; e.Y = Y; e.H = H;
    let g = '';
    if (spec.bands) for (const b of spec.bands){ if (b.to > mn && b.from < mx){ const y1 = Y(Math.min(b.to, mx)), y2 = Y(Math.max(b.from, mn)); g += `<rect x="0" y="${Math.min(y1,y2).toFixed(1)}" width="${W}" height="${Math.abs(y2-y1).toFixed(1)}" fill="${b.c}" opacity=".13"/>`; } }
    // feines Raster
    for (const f of [0.25, 0.5, 0.75]) g += `<line x1="0" x2="${W}" y1="${(pad + (H-2*pad)*f).toFixed(1)}" y2="${(pad + (H-2*pad)*f).toFixed(1)}" class="grid"/>`;
    if (spec.zero && mn < 0 && mx > 0) g += `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    const bw = Math.max(0.6, W / (span + 1) * 0.7);
    // gestapelte Balken
    const stacked = spec.series.filter(s => s.stack);
    if (stacked.length) for (let i = lo; i <= hi; i++){
      let base = 0;
      for (const s of stacked){ const v = s.v[i]; if (!fin(v) || v <= 0) continue;
        const y0 = Y(base), y1 = Y(base + v); base += v;
        g += `<rect x="${(X(i)-bw/2).toFixed(2)}" y="${Math.min(y0,y1).toFixed(1)}" width="${bw.toFixed(2)}" height="${Math.abs(y1-y0).toFixed(1)}" fill="${s.c}" opacity="${s.op || .9}"/>`; }
    }
    for (const s of spec.series){
      if (s.stack || s.hidden) continue;
      if (s.bars){ const y0 = Y(Math.max(mn, 0)); for (let i = lo; i <= hi; i++){ const v = s.v[i]; if (!fin(v)) continue; const y = Y(v);
        g += `<rect x="${(X(i)-bw/2).toFixed(2)}" y="${Math.min(y,y0).toFixed(1)}" width="${bw.toFixed(2)}" height="${Math.abs(y0-y).toFixed(1)}" fill="${s.c}" opacity="${s.op || .55}" rx="0"/>`; } continue; }
      if (s.dots){ for (let i = lo; i <= hi; i++){ const v = s.v[i]; if (fin(v)) g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.8" fill="${s.c}"/>`; } continue; }
      // Linie mit Min/Max-Verdichtung pro Pixel (bleibt auch bei langen Läufen flüssig)
      const pts = [], step = (hi - lo + 1) / (W * 1.5);
      if (step > 1){
        for (let b = lo; b <= hi; b += step){
          let a = null, z = null; const e2 = Math.min(hi, Math.floor(b + step));
          for (let i = Math.floor(b); i <= e2; i++){ const v = s.v[i]; if (!fin(v)) continue; if (!a || v < a[1]) a = [i, v]; if (!z || v > z[1]) z = [i, v]; }
          if (a && z){ if (a[0] <= z[0]) pts.push(a, z); else pts.push(z, a); } else pts.push(null);
        }
      } else for (let i = lo; i <= hi; i++) pts.push(fin(s.v[i]) ? [i, s.v[i]] : null);
      let d = '', pen = false;
      for (const p of pts){ if (!p){ pen = false; continue; } d += (pen ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); pen = true; }
      if (s.area && d){ const yb = Y(Math.max(mn, Math.min(mx, s.areaBase != null ? s.areaBase : mn)));
        const first = pts.find(Boolean), last = [...pts].reverse().find(Boolean);
        g += `<path d="${d}L${X(last[0]).toFixed(1)} ${yb.toFixed(1)}L${X(first[0]).toFixed(1)} ${yb.toFixed(1)}Z" fill="${s.c}" opacity=".12"/>`; }
      g += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${s.w || 2}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    g += `<g class="cross"></g>`;
    return g;
  }

  const xLabel = (e, i) => {
    const {spec} = e, k = Math.max(0, Math.min(e.n - 1, Math.round(i)));
    if (spec.fmtX) return spec.fmtX(spec.xs ? spec.xs[k] : k, k);
    return '';
  };
  function update(el, e){
    const svg = el.querySelector('svg.chart');
    svg.innerHTML = draw(e, e.spec.h || 120);
    const ax = el.querySelectorAll('.chart-axis span');
    ax[0].textContent = xLabel(e, e.i0); ax[1].textContent = xLabel(e, e.i1);
    const zoomed = e.i0 > 0.01 || e.i1 < e.n - 1.01;
    el.querySelector('.chart-reset').hidden = !zoomed;
    el.classList.toggle('zoomed', zoomed);
    if (e.hover != null) showCross(el, e, e.hover, true);
  }

  function showCross(el, e, i, quiet){
    const {spec} = e, k = Math.max(0, Math.min(e.n - 1, Math.round(i)));
    e.hover = k;
    const cross = el.querySelector('g.cross'), tip = el.querySelector('.chart-tip');
    if (!cross) return;
    if (k < e.i0 - 0.5 || k > e.i1 + 0.5){ cross.innerHTML = ''; tip.hidden = true; return; }
    const x = e.X(k);
    let g = `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${e.H}" class="cross-line"/>`;
    const rows = [];
    let base = 0;
    for (const s of spec.series){
      const v = s.v[k]; if (!fin(v)) continue;
      const yv = s.stack ? (base += v) : v;
      if (!s.bars && !s.stack && !s.hidden) g += `<circle cx="${x.toFixed(1)}" cy="${e.Y(yv).toFixed(1)}" r="3.6" fill="${s.c}" class="cross-dot"/>`;
      if (s.name) rows.push(`<span><b style="background:${s.c}"></b>${escH(s.name)} <strong>${escH(s.fmt ? s.fmt(v) : (Math.round(v*10)/10).toString().replace('.', ','))}</strong></span>`);
    }
    cross.innerHTML = g;
    const xl = xLabel(e, k);
    if (rows.length || xl){
      tip.innerHTML = (xl ? `<em>${escH(xl)}</em>` : '') + rows.join('');
      tip.hidden = false;
      // Anzeige neben die Markierung setzen, damit sie den Wert nicht verdeckt
      const bw = el.clientWidth, px = x / W * bw, tw = tip.offsetWidth;
      const left = px + 12 + tw <= bw ? px + 12 : px - 12 - tw;
      tip.style.left = Math.max(0, Math.min(bw - tw, left)) + 'px';
    }
    if (!quiet && spec.group){ const xv = spec.xs ? spec.xs[k] : k; for (const f of listeners) f(spec.group, xv, e.id); syncGroup(spec.group, xv, e.id); }
  }
  function hideCross(el, e){
    e.hover = null; const c = el.querySelector('g.cross'); if (c) c.innerHTML = ''; const t = el.querySelector('.chart-tip'); if (t) t.hidden = true;
  }
  function syncGroup(group, xv, from){
    for (const el of document.querySelectorAll('[data-chart]')){
      const e = reg.get(el.dataset.chart); if (!e || e.id === from || e.spec.group !== group) continue;
      const xs = e.spec.xs; let k = xv;
      if (xs){ let lo = 0, hi = xs.length - 1; while (lo < hi){ const m = (lo + hi) >> 1; if (xs[m] < xv) lo = m + 1; else hi = m; } k = lo; }
      showCross(el, e, k, true);
    }
  }

  function setWindow(el, e, i0, i1){
    const n1 = e.n - 1, minSpan = Math.min(n1, Math.max(4, n1 / 60));
    let span = Math.max(minSpan, Math.min(n1, i1 - i0));
    if (span >= n1 - 1e-6){ e.i0 = 0; e.i1 = Math.max(1, n1); }
    else { i0 = Math.max(0, Math.min(n1 - span, i0)); e.i0 = i0; e.i1 = i0 + span; }
    update(el, e);
  }

  function attach(el){
    if (el._chart) return; el._chart = true;
    const e = reg.get(el.dataset.chart); if (!e) return;
    update(el, e);
    const ptrs = new Map();
    let mode = null, start = null, lastTap = 0, raf = 0;
    const idxAt = clientX => { const r = el.getBoundingClientRect(); return e.i0 + (clientX - r.left) / r.width * (e.i1 - e.i0); };
    const frame = fn => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); };

    el.addEventListener('pointerdown', ev => {
      if (ev.target.closest('button')) return;
      ptrs.set(ev.pointerId, {x: ev.clientX, y: ev.clientY});
      if (ptrs.size === 2){
        const [a, b] = [...ptrs.values()];
        mode = 'pinch';
        start = {d: Math.max(20, Math.abs(a.x - b.x)), c: idxAt((a.x + b.x)/2), i0: e.i0, i1: e.i1, cx: (a.x + b.x)/2};
        try { el.setPointerCapture(ev.pointerId); } catch(_){}
        hideCross(el, e);
        return;
      }
      if (ptrs.size === 1){
        start = {x: ev.clientX, y: ev.clientY, i0: e.i0, i1: e.i1, t: Date.now()};
        mode = ev.pointerType === 'mouse' ? (el.classList.contains('zoomed') ? 'pan' : 'scrub') : 'pending';
        if (mode !== 'pending'){ try { el.setPointerCapture(ev.pointerId); } catch(_){} }
        if (mode === 'scrub') showCross(el, e, idxAt(ev.clientX));
      }
    });
    el.addEventListener('pointermove', ev => {
      if (ev.pointerType === 'mouse' && !ptrs.size){ frame(() => showCross(el, e, idxAt(ev.clientX))); return; }
      if (!ptrs.has(ev.pointerId)) return;
      ptrs.set(ev.pointerId, {x: ev.clientX, y: ev.clientY});
      if (mode === 'pending'){
        const dx = Math.abs(ev.clientX - start.x), dy = Math.abs(ev.clientY - start.y);
        if (dx > 6 && dx > dy){ mode = 'scrub'; try { el.setPointerCapture(ev.pointerId); } catch(_){} }
        else if (dy > 8){ mode = null; ptrs.delete(ev.pointerId); return; }
      }
      if (mode === 'scrub') frame(() => showCross(el, e, idxAt(ev.clientX)));
      else if (mode === 'pan'){ const r = el.getBoundingClientRect(), di = (ev.clientX - start.x) / r.width * (start.i1 - start.i0); frame(() => setWindow(el, e, start.i0 - di, start.i1 - di)); }
      else if (mode === 'pinch' && ptrs.size >= 2){
        const [a, b] = [...ptrs.values()], r = el.getBoundingClientRect();
        const d = Math.max(20, Math.abs(a.x - b.x)), cx = (a.x + b.x)/2;
        const span = (start.i1 - start.i0) * start.d / d;
        const f = (cx - r.left) / r.width;
        frame(() => setWindow(el, e, start.c - f * span, start.c - f * span + span));
      }
    });
    const end = ev => {
      if (!ptrs.has(ev.pointerId)) return;
      ptrs.delete(ev.pointerId);
      if (mode === 'pinch' && ptrs.size === 1){ const p = [...ptrs.values()][0]; start = {x: p.x, y: p.y, i0: e.i0, i1: e.i1, t: Date.now()}; mode = 'pan'; return; }
      if (!ptrs.size){
        if (ev.type === 'pointerup' && start && (mode === 'pending' || mode === 'scrub') && Math.abs(ev.clientX - start.x) < 8 && Date.now() - start.t < 300){
          const now = Date.now();
          if (now - lastTap < 320){ setWindow(el, e, 0, e.n - 1); hideCross(el, e); lastTap = 0; }
          else { lastTap = now; showCross(el, e, idxAt(ev.clientX)); }
        }
        mode = null;
      }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse' && !ptrs.size) hideCross(el, e); });
    el.addEventListener('wheel', ev => {
      if (!ev.ctrlKey && !ev.shiftKey) return; // normales Scrollen nicht abfangen
      ev.preventDefault();
      const c = idxAt(ev.clientX), k = Math.exp((ev.deltaY || ev.deltaX) * 0.01), span = (e.i1 - e.i0) * k, r = el.getBoundingClientRect(), f = (ev.clientX - r.left) / r.width;
      setWindow(el, e, c - f * span, c - f * span + span);
    }, {passive: false});
    el.querySelector('.chart-reset').addEventListener('click', () => { setWindow(el, e, 0, e.n - 1); hideCross(el, e); });
    el.querySelector('.chart-full').addEventListener('click', () => openFull(e));
  }

  // Vollbild-Ansicht eines Diagramms
  function openFull(e){
    const box = document.getElementById('zoom'); if (!box) return;
    const h = Math.round(Math.max(220, Math.min(window.innerHeight * 0.62, 560)));
    const spec = {...e.spec, h, group: e.spec.group ? e.spec.group + '-full' : null};
    const legend = spec.series.filter(s => s.name).map(s => `<span><b style="background:${s.c}"></b>${escH(s.name)}</span>`).join('');
    box.innerHTML = `<div class="zoom-bar"><h2>${escH(spec.title || spec.label || 'Diagramm')}</h2><button class="icon-btn" data-zoom-close aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="zoom-body">${legend ? `<div class="legend">${legend}</div>` : ''}${html(spec)}
      <p class="small muted zoom-hint">Wischen zeigt die Werte · zwei Finger zoomen und verschieben · doppelt tippen setzt zurück${matchMedia('(pointer:fine)').matches ? ' · am PC: Strg + Mausrad zoomt, Ziehen verschiebt' : ''}</p></div>`;
    box.classList.add('open');
    const nb = box.querySelector('[data-chart]'), ne = reg.get(nb.dataset.chart);
    ne.i0 = e.i0; ne.i1 = e.i1; if (e.hover != null) ne.hover = e.hover;
    attach(nb);
    box.querySelector('[data-zoom-close]').onclick = closeFull;
  }
  function closeFull(){ const box = document.getElementById('zoom'); if (!box) return; box.classList.remove('open'); box.innerHTML = ''; prune(); }

  function prune(){ for (const id of [...reg.keys()]) if (!document.querySelector(`[data-chart="${id}"]`)) reg.delete(id); }
  function mount(root = document){ prune(); for (const el of root.querySelectorAll('[data-chart]')) attach(el); }
  function onScrub(fn){ listeners.push(fn); }
  return {html, mount, onScrub, closeFull, _reg: reg};
})();
if (typeof module !== 'undefined') module.exports = { Charts };
