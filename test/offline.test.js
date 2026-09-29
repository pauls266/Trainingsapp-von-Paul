const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { core } = require('./helpers.js');
const ROOT = path.join(__dirname, '..');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

test('Offline-Helfer hat dieselbe Versionsnummer wie die App', () => {
  const v = sw.match(/const VERSION = '([^']+)'/)[1];
  assert.equal(v, core.APP_VERSION, 'sw.js und core.js anpassen, sonst wird der Cache nicht erneuert');
});

test('Alle vorab gespeicherten Dateien existieren', () => {
  const files = JSON.parse(sw.match(/const FILES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  for (const f of files) if (f !== './') assert.ok(fs.existsSync(path.join(ROOT, f)), 'fehlt: ' + f);
});

test('Manifest ist gültig und verweist auf vorhandene Icons', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.start_url, './');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, i.src)), 'fehlt: ' + i.src);
});

test('CHANGELOG nennt die aktuelle Version', () => {
  assert.ok(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').includes('## ' + core.APP_VERSION));
});
