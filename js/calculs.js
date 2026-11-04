// Toutes les formules de l'appli (CLAUDE.md section 7). Fonctions pures : ni DOM, ni IndexedDB.
// Une valeur inconnue vaut null, jamais 0. En JavaScript, null - null donne 0 : on teste donc explicitement.

import { CONSO_REFERENCE, COEFS_TEMPERATURE } from './reference.js';

const MS_PAR_HEURE = 3600000;
const MS_PAR_MINUTE = 60000;

const estConnu = (valeur) => valeur !== null && valeur !== undefined && !Number.isNaN(valeur);

function heuresEntre(debut, fin) {
  if (!debut || !fin) return null;
  return (new Date(fin) - new Date(debut)) / MS_PAR_HEURE;
}

// ---------- 7.1 Recharge ----------

// "03:14:09" ou "3:14" (3 h 14 min 0 s) → secondes. Saisie invalide → null.
export function parserDureeCable(texte) {
  const trouve = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(texte ?? '').trim());
  if (!trouve) return null;
  return Number(trouve[1]) * 3600 + Number(trouve[2]) * 60 + Number(trouve[3] ?? 0);
}

export function calculerKwhBatterie(socDebut, socFin, capaciteNette) {
  if (!estConnu(socDebut) || !estConnu(socFin)) return null;
  return (socFin - socDebut) / 100 * capaciteNette;
}

export function calculerRecharge(recharge, capaciteNette) {
  const { socDebut, socFin, kwhPriseMesure, dureeCableS, rendementUtilise } = recharge;
  const kwhBatterie = calculerKwhBatterie(socDebut, socFin, capaciteNette);
  const kwhPriseEstime = estConnu(kwhBatterie) && estConnu(rendementUtilise)
    ? kwhBatterie / rendementUtilise
    : null;
  const kwhPrise = kwhPriseMesure ?? kwhPriseEstime;
  const dureeBrancheeH = heuresEntre(recharge.debut, recharge.fin);
  const dureeChargeH = estConnu(dureeCableS) ? dureeCableS / 3600 : dureeBrancheeH;
  const dureeValide = estConnu(dureeChargeH) && dureeChargeH > 0;
  return {
    kwhBatterie,
    kwhPriseEstime,
    kwhPrise,
    kwhPriseEstMesure: estConnu(kwhPriseMesure),
    dureeBrancheeH,
    dureeChargeH,
    puissanceMoyenne: dureeValide && estConnu(kwhPrise) ? kwhPrise / dureeChargeH : null,
    rendementMesure: estConnu(kwhBatterie) && estConnu(kwhPriseMesure) && kwhPriseMesure > 0
      ? kwhBatterie / kwhPriseMesure
      : null,
    pctParHeure: dureeValide && estConnu(socDebut) && estConnu(socFin)
      ? (socFin - socDebut) / dureeChargeH
      : null
  };
}

// La durée du câble dépasse de plus de 5 min le temps branché : heure de branchement probablement fausse.
export function heureBranchementSuspecte(recharge) {
  if (recharge.haSessionId) return false;
  const brancheeH = heuresEntre(recharge.debut, recharge.fin);
  if (!estConnu(brancheeH) || !estConnu(recharge.dureeCableS)) return false;
  return recharge.dureeCableS - brancheeH * 3600 > 300;
}

export function debutEstime(fin, dureeCableS) {
  return new Date(new Date(fin).getTime() - dureeCableS * 1000);
}

export function socEstime(recharge, maintenant, capaciteNette) {
  const { socDebut, debut, puissanceKw, rendementUtilise } = recharge;
  if (!estConnu(socDebut) || !estConnu(puissanceKw) || !estConnu(rendementUtilise)) return null;
  const heures = heuresEntre(debut, maintenant);
  if (!estConnu(heures)) return null;
  return Math.min(100, socDebut + heures * puissanceKw * rendementUtilise / capaciteNette * 100);
}

