/* ================= Karte mit Bewegungsverlauf =================
   Die Strecke wird lokal aus den GPS-Daten gezeichnet (Leaflet, im Projekt unter vendor/).
   Ein Kartenhintergrund (OpenStreetMap) wird NUR geladen, wenn er in den Einstellungen eingeschaltet ist –
   dabei erfährt der Kartenserver, welchen Kartenausschnitt du ansiehst. Standard: aus. */
const RouteMap = (() => {
  let loading = null;
  const maps = new Map();
  function load(){
    if (window.L) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet-1.9.4/leaflet.css'; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = 'vendor/leaflet-1.9.4/leaflet.js'; js.onload = () => res(); js.onerror = () => { loading = null; rej(new Error('Karte konnte nicht geladen werden')); };
      document.head.appendChild(js);
    });
    return loading;
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
    return `<div class="map${full ? ' map-full' : ''}" data-map="${act.id}"><div class="map-msg small muted">Karte wird geladen …</div>
      ${full ? '' : `<button type="button" class="chart-full map-open" aria-label="Karte im Vollbild öffnen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>`}</div>`;
  }
  async function mount(el, act, opts = {}){
    try { await load(); } catch(e){ el.querySelector('.map-msg').textContent = 'Karte konnte nicht geladen werden.'; return; }
    const L = window.L, pts = points(act, opts.bounds);
    if (pts.length < 2){ el.querySelector('.map-msg').textContent = 'Keine GPS-Daten.'; return; }
    el.querySelector('.map-msg').remove();
    const touch = matchMedia('(pointer:coarse)').matches;
    const map = L.map(el, {zoomControl: !touch || opts.full, attributionControl: !!opts.tiles, dragging: !touch || !!opts.full, scrollWheelZoom: !!opts.full,
      touchZoom: true, doubleClickZoom: !!opts.full, boxZoom: false, keyboard: false, tap: false, zoomSnap: 0.25, preferCanvas: false});
    if (opts.tiles) L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende'}).addTo(map);
    else el.classList.add('no-tiles');
    // Strecke, eingefärbt nach Herzfrequenzzone
    const cs = getComputedStyle(document.documentElement);
    const zc = ['--z1','--z2','--z3','--z4','--z5'].map(v => cs.getPropertyValue(v).trim() || '#888');
    const base = cs.getPropertyValue('--data').trim() || '#3a8bd6';
    L.polyline(pts.map(p => [p[0], p[1]]), {color: cs.getPropertyValue('--bg').trim() || '#000', weight: 7, opacity: 0.55, interactive: false}).addTo(map);
    let seg = [pts[0]], cur = pts[0][3];
    const flush = () => { if (seg.length > 1) L.polyline(seg.map(p => [p[0], p[1]]), {color: cur >= 0 ? zc[cur] : base, weight: 4, opacity: 0.95, lineCap: 'round', interactive: false}).addTo(map); };
    for (let i = 1; i < pts.length; i++){
      if (pts[i][3] !== cur){ seg.push(pts[i]); flush(); seg = [pts[i]]; cur = pts[i][3]; }
      else seg.push(pts[i]);
    }
    flush();
    const ink = cs.getPropertyValue('--ink').trim() || '#000';
    L.circleMarker([pts[0][0], pts[0][1]], {radius: 6, color: ink, weight: 2, fillColor: '#2E9E6E', fillOpacity: 1}).addTo(map);
    L.circleMarker([pts[pts.length-1][0], pts[pts.length-1][1]], {radius: 6, color: ink, weight: 2, fillColor: cs.getPropertyValue('--accent').trim() || '#e63946', fillOpacity: 1}).addTo(map);
    const marker = L.circleMarker([pts[0][0], pts[0][1]], {radius: 7, color: '#fff', weight: 3, fillColor: ink, fillOpacity: 1, opacity: 0});
    marker.addTo(map);
    map.fitBounds(L.latLngBounds(pts.map(p => [p[0], p[1]])), {padding: [18, 18]});
    maps.set(el, {map, pts, marker, act});
    setTimeout(() => map.invalidateSize(), 60);
  }
  // Markierung folgt dem Diagramm (Zeit in Sekunden)
  function mark(actId, t){
    for (const [el, m] of maps){
      if (!document.body.contains(el)){ m.map.remove(); maps.delete(el); continue; }
      if (m.act.id !== actId) continue;
      let lo = 0, hi = m.pts.length - 1; while (lo < hi){ const mid = (lo + hi) >> 1; if (m.pts[mid][2] < t) lo = mid + 1; else hi = mid; }
      const p = m.pts[lo]; m.marker.setLatLng([p[0], p[1]]); m.marker.setStyle({opacity: 1, fillOpacity: 1});
    }
  }
  function cleanup(){ for (const [el, m] of maps) if (!document.body.contains(el)){ m.map.remove(); maps.delete(el); } }
  return {html, mount, mark, cleanup, load};
})();
