/* ================= Karte mit Bewegungsverlauf =================
   Die Strecke wird lokal aus den GPS-Daten gezeichnet (Leaflet, im Projekt unter vendor/).
   Ein Kartenhintergrund (OpenStreetMap) wird NUR geladen, wenn er in den Einstellungen eingeschaltet ist –
   dabei erfährt der Kartenserver, welchen Kartenausschnitt du ansiehst. Standard: aus. */
const RouteMap = (() => {
  let loading = null;
  const maps = new Map();
  function load(){
    if (window.L && document.querySelector('link[data-leaflet]')) return Promise.resolve();
    if (loading) return loading;
    // Stile UND Skript abwarten – sonst berechnet Leaflet das Layout ohne CSS (leere/verschobene Karte, v. a. in Safari)
    const css = new Promise(res => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/leaflet-1.9.4/leaflet.css'; l.dataset.leaflet = '1'; l.onload = res; l.onerror = res; document.head.appendChild(l); });
    const js = window.L ? Promise.resolve() : new Promise((res, rej) => { const j = document.createElement('script'); j.src = 'vendor/leaflet-1.9.4/leaflet.js'; j.onload = res; j.onerror = () => rej(new Error('Karte konnte nicht geladen werden')); document.head.appendChild(j); });
    loading = Promise.all([css, js]).catch(e => { loading = null; throw e; });
    return loading;
  }
  // wartet, bis das Element sichtbar ist und eine echte Größe hat (Sheet-Animation abgeschlossen)
  function whenSized(el){
    return new Promise(res => {
      let n = 0;
      const check = () => { const r = el.getBoundingClientRect(); if ((r.width > 50 && r.height > 50) || n++ > 60) setTimeout(res, 30); else requestAnimationFrame(check); };
      setTimeout(check, 240);
    });
  }
  // Punkte der Spur: [[lat, lon, t, zone], …]
  function points(act, bounds){
    const st = act.stream; if (!st || !st.la) return [];
    const out = [];
    for (let i = 0; i < st.t.length; i++){
      const la = st.la[i], lo = st.lo[i]; if (la == null || lo == null) continue;
      let z = -1; const h = st.hr[i]; if (h > 0 && bounds){ z = 0; while (z < 4 && h >= bounds[z]) z++; }
      out.push([la / 1e5, lo / 1e5, st.t[i], z]);
    }
    return out;
  }
  function html(act, full){
    return `<div class="map${full ? ' map-full' : ' map-open'}" data-map="${act.id}" ${full ? '' : 'role="button" tabindex="0" aria-label="Karte im Vollbild öffnen"'}><div class="map-msg small muted">Karte wird geladen …</div>
      ${full ? '' : `<span class="map-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>Vollbild</span>`}</div>`;
  }
  async function mount(el, act, opts = {}){
    const msg = t => { const m = el.querySelector('.map-msg'); if (m) m.textContent = t; };
    try { await load(); } catch(e){ msg('Karte konnte nicht geladen werden.'); return; }
    const L = window.L, pts = points(act, opts.bounds);
    if (pts.length < 2){ msg('Keine GPS-Daten.'); return; }
    await whenSized(el);
    if (!document.body.contains(el)) return;
    const m0 = el.querySelector('.map-msg'); if (m0) m0.remove();
    const full = !!opts.full;
    // Vorschau: ruhig, ohne Gesten (kein Konflikt mit dem Scrollen) – Antippen öffnet das Vollbild
    const map = L.map(el, {zoomControl: full, attributionControl: !!opts.tiles, dragging: full, touchZoom: full, scrollWheelZoom: full,
      doubleClickZoom: full, boxZoom: false, keyboard: false, tap: false, zoomSnap: 0.25, renderer: L.canvas({padding: 0.5}), fadeAnimation: false});
    if (opts.tiles) L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende'}).addTo(map);
    else el.classList.add('no-tiles');
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    const zc = ['--z1','--z2','--z3','--z4','--z5'].map(n => v(n) || '#888'), base = v('--data') || '#3a8bd6';
    L.polyline(pts.map(p => [p[0], p[1]]), {color: v('--bg') || '#000', weight: 8, opacity: 0.5, interactive: false}).addTo(map);
    let seg = [pts[0]], cur = pts[0][3];
    const flush = () => { if (seg.length > 1) L.polyline(seg.map(p => [p[0], p[1]]), {color: cur >= 0 ? zc[cur] : base, weight: 4, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false}).addTo(map); };
    for (let i = 1; i < pts.length; i++){ seg.push(pts[i]); if (pts[i][3] !== cur){ flush(); seg = [pts[i]]; cur = pts[i][3]; } }
    flush();
    const ink = v('--ink') || '#000';
    L.circleMarker([pts[0][0], pts[0][1]], {radius: 6, color: ink, weight: 2, fillColor: '#2E9E6E', fillOpacity: 1, interactive: false}).addTo(map);
    L.circleMarker([pts[pts.length-1][0], pts[pts.length-1][1]], {radius: 6, color: ink, weight: 2, fillColor: v('--accent') || '#e63946', fillOpacity: 1, interactive: false}).addTo(map);
    const marker = L.circleMarker([pts[0][0], pts[0][1]], {radius: 7, color: '#fff', weight: 3, fillColor: ink, fillOpacity: 0, opacity: 0, interactive: false}).addTo(map);
    const bounds = L.latLngBounds(pts.map(p => [p[0], p[1]]));
    const fit = () => { map.invalidateSize(false); map.fitBounds(bounds, {padding: [22, 22], animate: false}); };
    fit();
    const entry = {map, pts, marker, act, shown: false};
    maps.set(el, entry);
    // Größenänderungen (Drehen, Vollbild, Nachladen der Schrift) – Karte neu einpassen
    if (window.ResizeObserver){ const ro = new ResizeObserver(() => { if (document.body.contains(el)) fit(); else ro.disconnect(); }); ro.observe(el); entry.ro = ro; }
    el.classList.add('map-ready');
  }
  // Markierung folgt dem Diagramm (Zeit in Sekunden)
  function mark(actId, t){
    for (const [el, m] of maps){
      if (!document.body.contains(el)){ m.map.remove(); maps.delete(el); continue; }
      if (m.act.id !== actId) continue;
      let lo = 0, hi = m.pts.length - 1; while (lo < hi){ const mid = (lo + hi) >> 1; if (m.pts[mid][2] < t) lo = mid + 1; else hi = mid; }
      const p = m.pts[lo]; m.marker.setLatLng([p[0], p[1]]); m.marker.setStyle({opacity: 1, fillOpacity: 1}); m.shown = true; m.at = lo;
    }
  }
  function cleanup(){ for (const [el, m] of maps) if (!document.body.contains(el)){ if (m.ro) m.ro.disconnect(); m.map.remove(); maps.delete(el); } }
  // für die automatische Prüfung
  function info(){ return [...maps.values()].map(m => ({points: m.pts.length, marker: m.shown, at: m.at})); }
  return {html, mount, mark, cleanup, load, info};
})();