export function calibrerRendement(recharges, profilId, capaciteNette) {
  const retenues = recharges
    .filter((r) => r.profilId === profilId && !r.preconditionnement && estConnu(r.kwhPriseMesure))
    .map((r) => ({
      ecart: estConnu(r.socDebut) && estConnu(r.socFin) ? r.socFin - r.socDebut : null,
      kwhBatterie: calculerKwhBatterie(r.socDebut, r.socFin, capaciteNette),
      kwhPrise: r.kwhPriseMesure
    }))
    .filter((r) => estConnu(r.ecart) && r.ecart >= 10)
    .filter((r) => {
      const rendement = r.kwhBatterie / r.kwhPrise;
      return rendement >= 0.5 && rendement <= 0.98;
    });
  if (retenues.length < 2) return null;
  const batterie = retenues.reduce((somme, r) => somme + r.kwhBatterie, 0);
  const prise = retenues.reduce((somme, r) => somme + r.kwhPrise, 0);
  return { rendement: batterie / prise, n: retenues.length };
}

export function calibrerPuissance(recharges, profilId) {
  const retenues = recharges.filter((r) => r.profilId === profilId && !r.preconditionnement
    && estConnu(r.kwhPriseMesure) && estConnu(r.dureeCableS) && r.dureeCableS > 0);
  if (retenues.length < 2) return null;
  const kwh = retenues.reduce((somme, r) => somme + r.kwhPriseMesure, 0);
  const heures = retenues.reduce((somme, r) => somme + r.dureeCableS / 3600, 0);
  return { puissanceKw: kwh / heures, n: retenues.length };
}

// kWh d'une recharge avec préconditionnement qui ne sont pas entrés dans la batterie. Rien à afficher : null.
export function kwhHorsBatterie(recharge, rendementProfil, capaciteNette) {
  if (!recharge.preconditionnement || !estConnu(recharge.kwhPriseMesure) || !estConnu(rendementProfil)) return null;
  const kwhBatterie = calculerKwhBatterie(recharge.socDebut, recharge.socFin, capaciteNette);
  if (!estConnu(kwhBatterie)) return null;
  const hors = recharge.kwhPriseMesure - kwhBatterie / rendementProfil;
  return hors > 0 ? hors : null;
}

// ---------- 7.3 Coût et heures creuses ----------

export function tarifRenseigne(tarif) {
  if (!tarif) return false;
  if (tarif.type === 'base') return estConnu(tarif.prixBaseKwh);
  if (tarif.type === 'hphc') return estConnu(tarif.prixHpKwh) && estConnu(tarif.prixHcKwh);
  return false;
}

function dateAvecHeure(jour, heure) {
  const [h, m] = heure.split(':').map(Number);
  return new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), h, m).getTime();
}

export function minutesHeuresCreuses(debut, fin, plages) {
  const tDebut = new Date(debut).getTime();
  const tFin = new Date(fin).getTime();
  let total = 0;
  const jour = new Date(tDebut);
  jour.setDate(jour.getDate() - 1); // une plage de la veille peut passer minuit
  for (; jour.getTime() <= tFin; jour.setDate(jour.getDate() + 1)) {
    for (const plage of plages ?? []) {
      const debutPlage = dateAvecHeure(jour, plage.debut);
      let finPlage = dateAvecHeure(jour, plage.fin);
      if (finPlage <= debutPlage) {
        const lendemain = new Date(jour);
        lendemain.setDate(lendemain.getDate() + 1);
        finPlage = dateAvecHeure(lendemain, plage.fin);
      }
      total += Math.max(0, Math.min(tFin, finPlage) - Math.max(tDebut, debutPlage));
    }
  }
  return total / MS_PAR_MINUTE;
}

export function coutCharge(debut, fin, kwhPrise, tarif, mesures = {}) {
  const vide = { cout: null, kwhHc: null, kwhHp: null };
  if (!estConnu(kwhPrise) || !tarifRenseigne(tarif)) return vide;
  if (tarif.type === 'base') return { ...vide, cout: kwhPrise * tarif.prixBaseKwh };

  let kwhHc;
  let kwhHp;
  if (estConnu(mesures.kwhHcMesure) && estConnu(mesures.kwhHpMesure)) {
    kwhHc = mesures.kwhHcMesure;
    kwhHp = mesures.kwhHpMesure;
  } else {
    const minutesTotales = (new Date(fin) - new Date(debut)) / MS_PAR_MINUTE;
    if (!(minutesTotales > 0)) return vide;
    kwhHc = kwhPrise * minutesHeuresCreuses(debut, fin, tarif.plagesHc) / minutesTotales;
    kwhHp = kwhPrise - kwhHc;
  }
  return { cout: kwhHc * tarif.prixHcKwh + kwhHp * tarif.prixHpKwh, kwhHc, kwhHp };
}

