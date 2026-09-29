// Entwickler-Werkzeug: erzeugt die PNG-Icons aus icons/icon.svg (Aufruf: node tools/make-icons.js)
const path = require('path'), fs = require('fs');
function loadPlaywright(){ try { return require('playwright'); } catch (e) {}
  return require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../icons/icon.svg'), 'utf8');
  const { chromium } = loadPlaywright(), b = await chromium.launch();
  // maskable: Motiv verkleinert, damit Android es rund oder als Tropfen zuschneiden kann
  const jobs = [['apple-touch-icon.png', 180, 1], ['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['icon-maskable-512.png', 512, 0.8]];
  for (const [name, size, scale] of jobs){
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const inner = Math.round(size * scale), off = Math.round((size - inner) / 2);
    await p.setContent(`<body style="margin:0;background:#0F1923"><div style="position:absolute;left:${off}px;top:${off}px;width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
    await p.screenshot({ path: path.join(__dirname, '../icons', name) });
    await p.close();
  }
  await b.close();
  console.log('Icons erzeugt.');
})();
