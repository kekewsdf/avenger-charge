// Routeur par hash et initialisation de l'appli.

import { chargerReglages, demanderPersistance, ouvrirBase } from './db.js';
import * as accueil from './ecrans/accueil.js';
import * as recharges from './ecrans/recharges.js';
import * as trajets from './ecrans/trajets.js';
import * as simuler from './ecrans/simuler.js';
import * as reglages from './ecrans/reglages.js';

export const VERSION_APPLI = '0.6.1';

const ECRANS = { accueil, recharges, trajets, simuler, reglages };

export function afficherToast(message) {
  const modele = document.getElementById('tpl-toast');
  const toast = modele.content.firstElementChild.cloneNode(true);
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function appliquerTheme(theme) {
  document.documentElement.dataset.theme = theme === 'clair' ? 'clair' : 'sombre';
}

async function afficherEcran() {
  const nom = window.location.hash.slice(1);
  const onglet = ECRANS[nom] ? nom : 'accueil';
  for (const lien of document.querySelectorAll('.nav-item')) {
    const actif = lien.dataset.onglet === onglet;
    lien.classList.toggle('active', actif);
    if (actif) lien.setAttribute('aria-current', 'page');
    else lien.removeAttribute('aria-current');
  }
  const conteneur = document.getElementById('main-content');
  conteneur.replaceChildren();
  await ECRANS[onglet].afficher(conteneur, { version: VERSION_APPLI, afficherToast, appliquerTheme });
}

async function demarrer() {
  if (!window.isSecureContext) {
    document.getElementById('main-content').textContent =
      'Avenger Charge doit être ouverte en HTTPS (ou sur localhost) pour fonctionner.';
    return;
  }
  await ouvrirBase();
  appliquerTheme((await chargerReglages()).theme);
  window.addEventListener('hashchange', afficherEcran);
  await afficherEcran();
  demanderPersistance().catch(() => {});
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((erreur) => console.warn('Service worker non installé', erreur));
  }
}

demarrer().catch((erreur) => {
  console.error(erreur);
  document.getElementById('main-content').textContent = `Erreur au démarrage : ${erreur.message}`;
});