export function coutRecharge(recharge, capaciteNette) {
  const { kwhPrise, dureeChargeH } = calculerRecharge(recharge, capaciteNette);
  const debut = new Date(recharge.debut);
  const fin = estConnu(dureeChargeH) ? new Date(debut.getTime() + dureeChargeH * MS_PAR_HEURE) : debut;
  return coutCharge(debut, fin, kwhPrise, recharge.prixApplique, recharge);
}

// Copie figée du tarif, ou null tant qu'il n'est pas renseigné (section 6).
export function figerTarif(tarif) {
  if (!tarifRenseigne(tarif)) return null;
  const { type, prixBaseKwh, prixHpKwh, prixHcKwh, plagesHc } = tarif;
  return { type, prixBaseKwh, prixHpKwh, prixHcKwh, plagesHc: (plagesHc ?? []).map((p) => ({ ...p })) };
}

export function rechargesSansPrix(recharges) {
  return recharges.filter((r) => r.lieu !== 'public' && !r.prixApplique);
}

// Recharges mises à jour après confirmation de Kevin. Un prix déjà figé n'est jamais modifié.
export function appliquerTarif(recharges, tarif) {
  const fige = figerTarif(tarif);
  if (!fige) return [];
  return rechargesSansPrix(recharges).map((r) => ({ ...r, prixApplique: figerTarif(fige) }));
}

// ---------- Saisie des recharges (écran Recharges) ----------

// Dernier profil utilisé parmi les actifs, à défaut le premier actif. Aucun actif : null.
export function profilParDefaut(profils, recharges) {
  const actifs = profils.filter((p) => p.actif);
  const derniere = recharges
    .filter((r) => actifs.some((p) => p.id === r.profilId))
    .sort((a, b) => new Date(b.debut) - new Date(a.debut))[0];
  return derniere ? actifs.find((p) => p.id === derniere.profilId) : (actifs[0] ?? null);
}

const pctValide = (valeur) => estConnu(valeur) && valeur >= 0 && valeur <= 100;

// Contrôle une recharge saisie à la main. Renvoie la liste des erreurs (vide si tout va bien).
export function erreursRecharge(recharge) {
  const erreurs = [];
  if (!recharge.debut) erreurs.push("L'heure de branchement est obligatoire.");
  if (!pctValide(recharge.socDebut)) erreurs.push('Le % de départ doit être compris entre 0 et 100.');
  if (!recharge.profilId) erreurs.push('Choisis un profil de charge.');
  if (recharge.statut === 'terminee') {
    if (!recharge.fin) erreurs.push("L'heure de débranchement est obligatoire.");
    else if (recharge.debut && new Date(recharge.fin) <= new Date(recharge.debut)) {
      erreurs.push("L'heure de débranchement doit être après le branchement.");
    }
    if (!pctValide(recharge.socFin)) erreurs.push('Le % final doit être compris entre 0 et 100.');
    else if (pctValide(recharge.socDebut) && recharge.socFin < recharge.socDebut) {
      erreurs.push('Le % final est plus bas que le % de départ.');
    }
  }
  if (estConnu(recharge.kwhPriseMesure) && recharge.kwhPriseMesure < 0) erreurs.push('Les kWh du câble ne peuvent pas être négatifs.');
  return erreurs;
}

export const moisDe = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Totaux d'un mois pour la maison : les recharges publiques n'entrent ni dans les kWh ni dans le coût.
export function totauxMois(recharges, capaciteNette) {
  const domicile = recharges.filter((r) => r.statut === 'terminee' && r.lieu !== 'public');
  let kwhPrise = 0;
  let cout = 0;
  let coutsInconnus = 0;
  for (const r of domicile) {
    kwhPrise += calculerRecharge(r, capaciteNette).kwhPrise ?? 0;
    const prix = coutRecharge(r, capaciteNette).cout;
    if (estConnu(prix)) cout += prix;
    else coutsInconnus += 1;
  }
  return {
    n: domicile.length,
    kwhPrise,
    cout: domicile.length > 0 && coutsInconnus === domicile.length ? null : cout,
    coutsInconnus
  };
}

