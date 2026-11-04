// Sauvegarde (CLAUDE.md 9.1) : export et import JSON, export CSV. Fonctions pures, testées sous Node ;
// le téléchargement et la lecture du fichier restent dans l'écran Réglages.

import { calculerRecharge, consoMesuree, coutRecharge, kwhConsommes, motifExclusion } from './calculs.js';

const STORES_DONNEES = ['recharges', 'trajets', 'modeles', 'releves'];
const deux = (n) => String(n).padStart(2, '0');

// ---------- Export JSON ----------

export function nomFichier(date, extension, suffixe = '') {
  const d = new Date(date);
  return `avenger-charge${suffixe}-${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}.${extension}`;
}

// Le jeton Home Assistant n'est jamais écrit dans un fichier (9.1).
function reglagesSansJeton(reglages) {
  return { ...reglages, homeAssistant: { ...(reglages.homeAssistant ?? {}), jeton: null } };
}

export function construireExport(donnees, schemaVersion, dateExport) {
  return {
    schemaVersion,
    dateExport,
    reglages: reglagesSansJeton(donnees.reglages),
    ...Object.fromEntries(STORES_DONNEES.map((store) => [store, donnees[store] ?? []]))
  };
}

// ---------- Import JSON ----------

// Contrôle un fichier importé avant toute écriture. Renvoie { erreurs, resume }.
export function validerImport(objet, schemaVersion) {
  const erreurs = [];
  if (!objet || typeof objet !== 'object' || Array.isArray(objet)) {
    return { erreurs: ["Ce fichier n'est pas une sauvegarde Avenger Charge."], resume: null };
  }
  if (!Number.isInteger(objet.schemaVersion)) erreurs.push('Version de schéma absente.');
  else if (objet.schemaVersion > schemaVersion) {
    erreurs.push(`Sauvegarde faite par une version plus récente de l'appli (schéma ${objet.schemaVersion}, cette appli : ${schemaVersion}). Mets l'appli à jour d'abord.`);
  }
  if (!objet.reglages || typeof objet.reglages !== 'object' || objet.reglages.id !== 'principal') erreurs.push('Réglages absents ou invalides.');
  for (const store of STORES_DONNEES) {
    const liste = objet[store];
    if (!Array.isArray(liste)) erreurs.push(`Liste « ${store} » absente.`);
    else if (liste.some((doc) => !doc || typeof doc !== 'object' || typeof doc.id !== 'string' || !doc.id)) {
      erreurs.push(`Liste « ${store} » : un élément n'a pas d'identifiant.`);
    }
  }
  const resume = erreurs.length ? null : Object.fromEntries(STORES_DONNEES.map((store) => [store, objet[store].length]));
  return { erreurs, resume };
}

// Données à écrire après confirmation. « remplacer » : le fichier remplace tout ; « fusionner » : union par id,
// la version du fichier l'emporte sur un même id. Dans les deux cas, les réglages du fichier s'appliquent,
// mais le jeton Home Assistant de l'appareil est gardé.
export function preparerImport(local, importe, mode) {
  // La date de dernière sauvegarde garde la plus récente des deux : un vieux fichier ne doit pas la reculer.
  const dates = [local.reglages?.derniereSauvegarde, importe.reglages.derniereSauvegarde, importe.dateExport].filter(Boolean);
  const derniereSauvegarde = dates.sort((a, b) => new Date(b) - new Date(a))[0] ?? null;
  const resultat = {
    reglages: {
      ...importe.reglages,
      derniereSauvegarde,
      homeAssistant: { ...(importe.reglages.homeAssistant ?? {}), jeton: local.reglages?.homeAssistant?.jeton ?? null }
    }
  };
  for (const store of STORES_DONNEES) {
    if (mode === 'remplacer') resultat[store] = importe[store];
    else {
      const parId = new Map((local[store] ?? []).map((doc) => [doc.id, doc]));
      for (const doc of importe[store]) parId.set(doc.id, doc);
      resultat[store] = [...parId.values()];
    }
  }
  return resultat;
}

// ---------- Export CSV (Excel en français : « ; », virgule décimale, UTF-8 avec BOM) ----------

const estConnu = (v) => v !== null && v !== undefined && Number.isFinite(v);

export function nombreCsv(valeur, decimales = 2) {
  return estConnu(valeur) ? valeur.toFixed(decimales).replace('.', ',') : '';
}

export function dateCsv(date) {
  if (!date) return '';
  const d = new Date(date);
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

function celluleCsv(valeur) {
  const texte = String(valeur ?? '');
  return /[;"\r\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

export function versCsv(entetes, lignes) {
  return `﻿${[entetes, ...lignes].map((l) => l.map(celluleCsv).join(';')).join('\r\n')}\r\n`;
}

const ouiNon = (v) => (v ? 'oui' : 'non');

export function csvRecharges(recharges, reglages) {
  const capacite = reglages.capaciteNetteKwh;
  const profils = new Map(reglages.profilsCharge.map((p) => [p.id, p.nom]));
  const lignes = [...recharges].sort((a, b) => new Date(a.debut) - new Date(b.debut)).map((r) => {
    const c = calculerRecharge(r, capacite);
    const cout = r.lieu === 'public' ? null : coutRecharge(r, capacite).cout;
    return [
      dateCsv(r.debut), dateCsv(r.fin), r.statut, r.lieu, r.source, profils.get(r.profilId) ?? '',
      nombreCsv(r.socDebut, 1), nombreCsv(r.socFin, 1), nombreCsv(c.dureeChargeH, 2),
      nombreCsv(c.kwhBatterie), nombreCsv(c.kwhPrise), c.kwhPrise === null ? '' : ouiNon(c.kwhPriseEstMesure),
      nombreCsv(c.rendementMesure, 3), nombreCsv(c.puissanceMoyenne), nombreCsv(cout),
      ouiNon(r.preconditionnement), nombreCsv(r.temperatureExt, 0), r.note ?? ''
    ];
  });
  return versCsv([
    'Branchement', 'Débranchement', 'Statut', 'Lieu', 'Source', 'Profil', '% début', '% fin', 'Durée de charge (h)',
    'kWh batterie', 'kWh prise', 'kWh prise mesuré', 'Rendement mesuré', 'Puissance moyenne (kW)', 'Coût (€)',
    'Préconditionnement', 'Température (°C)', 'Note'
  ], lignes);
}

export function csvTrajets(trajets, reglages, modeles = []) {
  const capacite = reglages.capaciteNetteKwh;
  const noms = new Map(modeles.map((m) => [m.id, m.nom]));
  const lignes = [...trajets].sort((a, b) => new Date(a.date) - new Date(b.date)).map((t) => [
    dateCsv(t.date), noms.get(t.modeleId) ?? '', (t.segments ?? []).map((s) => `${s.type} ${nombreCsv(s.km, 0)} km`).join(' + '),
    nombreCsv(t.kmTotal, 1), nombreCsv(t.socDepart, 1), nombreCsv(t.socArrivee, 1), nombreCsv(kwhConsommes(t, capacite)),
    nombreCsv(consoMesuree(t, capacite), 1), nombreCsv(t.consoVoitureKwh100, 1), nombreCsv(t.temperatureExt, 0),
    motifExclusion(t, capacite) ?? 'éligible', t.source, t.note ?? ''
  ]);
  return versCsv([
    'Date', 'Modèle', 'Segments', 'Km', '% départ', '% arrivée', 'kWh consommés', 'Conso (kWh/100 km)',
    'Conso voiture (kWh/100 km)', 'Température (°C)', 'Apprentissage', 'Source', 'Note'
  ], lignes);
}
