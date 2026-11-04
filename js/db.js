// Wrapper IndexedDB. Toute évolution du schéma passe par une nouvelle entrée de MIGRATIONS.

const NOM_BASE = 'avenger-charge';
const STORES = ['reglages', 'recharges', 'trajets', 'modeles', 'releves'];

// MIGRATIONS[n] fait passer le schéma de la version n à la version n + 1.
const MIGRATIONS = [
  (base) => {
    for (const store of STORES) base.createObjectStore(store, { keyPath: 'id' });
  }
];
export const SCHEMA_VERSION = MIGRATIONS.length;

let basePromesse = null;

export function ouvrirBase() {
  if (basePromesse) return basePromesse;
  basePromesse = new Promise((resolve, reject) => {
    const requete = indexedDB.open(NOM_BASE, SCHEMA_VERSION);
    requete.onupgradeneeded = (evenement) => {
      for (let v = evenement.oldVersion; v < SCHEMA_VERSION; v += 1) {
        MIGRATIONS[v](requete.result, requete.transaction);
      }
    };
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
  return basePromesse;
}

async function transaction(store, mode, action) {
  const base = await ouvrirBase();
  return new Promise((resolve, reject) => {
    const tx = base.transaction(store, mode);
    const requete = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(requete?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const lire = (store, id) => transaction(store, 'readonly', (s) => s.get(id));
export const lireTout = (store) => transaction(store, 'readonly', (s) => s.getAll());
export const ecrire = (store, doc) => transaction(store, 'readwrite', (s) => s.put(doc));
export const supprimer = (store, id) => transaction(store, 'readwrite', (s) => s.delete(id));

export async function viderTout() {
  await Promise.all(STORES.map((store) => transaction(store, 'readwrite', (s) => s.clear())));
}

export function reglagesParDefaut() {
  const calibrage = () => ({ rendementN: null, puissanceN: null });
  return {
    id: 'principal',
    capaciteNetteKwh: 51,
    capaciteBruteKwh: 54,
    profilsCharge: [
      { id: crypto.randomUUID(), nom: 'Prise 6 A', intensiteA: 6, puissanceKw: 1.1, rendement: 0.80, actif: true, calibrage: calibrage() },
      { id: crypto.randomUUID(), nom: 'BOKMAN sur prise renforcée', intensiteA: null, puissanceKw: 3.4, rendement: 0.88, actif: false, calibrage: calibrage() },
      { id: crypto.randomUUID(), nom: "NRGkick 16 A (Green'Up)", intensiteA: null, puissanceKw: 3.4, rendement: 0.88, actif: false, calibrage: calibrage() }
    ],
    tarif: {
      type: 'base',
      prixBaseKwh: null,
      prixHpKwh: null,
      prixHcKwh: null,
      plagesHc: [{ debut: '22:00', fin: '06:00' }]
    },
    seuilMiniPct: 15,
    margeSimulationPct: 10,
    chargeCiblePct: 80,
    coefsTemperature: null,
    homeAssistant: { actif: false, jeton: null, entiteMeteo: null, derniereSynchro: null },
    theme: 'sombre',
    derniereSauvegarde: null
  };
}

export async function chargerReglages() {
  const existants = await lire('reglages', 'principal');
  if (existants) return existants;
  const defaut = reglagesParDefaut();
  await ecrire('reglages', defaut);
  return defaut;
}

export const enregistrerReglages = (reglages) => ecrire('reglages', reglages);

// Demande au navigateur de ne pas purger les données locales.
export async function demanderPersistance() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

// Remplace tout le contenu d'un store en une seule transaction (import « remplacer tout »).
export const remplacerStore = (store, docs) => transaction(store, 'readwrite', (s) => {
  s.clear();
  for (const doc of docs) s.put(doc);
});

// Écrit plusieurs documents en une seule transaction (import « fusionner »).
export const ecrireTous = (store, docs) => transaction(store, 'readwrite', (s) => {
  for (const doc of docs) s.put(doc);
});