// ---------- 7.2 Calculateur de charge ----------

export function arrondirMinute(date, mode = 'proche') {
  const t = new Date(date).getTime();
  const calcul = mode === 'inferieure' ? Math.floor : Math.round;
  return new Date(calcul(t / MS_PAR_MINUTE) * MS_PAR_MINUTE);
}

export function besoinCharge(actuel, cible, profil, capaciteNette) {
  const kwhBatterie = Math.max(0, (cible - actuel) / 100 * capaciteNette);
  const kwhPrise = kwhBatterie / profil.rendement;
  return { kwhBatterie, kwhPrise, dureeH: kwhPrise / profil.puissanceKw };
}

export function calculateurCharge({ actuel, cible, profil, branchement, capaciteNette, tarif }) {
  const besoin = besoinCharge(actuel, cible, profil, capaciteNette);
  const heureFin = new Date(new Date(branchement).getTime() + besoin.dureeH * MS_PAR_HEURE);
  const { cout } = coutCharge(branchement, heureFin, besoin.kwhPrise, tarif);
  return { ...besoin, heureFin, cout };
}

export function branchementAuPlusTard(depart, dureeH) {
  return arrondirMinute(new Date(depart).getTime() - dureeH * MS_PAR_HEURE, 'inferieure');
}

// ---------- 7.4 Trajet effectué ----------

export function kwhConsommes(trajet, capaciteNette) {
  return (trajet.socDepart - trajet.socArrivee) / 100 * capaciteNette;
}

export function consoMesuree(trajet, capaciteNette) {
  if (estConnu(trajet.consoVoitureKwh100)) return trajet.consoVoitureKwh100;
  if (!(trajet.kmTotal > 0)) return null;
  return kwhConsommes(trajet, capaciteNette) / trajet.kmTotal * 100;
}

export function motifExclusion(trajet, capaciteNette) {
  const { socDepart, socArrivee, kmTotal, dureeMin } = trajet;
  const avecConsoVoiture = estConnu(trajet.consoVoitureKwh100);
  if (trajet.exclusionManuelle) return 'exclu à la main';
  if (kmTotal < 15) return 'trop court (< 15 km)';
  if (!avecConsoVoiture && (socDepart <= 0 || socDepart === socArrivee)) return '% figé (pas de données)';
  if (socArrivee > socDepart) return '% en hausse pendant le trajet';
  if (!avecConsoVoiture && socDepart - socArrivee < 4) return 'écart de % trop faible';
  if (estConnu(dureeMin) && dureeMin > 0 && kmTotal / (dureeMin / 60) > 140) return 'durée incohérente';
  const conso = consoMesuree(trajet, capaciteNette);
  if (conso < 9 || conso > 35) return 'conso invraisemblable';
  return null;
}

// ---------- 7.5 Coefficient de température ----------

export function coefTemp(temperature, coefs = COEFS_TEMPERATURE) {
  if (!estConnu(temperature)) return 1.00;
  const palier = (coefs ?? COEFS_TEMPERATURE).find((p) => p.min === null || temperature >= p.min);
  return palier.coef;
}

// ---------- 7.6 Apprentissage de la conso perso ----------

// Éligible et à température connue : seuls ces trajets alimentent les moyennes.
export function estUtilisable(trajet, capaciteNette) {
  return motifExclusion(trajet, capaciteNette) === null && estConnu(trajet.temperatureExt);
}

export function consoNormalisee(trajet, capaciteNette, coefs) {
  return consoMesuree(trajet, capaciteNette) / coefTemp(trajet.temperatureExt, coefs);
}

function moyennePonderee(trajets, capaciteNette, coefs) {
  const km = trajets.reduce((somme, t) => somme + t.kmTotal, 0);
  const pondere = trajets.reduce((somme, t) => somme + consoNormalisee(t, capaciteNette, coefs) * t.kmTotal, 0);
  return pondere / km;
}

function typeUnique(trajet) {
  const types = new Set((trajet.segments ?? []).map((s) => s.type));
  return types.size === 1 ? [...types][0] : null;
}

