// Service worker d'Avenger Charge (règles : CLAUDE.md section 3).
// Incrémenter CACHE_VERSION à chaque déploiement, et ne lister que des fichiers qui existent.
const CACHE_VERSION = 'v6';
const PREFIXE_CACHE = 'avenger-charge-';
const CACHE_NAME = `${PREFIXE_CACHE}${CACHE_VERSION}`;

// Chemins relatifs à sw.js, jamais d'URL de dossier : /local/ de HA ne sert pas d'index.
const FICHIERS = [
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/db.js',
  'js/calculs.js',
  'js/reference.js',
  'js/format.js',
  'js/graphiques.js',
  'js/export.js',
  'js/ecrans/formulaire.js',
  'js/ecrans/accueil.js',
  'js/ecrans/recharges.js',
  'js/ecrans/trajets.js',
  'js/ecrans/simuler.js',
  'js/ecrans/reglages.js',
  'vendor/chart.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // no-cache : HA sert /local/ avec un max-age de 31 jours.
    await cache.addAll(FICHIERS.map((url) => new Request(url, { cache: 'no-cache' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil((async () => {
    // CacheStorage est partagé avec toute l'origine : on ne touche qu'aux anciens caches de l'appli.
    const noms = await caches.keys();
    await Promise.all(noms
      .filter((nom) => nom.startsWith(PREFIXE_CACHE) && nom !== CACHE_NAME)
      .map((nom) => caches.delete(nom)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evenement) => {
  const { request } = evenement;
  const url = new URL(request.url);
  const portee = new URL(self.registration.scope);
  // Hors de l'appli (autre hôte, /api/ de HA, reste de HA) : le navigateur gère seul, sans cache.
  if (request.method !== 'GET' || url.origin !== portee.origin || !url.pathname.startsWith(portee.pathname)) return;
  evenement.respondWith(reponseDepuisCache(request));
});

async function reponseDepuisCache(request) {
  const cache = await caches.open(CACHE_NAME);
  const enCache = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (enCache) return enCache;
  try {
    return await fetch(request);
  } catch (erreur) {
    if (request.mode === 'navigate') {
      const accueil = await cache.match('index.html');
      if (accueil) return accueil;
    }
    throw erreur;
  }
}
