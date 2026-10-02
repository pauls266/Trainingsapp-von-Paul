// Entwickler-Werkzeug: erzeugt exercises.js aus dem offiziellen Garmin FIT SDK (npm-Paket @garmin/fitsdk).
// Aufruf: npm pack @garmin/fitsdk && tar xzf garmin-fitsdk-*.tgz && node tools/gen-exercises.mjs package/src/profile.js
import { pathToFileURL } from 'url';
import fs from 'fs';
const src = process.argv[2];
if (!src) { console.error('Pfad zu profile.js angeben'); process.exit(1); }
const { default: P } = await import(pathToFileURL(src).href);
const human = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()).replace(/ With /g, ' with ').replace(/ On /g, ' on ').replace(/ To /g, ' to ');
const out = {};
for (const [num, name] of Object.entries(P.types.exerciseCategory)){
  const t = P.types[name + 'ExerciseName']; if (!t) continue;
  const keys = Object.keys(t).map(Number).sort((a, b) => a - b);
  const dense = keys.every((k, i) => k === i);
  out[num] = keys.map(k => (dense ? '' : k + '=') + human(t[k]).replace(/\|/g, '/')).join('|');
}
const ver = JSON.parse(fs.readFileSync(new URL('../package.json', pathToFileURL(src)), 'utf8')).version;
const js = `/* Übungsnamen aus dem offiziellen Garmin FIT SDK ${ver} (Typen „<Kategorie>_exercise_name“).
   Automatisch erzeugt mit tools/gen-exercises.mjs – nicht von Hand bearbeiten. */
const EXERCISE_NAMES = ${JSON.stringify(out)};
if (typeof module !== 'undefined') module.exports = { EXERCISE_NAMES };
`;
fs.writeFileSync(new URL('../exercises.js', import.meta.url), js);
console.log('exercises.js geschrieben:', Object.keys(out).length, 'Kategorien,', js.length, 'Bytes');