export function consoParType(trajets, type, capaciteNette, coefs) {
  if (type === 'mixte') return consoMixte(trajets, capaciteNette, coefs);
  const retenus = trajets
    .filter((t) => typeUnique(t) === type && estUtilisable(t, capaciteNette))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);
  if (retenus.length < 3) return { conso: CONSO_REFERENCE[type], n: 0, source: 'reference' };
  return { conso: moyennePonderee(retenus, capaciteNette, coefs), n: retenus.length, source: 'perso' };
}

export function consoMixte(trajets, capaciteNette, coefs) {
  const retenus = trajets.filter((t) => estUtilisable(t, capaciteNette));
  if (retenus.length < 3) return { conso: CONSO_REFERENCE.mixte, n: 0, source: 'reference' };
  return { conso: moyennePonderee(retenus, capaciteNette, coefs), n: retenus.length, source: 'perso' };
}

// Moyenne d'un modèle à partir de 2 réalisations utilisables, sinon null (calcul par segments).
export function consoModele(trajets, modeleId, capaciteNette, coefs) {
  const retenus = trajets.filter((t) => t.modeleId === modeleId && estUtilisable(t, capaciteNette));
  if (retenus.length < 2) return null;
  return { conso: moyennePonderee(retenus, capaciteNette, coefs), n: retenus.length, source: 'modele' };
}

// ---------- 7.7 Simulation d'un trajet ----------

const kmSegments = (segments) => segments.reduce((somme, s) => somme + s.km, 0);

// Détail par segment : conso à 15 °C retenue, sa source, et kWh après coefficient de température.
export function detailSegments(segments, coef, trajets, capaciteNette, coefs) {
  return segments.map((s) => {
    const { conso, n, source } = consoParType(trajets, s.type, capaciteNette, coefs);
    return { type: s.type, km: s.km, conso, n, source, kwh: s.km * conso * coef / 100 };
  });
}

const sommeKwh = (lignes) => lignes.reduce((somme, l) => somme + l.kwh, 0);

export function simulerTrajet({
  segments, modele = null, modeleRetour = null, allerRetour = false,
  temperature = null, socDepart = null, heureDepart = null, profil = null, trajets = [], reglages
}) {
  const { capaciteNetteKwh: capacite, margeSimulationPct: marge, seuilMiniPct: seuil, coefsTemperature } = reglages;
  const coefs = coefsTemperature ?? COEFS_TEMPERATURE;
  const coef = coefTemp(temperature, coefs);
  const segmentsAller = modele ? modele.segments : segments;

  const historique = modele ? consoModele(trajets, modele.id, capacite, coefs) : null;
  const detail = historique ? [] : detailSegments(segmentsAller, coef, trajets, capacite, coefs);
  const kwhAller = historique
    ? kmSegments(segmentsAller) * historique.conso * coef / 100
    : sommeKwh(detail);

  let kwhRetour = 0;
  let historiqueRetour = null;
  if (allerRetour) {
    historiqueRetour = modeleRetour ? consoModele(trajets, modeleRetour.id, capacite, coefs) : null;
    kwhRetour = historiqueRetour
      ? kmSegments(modeleRetour.segments) * historiqueRetour.conso * coef / 100
      : kwhAller;
  }

  const facteurMarge = 1 + marge / 100;
  const kwh = kwhAller + kwhRetour;
  const kwhAvecMarge = kwh * facteurMarge;
  const pctConsomme = kwhAvecMarge / capacite * 100;
  const resultat = {
    kwhAller, kwhRetour, kwh, kwhAvecMarge, pctConsomme,
    coef,
    kmAller: kmSegments(segmentsAller),
    sourceAller: historique ? 'modele' : 'segments',
    historiqueAller: historique,
    historiqueRetour,
    detail,
    socArrivee: null, socRetour: null, verdict: null,
    pctAAtteindre: null, impossible: false, dureeChargeH: null, branchementMax: null
  };
  if (!estConnu(socDepart)) return resultat;

  resultat.socArrivee = socDepart - kwhAller * facteurMarge / capacite * 100;
  if (allerRetour) resultat.socRetour = socDepart - pctConsomme;
  const socFinal = allerRetour ? resultat.socRetour : resultat.socArrivee;

  if (socFinal >= seuil + 10) resultat.verdict = 'ok';
  else if (socFinal >= seuil) resultat.verdict = 'juste';
  else {
    resultat.verdict = 'recharge';
    resultat.impossible = pctConsomme + seuil > 100;
    resultat.pctAAtteindre = Math.min(100, pctConsomme + seuil);
    if (profil) {
      resultat.dureeChargeH = besoinCharge(socDepart, resultat.pctAAtteindre, profil, capacite).dureeH;
      if (heureDepart) resultat.branchementMax = branchementAuPlusTard(heureDepart, resultat.dureeChargeH);
    }
  }
  return resultat;
}

