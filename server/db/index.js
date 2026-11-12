import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Sequelize } from 'sequelize';
import { defineModels } from './models.js';

// Lacăt simplu: rulează funcțiile primite una câte una, în ordinea sosirii.
function createMutex() {
  let tail = Promise.resolve();
  return function run(fn) {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
}

// Creează conexiunea la SQLite și modelele. Fiecare apel întoarce o bază de date separată,
// ca testele să pornească mereu de la zero (storage ':memory:').
export async function createDatabase({ storage }) {
  const inMemory = storage === ':memory:';
  if (!inMemory) mkdirSync(dirname(storage), { recursive: true });

  const sequelize = new Sequelize({ dialect: 'sqlite', storage, logging: false });
  const models = defineModels(sequelize);

  // Cheile străine sunt activate de Sequelize pe fiecare conexiune SQLite.
  // WAL: cititorii nu sunt blocați cât timp o tranzacție scrie (doar pentru fișier pe disc).
  if (!inMemory) await sequelize.query('PRAGMA journal_mode = WAL');
  await sequelize.sync();

  // SQLite acceptă o singură scriere la un moment dat, iar tranzacțiile Sequelize simultane
  // eșuează cu „database is locked” sau „cannot start a transaction within a transaction”.
  // De aceea toate scrierile trec prin write(): una câte una, fiecare într-o tranzacție.
  // Limita e documentată în docs/architecture.md (o singură instanță de server).
  const lock = createMutex();
  const write = (fn) => lock(() => sequelize.transaction(fn));

  return { sequelize, models, write };
}
