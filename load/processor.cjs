// Funcții ajutătoare pentru scenariul Artillery (load/run.js), apelate ca pași de tip `function`
// ai scenariului: primesc contextul utilizatorului virtual, emițătorul de evenimente și callback-ul.
const { randomUUID, randomBytes } = require('node:crypto');

// O poză „demonstrativă” de ~100 KB, cu semnătura unui JPEG real (serverul o verifică).
const PHOTO = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(100 * 1024)]).toString('base64')}`;

// Inspecție nouă, creată pe teren (ID generat de „telefon”).
function newInspection(context, events, done) {
  context.vars.newId = randomUUID();
  context.vars.now = new Date().toISOString();
  context.vars.photo = PHOTO;
  return done();
}

// O nouă modificare a unei inspecții existente: marcaj de timp nou, răspuns ales aleatoriu.
function update(context, events, done) {
  context.vars.now = new Date().toISOString();
  context.vars.value = ['pass', 'fail', 'na'][Math.floor(Math.random() * 3)];
  return done();
}

module.exports = { newInspection, update };