// ---------- 7.8 Dernier % connu et autonomie ----------

function socArriveeFiable(trajet) {
  const { socDepart, socArrivee } = trajet;
  return estConnu(socArrivee) && socArrivee > 0 && socArrivee < socDepart;
}

export function dernierPctConnu({ recharges = [], trajets = [], releves = [] }) {
  const evenements = [
    ...recharges
      .filter((r) => r.statut === 'terminee' && estConnu(r.socFin) && r.fin)
      .map((r) => ({ soc: r.socFin, date: r.fin, source: 'recharge' })),
    // Le % noté au branchement est aussi un % connu, à l'heure du branchement.
    ...recharges
      .filter((r) => estConnu(r.socDebut) && r.debut)
      .map((r) => ({ soc: r.socDebut, date: r.debut, source: 'branchement' })),
    ...trajets.filter(socArriveeFiable).map((t) => ({ soc: t.socArrivee, date: t.date, source: 'trajet' })),
    ...releves.map((r) => ({ soc: r.soc, date: r.date, source: 'releve' }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const dernier = evenements[0] ?? { soc: null, date: null, source: null };
  const perime = recharges.some((r) => r.statut === 'terminee' && !estConnu(r.socFin) && r.fin
    && (!dernier.date || new Date(r.fin) > new Date(dernier.date)));
  return { ...dernier, perime };
}

export function autonomieKm(soc, conso, coef, capaciteNette) {
  if (!estConnu(soc)) return null;
  return soc / 100 * capaciteNette / (conso * coef) * 100;
}

// ---------- Trajets et modèles (écran Trajets) ----------

export const kmDesSegments = (segments) => segments.reduce((somme, s) => somme + s.km, 0);
export const typesDuTrajet = (trajet) => [...new Set((trajet.segments ?? []).map((s) => s.type))];

// « Metz → Épinal » → « Épinal → Metz » ; sans flèche : « Nom (retour) ».
export function nomInverse(nom) {
  const parties = String(nom).split(/\s*(?:→|->)\s*/);
  if (parties.length === 2 && parties[0] && parties[1]) return `${parties[1]} → ${parties[0]}`;
  return `${nom} (retour)`;
}

export const segmentsInverses = (segments) => [...segments].reverse().map((s) => ({ ...s }));

export function erreursSegments(segments) {
  if (!segments.length) return ['Ajoute au moins un segment.'];
  return segments.some((s) => !(s.km > 0)) ? ['Chaque segment doit avoir une distance supérieure à 0 km.'] : [];
}

export function erreursTrajet(trajet) {
  const erreurs = [];
  if (!trajet.date) erreurs.push('La date est obligatoire.');
  erreurs.push(...erreursSegments(trajet.segments ?? []));
  if (!pctValide(trajet.socDepart)) erreurs.push('Le % de départ doit être compris entre 0 et 100.');
  if (!pctValide(trajet.socArrivee)) erreurs.push("Le % d'arrivée doit être compris entre 0 et 100.");
  if (estConnu(trajet.consoVoitureKwh100) && !(trajet.consoVoitureKwh100 > 0)) erreurs.push('La conso affichée doit être supérieure à 0.');
  return erreurs;
}

export function etatApprentissage(trajet, capaciteNette) {
  const motif = motifExclusion(trajet, capaciteNette);
  const temperatureConnue = estConnu(trajet.temperatureExt);
  return { motif, temperatureManquante: motif === null && !temperatureConnue, utilisable: motif === null && temperatureConnue };
}

export function resumeModele(trajets, modele, capaciteNette, coefs) {
  return {
    realisations: trajets.filter((t) => t.modeleId === modele.id).length,
    moyenne: consoModele(trajets, modele.id, capaciteNette, coefs)
  };
}

// Lie le modèle A au modèle B (ou le délie si idB est null), en déliant les anciens partenaires.
// Renvoie les copies des modèles modifiés, à enregistrer.
export function lierModeles(modeles, idA, idB = null) {
  const copies = new Map(modeles.map((m) => [m.id, { ...m }]));
  const modifies = new Set();
  const delier = (id) => {
    const modele = copies.get(id);
    if (!modele?.modeleRetourId) return;
    const partenaire = copies.get(modele.modeleRetourId);
    if (partenaire && partenaire.modeleRetourId === id) {
      partenaire.modeleRetourId = null;
      modifies.add(partenaire.id);
    }
    modele.modeleRetourId = null;
    modifies.add(id);
  };
  if ((copies.get(idA).modeleRetourId ?? null) === idB) return [];
  delier(idA);
  if (idB) {
    delier(idB);
    copies.get(idA).modeleRetourId = idB;
    copies.get(idB).modeleRetourId = idA;
    modifies.add(idA);
    modifies.add(idB);
  }
  return [...modifies].map((id) => copies.get(id));
}

export function erreursReleve(releve) {
  const erreurs = [];
  if (!releve.date) erreurs.push('La date est obligatoire.');
  if (!pctValide(releve.soc)) erreurs.push('Le % doit être compris entre 0 et 100.');
  return erreurs;
}

// ---------- Accueil et graphiques (phase 5) ----------

// Clés "AAAA-MM" des n derniers mois, du plus ancien au mois en cours.
export function derniersMois(maintenant, n) {
  const d = new Date(maintenant);
  return Array.from({ length: n }, (_, i) => moisDe(new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1)));
}

export function serieRechargesMensuelle(recharges, capaciteNette, mois) {
  return mois.map((cle) => {
    const t = totauxMois(recharges.filter((r) => r.debut && moisDe(r.debut) === cle), capaciteNette);
    return { mois: cle, kwhPrise: t.kwhPrise, cout: t.cout };
  });
}

// Chiffres du mois pour l'accueil : maison seulement pour les kWh et le coût, tous les trajets pour les km,
// trajets éligibles (7.4) pour la conso moyenne, pondérée par les km.
export function chiffresDuMois({ recharges = [], trajets = [] }, capaciteNette, cle) {
  const totaux = totauxMois(recharges.filter((r) => r.debut && moisDe(r.debut) === cle), capaciteNette);
  const duMois = trajets.filter((t) => t.date && moisDe(t.date) === cle);
  const eligibles = duMois.filter((t) => motifExclusion(t, capaciteNette) === null);
  const kmEligibles = eligibles.reduce((somme, t) => somme + t.kmTotal, 0);
  return {
    kwhPrise: totaux.kwhPrise,
    cout: totaux.cout,
    coutsInconnus: totaux.coutsInconnus,
    recharges: totaux.n,
    km: duMois.reduce((somme, t) => somme + (t.kmTotal ?? 0), 0),
    conso: kmEligibles > 0
      ? eligibles.reduce((somme, t) => somme + consoMesuree(t, capaciteNette) * t.kmTotal, 0) / kmEligibles
      : null
  };
}

// Points du nuage conso / température : trajets utilisables pour l'apprentissage (conso mesurée, pas normalisée).
export function nuageConsoTemperature(trajets, capaciteNette) {
  return trajets
    .filter((t) => estUtilisable(t, capaciteNette))
    .map((t) => ({ x: t.temperatureExt, y: consoMesuree(t, capaciteNette), date: t.date }));
}

// Dernière température saisie, sur une recharge ou un trajet (7.8). Aucune : null.
export function derniereTemperature({ recharges = [], trajets = [] }) {
  const releves = [
    ...recharges.filter((r) => estConnu(r.temperatureExt)).map((r) => ({ t: r.temperatureExt, date: r.fin ?? r.debut })),
    ...trajets.filter((t) => estConnu(t.temperatureExt)).map((t) => ({ t: t.temperatureExt, date: t.date }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));
  return releves[0]?.t ?? null;
}

// Rappel de sauvegarde : jamais sauvegardé, ou dernier export il y a plus de 30 jours (section 8).
export function rappelSauvegarde(derniereSauvegarde, maintenant, aDesDonnees) {
  if (!aDesDonnees) return false;
  if (!derniereSauvegarde) return true;
  return (new Date(maintenant) - new Date(derniereSauvegarde)) / 86400000 > 30;
}
