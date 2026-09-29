// Gemeinsame Test-Hilfen. Feste Zeitzone, damit Tages- und Wochengrenzen reproduzierbar sind.
process.env.TZ = 'Europe/Berlin';
const core = require('../core.js');
module.exports = { core, DAY: 864e5 };
