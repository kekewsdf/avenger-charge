// Écran Recharges (CLAUDE.md section 8) : saisie en 2 temps, saisie complète, liste, détail, calculateur.
// Aucun gestionnaire en ligne (onclick=...) : la CSP l'interdit, tout passe par la délégation d'événements.

import { chargerReglages, ecrire, lireTout, supprimer } from '../db.js';
import {
  arrondirMinute, besoinCharge, branchementAuPlusTard, calculateurCharge, calculerRecharge, coutCharge,
  coutRecharge, debutEstime, dernierPctConnu, erreursRecharge, figerTarif, heureBranchementSuspecte,
  kwhHorsBatterie, moisDe, parserDureeCable, profilParDefaut, socEstime, totauxMois, derniersMois,
  serieRechargesMensuelle
} from '../calculs.js';
import {
  dateCourte, dureeCable, dureeHeures, echapper, euros, heureRelative, isoLocal, kwh, lireNombre, moisCourt,
  nomMois, nombre, pct, rendement
} from '../format.js';
import { champ, enChamp, montrerErreurs } from './formulaire.js';
import { blocGraphique, detruireGraphiques, graphiqueBarres } from '../graphiques.js';

const LIEN_TARIF = '<a href="#reglages">renseigner le tarif</a>';

let ecouteurToggle = null;

// Formulaire à ouvrir au prochain affichage de l'écran, demandé depuis l'accueil.
let brouillon = null;
export function ouvrirAvec(mode, id = null) {
  brouillon = { mode, id };
}

function choixProfil(profils, profilId) {
  const actifs = profils.filter((p) => p.actif || p.id === profilId);
  return `<label class="champ"><span>Profil</span><span class="saisie"><select name="profilId">
    ${actifs.map((p) => `<option value="${p.id}" ${p.id === profilId ? 'selected' : ''}>${echapper(p.nom)}</option>`).join('')}
  </select></span></label>`;
}

// ---------- Calculateur de charge (7.2) ----------

function rendreCalculateur(d) {
  const { reglages } = d;
  const profil = profilParDefaut(reglages.profilsCharge, d.recharges);
  if (!profil) return '';
  const dernier = dernierPctConnu(d);
  return `<section class="carte"><details ${d.calculateurOuvert ? 'open' : ''} data-calculateur>
    <summary>Calculateur de charge</summary>
    <form data-formulaire="calculateur">
      ${champ('% actuel', 'actuel', dernier.perime ? '' : enChamp(dernier.soc), { decimal: true })}
      ${champ('% cible', 'cible', enChamp(reglages.chargeCiblePct), { decimal: true })}
      ${choixProfil(reglages.profilsCharge, profil.id)}
      <div class="bascule">
        <label><input type="radio" name="mode" value="branchement" checked> Je branche à</label>
        <label><input type="radio" name="mode" value="depart"> Je pars à</label>
      </div>
      ${champ('Heure', 'heure', isoLocal(new Date()), { type: 'datetime-local' })}
      <div data-resultat-calcul aria-live="polite"></div>
    </form>
  </details></section>`;
}

function resultatCalculateur(formulaire, d) {
  const donnees = new FormData(formulaire);
  const actuel = lireNombre(donnees.get('actuel'));
  const cible = lireNombre(donnees.get('cible'));
  const profil = d.reglages.profilsCharge.find((p) => p.id === donnees.get('profilId'));
  const heure = donnees.get('heure');
  if (actuel === null || cible === null || !profil || !heure) return '<p class="discret">Renseigne le % actuel et le % cible.</p>';
  if (actuel < 0 || cible > 100 || cible <= actuel) return '<p class="rappel">Le % cible doit être plus haut que le % actuel, et au plus 100 %.</p>';

  const capacite = d.reglages.capaciteNetteKwh;
  const tarif = d.reglages.tarif;
  const source = profil.calibrage?.puissanceN
    ? `estimation basée sur ${profil.calibrage.puissanceN} recharges`
    : 'valeur par défaut';
  const besoin = besoinCharge(actuel, cible, profil, capacite);
  let ligneHeure;
  let branchement;
  if (donnees.get('mode') === 'depart') {
    const maintenant = new Date();
    const auPlusTard = branchementAuPlusTard(heure, besoin.dureeH);
    branchement = auPlusTard < maintenant ? maintenant : auPlusTard;
    ligneHeure = auPlusTard < maintenant
      ? `<p class="rappel">Trop tard pour atteindre ${pct(cible)} : branche dès maintenant.</p>`
      : `<p class="resultat-principal">Branche au plus tard ${heureRelative(auPlusTard)}</p>`;
  } else {
    branchement = new Date(heure);
    const fin = arrondirMinute(calculateurCharge({ actuel, cible, profil, branchement, capaciteNette: capacite, tarif }).heureFin);
    ligneHeure = `<p class="resultat-principal">Fin prévue ${heureRelative(fin)}</p>`;
  }
  const fin = new Date(branchement.getTime() + besoin.dureeH * 3600000);
  const { cout } = coutCharge(branchement, fin, besoin.kwhPrise, tarif);
  return `${ligneHeure}
    <dl class="valeurs">
      <dt>Durée</dt><dd>${dureeHeures(besoin.dureeH)}</dd>
      <dt>kWh batterie</dt><dd>${kwh(besoin.kwhBatterie)}</dd>
      <dt>kWh prise</dt><dd>${kwh(besoin.kwhPrise)}</dd>
      <dt>Coût</dt><dd>${cout === null ? `— (${LIEN_TARIF})` : euros(cout)}</dd>
    </dl>
    <p class="discret">Puissance ${nombre(profil.puissanceKw, 1)} kW : ${source}.</p>`;
}

// ---------- Liste ----------

export function rendreEnCours(r, d) {
  const capacite = d.reglages.capaciteNetteKwh;
  const estime = socEstime(r, new Date(), capacite);
  const cible = d.reglages.chargeCiblePct;
  let fin = '';
  if (r.puissanceKw && r.rendementUtilise && r.socDebut < cible) {
    const calcul = calculateurCharge({
      actuel: r.socDebut, cible, profil: { puissanceKw: r.puissanceKw, rendement: r.rendementUtilise },
      branchement: r.debut, capaciteNette: capacite, tarif: null
    });
    fin = `, fin à ${pct(cible)} prévue ${heureRelative(arrondirMinute(calcul.heureFin))}`;
  }
  return `<section class="carte banniere-recharge-en-cours">
    <p>Branchée depuis ${heureRelative(r.debut)} à ${pct(r.socDebut)} → ~${nombre(estime, 0)} % estimés maintenant${fin}.</p>
    <button type="button" class="btn" data-action="debrancher" data-id="${r.id}">Je débranche</button>
  </section>`;
}

function ligneRecharge(r, capacite) {
  const calc = calculerRecharge(r, capacite);
  const publique = r.lieu === 'public';
  const cout = publique ? null : coutRecharge(r, capacite).cout;
  const marque = calc.kwhPriseEstMesure ? '<span class="badge" title="mesuré">mesuré</span>' : '<span class="badge badge-discret" title="estimé">estimé</span>';
  return `<button type="button" class="ligne" data-action="detail" data-id="${r.id}">
    <span class="ligne-haut"><strong>${dateCourte(r.debut)}</strong>${publique ? '<span class="badge">Borne publique</span>' : ''}</span>
    <span class="ligne-bas">
      <span>${pct(r.socDebut)} → ${pct(r.socFin)}</span>
      <span>${dureeHeures(calc.dureeChargeH)}</span>
      <span>${kwh(calc.kwhBatterie)} batt.</span>
      <span>${kwh(calc.kwhPrise)} prise ${publique ? '' : marque}</span>
      <span>${euros(cout)}</span>
    </span>
  </button>`;
}

function rendreListe(d) {
  const capacite = d.reglages.capaciteNetteKwh;
  const enCours = d.recharges.filter((r) => r.statut === 'en_cours').sort((a, b) => new Date(b.debut) - new Date(a.debut));
  const terminees = d.recharges.filter((r) => r.statut === 'terminee').sort((a, b) => new Date(b.debut) - new Date(a.debut));
  const parMois = new Map();
  for (const r of terminees) {
    const cle = moisDe(r.debut);
    if (!parMois.has(cle)) parMois.set(cle, []);
    parMois.get(cle).push(r);
  }
  const profil = profilParDefaut(d.reglages.profilsCharge, d.recharges);
  const mois = [...parMois].map(([cle, liste]) => {
    const t = totauxMois(liste, capacite);
    const cout = t.cout === null ? '—' : `${euros(t.cout)}${t.coutsInconnus ? ' (incomplet)' : ''}`;
    return `<section class="carte">
      <h2>${nomMois(cle)}</h2>
      <p class="discret">Maison : ${kwh(t.kwhPrise)} tirés sur la prise · ${cout}</p>
      ${liste.map((r) => ligneRecharge(r, capacite)).join('')}
    </section>`;
  }).join('');
  return `
    ${enCours.map((r) => rendreEnCours(r, d)).join('')}
    ${profil
    ? '<button type="button" class="btn" data-action="brancher">Je branche</button>'
    : '<p class="rappel">Aucun profil de charge actif : <a href="#reglages">active-en un dans Réglages</a>.</p>'}
    ${profil ? '<button type="button" class="btn btn-secondaire" data-action="complete">Saisir une recharge passée</button>' : ''}
    ${rendreCalculateur(d)}
    ${mois || '<p class="discret vide">Aucune recharge terminée pour l\'instant.</p>'}
    ${terminees.length ? rendreGraphiques(d) : ''}`;
}

// ---------- Graphiques (6 derniers mois, maison seulement) ----------

function serieGraphiques(d) {
  return serieRechargesMensuelle(d.recharges, d.reglages.capaciteNetteKwh, derniersMois(new Date(), 6));
}

function rendreGraphiques(d) {
  const serie = serieGraphiques(d);
  const lignesKwh = serie.map((m) => [nomMois(m.mois), kwh(m.kwhPrise)]);
  const lignesCout = serie.map((m) => [nomMois(m.mois), euros(m.cout)]);
  return `<section class="carte"><h2>Par mois, à la maison</h2>
    ${blocGraphique('kwh', 'kWh tirés sur la prise', ['Mois', 'kWh prise'], lignesKwh)}
    ${blocGraphique('cout', 'Coût', ['Mois', 'Coût'], lignesCout)}
  </section>`;
}

function dessinerGraphiques(d) {
  const serie = serieGraphiques(d);
  const etiquettes = serie.map((m) => moisCourt(m.mois));
  const canvasKwh = d.conteneur.querySelector('[data-graphique="kwh"]');
  const canvasCout = d.conteneur.querySelector('[data-graphique="cout"]');
  if (canvasKwh) {
    graphiqueBarres(canvasKwh, {
      etiquettes, series: [{ nom: 'kWh prise', valeurs: serie.map((m) => m.kwhPrise), couleur: 'serie1' }],
      unite: 'kWh', formater: (v) => nombre(v, 2), titreY: 'kWh'
    });
  }
  if (canvasCout) {
    graphiqueBarres(canvasCout, {
      etiquettes, series: [{ nom: 'Coût', valeurs: serie.map((m) => m.cout), couleur: 'serie1' }],
      unite: '€', formater: (v) => nombre(v, 2), titreY: '€'
    });
  }
}

// ---------- Détail ----------

function rendreDetail(d, r) {
  const capacite = d.reglages.capaciteNetteKwh;
  const calc = calculerRecharge(r, capacite);
  const publique = r.lieu === 'public';
  const profil = d.reglages.profilsCharge.find((p) => p.id === r.profilId);
  const { cout, kwhHc, kwhHp } = publique ? { cout: null } : coutRecharge(r, capacite);
  const hors = profil?.calibrage?.rendementN ? kwhHorsBatterie(r, profil.rendement, capacite) : null;
  const ligne = (libelle, valeur) => `<dt>${libelle}</dt><dd>${valeur}</dd>`;
  return `<section class="carte">
    <h2>Recharge du ${dateCourte(r.debut)}</h2>
    ${publique ? '<p><span class="badge">Borne publique</span></p>' : ''}
    ${heureBranchementSuspecte(r) ? '<p class="rappel">Heure de branchement probablement fausse : la durée du câble dépasse le temps branché.</p>' : ''}
    <dl class="valeurs">
      ${ligne('Branchement', `${dateCourte(r.debut)}${r.debutEstime ? ' (estimé)' : ''}`)}
      ${ligne('Débranchement', r.fin ? dateCourte(r.fin) : '—')}
      ${ligne('Profil', profil ? echapper(profil.nom) : '—')}
      ${ligne('%', `${pct(r.socDebut)} → ${pct(r.socFin)}`)}
      ${ligne('Durée branchée', dureeHeures(calc.dureeBrancheeH))}
      ${ligne('Durée de charge', `${dureeHeures(calc.dureeChargeH)}${r.dureeCableS ? ' (câble)' : ''}`)}
      ${ligne('kWh batterie', kwh(calc.kwhBatterie))}
      ${ligne('kWh prise', `${kwh(calc.kwhPrise)} ${calc.kwhPrise === null ? '' : (calc.kwhPriseEstMesure ? '(mesuré)' : '(estimé)')}`)}
      ${ligne('Rendement mesuré', rendement(calc.rendementMesure))}
      ${ligne('Puissance moyenne', calc.puissanceMoyenne === null ? '—' : `${nombre(calc.puissanceMoyenne, 2)} kW`)}
      ${ligne('Gain', calc.pctParHeure === null ? '—' : `${nombre(calc.pctParHeure, 2)} %/h`)}
      ${ligne('Coût', publique ? '—' : (cout === null ? `— (${LIEN_TARIF})` : euros(cout)))}
      ${kwhHc !== null && kwhHc !== undefined ? ligne('Heures creuses / pleines', `${kwh(kwhHc)} / ${kwh(kwhHp)}`) : ''}
      ${ligne('Température', r.temperatureExt === null || r.temperatureExt === undefined ? '—' : `${nombre(r.temperatureExt, 0)} °C`)}
      ${ligne('Préconditionnement', r.preconditionnement ? 'oui' : 'non')}
    </dl>
    ${hors ? `<p class="discret">dont ≈ ${kwh(hors)} hors batterie (préconditionnement)</p>` : ''}
    ${r.note ? `<p>${echapper(r.note)}</p>` : ''}
    ${publique ? '' : `<button type="button" class="btn" data-action="modifier" data-id="${r.id}">Modifier</button>`}
    <button type="button" class="btn btn-danger" data-action="supprimer" data-id="${r.id}">Supprimer</button>
    <button type="button" class="btn btn-secondaire" data-action="retour">Retour</button>
  </section>`;
}

// ---------- Formulaires de saisie ----------

const TITRES = {
  brancher: 'Je branche',
  debrancher: 'Je débranche',
  complete: 'Recharge passée',
  modifier: 'Modifier la recharge'
};

function champsFin(r) {
  return `
    ${champ('Heure de débranchement', 'fin', r.fin ?? isoLocal(new Date()), { type: 'datetime-local' })}
    ${champ('% final', 'socFin', enChamp(r.socFin), { decimal: true, attributs: 'required' })}
    <div class="mise-en-avant">
      ${champ('kWh affichés par le câble', 'kwhPriseMesure', enChamp(r.kwhPriseMesure), { decimal: true, aide: 'À relever avant de débrancher' })}
    </div>
    ${champ('Durée affichée par le câble', 'dureeCable', dureeCable(r.dureeCableS), { aide: 'hh:mm:ss, facultatif', attributs: 'placeholder="03:14:09" inputmode="numeric"' })}
    ${champ('Température extérieure', 'temperatureExt', enChamp(r.temperatureExt), { decimal: true, aide: '°C, facultatif' })}
    <label class="case"><input type="checkbox" name="preconditionnement" ${r.preconditionnement ? 'checked' : ''}><span>Préconditionnement lancé pendant la charge</span></label>`;
}

function rendreFormulaire(d, mode, r = {}) {
  const profilId = r.profilId ?? profilParDefaut(d.reglages.profilsCharge, d.recharges)?.id;
  const avecDebut = mode !== 'debrancher';
  const avecFin = mode !== 'brancher';
  return `<section class="carte"><h2>${TITRES[mode]}</h2>
    <form data-formulaire="${mode}" data-id="${r.id ?? ''}" novalidate>
      ${mode === 'debrancher' ? `<p class="discret">Branchée ${heureRelative(r.debut)} à ${pct(r.socDebut)}.</p>` : ''}
      ${avecDebut ? `
        ${champ('Heure de branchement', 'debut', r.debut ?? isoLocal(new Date()), { type: 'datetime-local' })}
        ${mode === 'complete' ? '<label class="case"><input type="checkbox" name="debutInconnu"><span>Heure de branchement inconnue (déduite de la durée du câble)</span></label>' : ''}
        ${champ('% au branchement', 'socDebut', enChamp(r.socDebut), { decimal: true, attributs: 'required' })}
        ${choixProfil(d.reglages.profilsCharge, profilId)}` : ''}
      ${avecFin ? champsFin(r) : ''}
      ${mode === 'brancher' ? '' : champ('Note', 'note', r.note ?? '', { aide: 'facultatif' })}
      <p class="rappel" data-erreurs hidden></p>
      <button type="submit" class="btn">Enregistrer</button>
      <button type="button" class="btn btn-secondaire" data-action="retour">Annuler</button>
    </form>
  </section>`;
}

// Construit la recharge à partir du formulaire. Renvoie { recharge } ou { erreurs }.
function lireFormulaire(formulaire, mode, d) {
  const donnees = new FormData(formulaire);
  const existante = d.recharges.find((r) => r.id === formulaire.dataset.id);
  const r = existante ? { ...existante } : {
    id: crypto.randomUUID(), statut: 'en_cours', fin: null, socFin: null, kwhPriseMesure: null, dureeCableS: null,
    preconditionnement: false, temperatureExt: null, kmCompteur: null, prixApplique: null, lieu: 'domicile',
    source: 'manuel', abrpId: null, haSessionId: null, kwhHcMesure: null, kwhHpMesure: null, note: ''
  };
  const erreurs = [];

  if (mode !== 'debrancher') {
    r.debut = donnees.get('debut') || null;
    r.socDebut = lireNombre(donnees.get('socDebut'));
    const profil = d.reglages.profilsCharge.find((p) => p.id === donnees.get('profilId'));
    if (profil && profil.id !== existante?.profilId) {
      r.profilId = profil.id;
      r.puissanceKw = profil.puissanceKw;
      r.rendementUtilise = profil.rendement;
    }
  }
  if (mode !== 'brancher') {
    r.statut = 'terminee';
    r.fin = donnees.get('fin') || null;
    r.socFin = lireNombre(donnees.get('socFin'));
    r.kwhPriseMesure = lireNombre(donnees.get('kwhPriseMesure'));
    const texteDuree = String(donnees.get('dureeCable') ?? '').trim();
    r.dureeCableS = texteDuree === '' ? null : parserDureeCable(texteDuree);
    if (texteDuree !== '' && r.dureeCableS === null) erreurs.push('Durée du câble invalide : format hh:mm:ss (ex. 03:14:09).');
    r.temperatureExt = lireNombre(donnees.get('temperatureExt'));
    r.preconditionnement = donnees.get('preconditionnement') === 'on';
    r.note = String(donnees.get('note') ?? '').trim();
    if (donnees.get('debutInconnu') === 'on') {
      if (!r.fin || r.dureeCableS === null) erreurs.push("Sans heure de branchement, l'heure de débranchement et la durée du câble sont obligatoires.");
      else {
        r.debut = isoLocal(debutEstime(r.fin, r.dureeCableS));
        r.debutEstime = true;
      }
    } else if (mode === 'complete') {
      r.debutEstime = false;
    }
  }
  if (!r.prixApplique) r.prixApplique = figerTarif(d.reglages.tarif);
  erreurs.push(...erreursRecharge(r));
  return erreurs.length ? { erreurs } : { recharge: r };
}

// ---------- Écran ----------

function rendre(d) {
  const { vue } = d;
  const recharge = d.recharges.find((r) => r.id === vue.id);
  detruireGraphiques(d.conteneur);
  if (vue.nom === 'detail' && recharge) d.conteneur.innerHTML = rendreDetail(d, recharge);
  else if (vue.nom === 'formulaire') d.conteneur.innerHTML = rendreFormulaire(d, vue.mode, recharge);
  else {
    d.vue = { nom: 'liste' };
    d.conteneur.innerHTML = rendreListe(d);
    const calculateur = d.conteneur.querySelector('[data-formulaire="calculateur"]');
    if (calculateur) calculateur.querySelector('[data-resultat-calcul]').innerHTML = resultatCalculateur(calculateur, d);
    dessinerGraphiques(d);
  }
  window.scrollTo(0, 0);
}

export async function afficher(conteneur, ctx) {
  const d = { conteneur, ctx, vue: { nom: 'liste' }, calculateurOuvert: false };
  const charger = async () => {
    [d.reglages, d.recharges, d.trajets, d.releves] = await Promise.all([
      chargerReglages(), lireTout('recharges'), lireTout('trajets'), lireTout('releves')
    ]);
  };
  await charger();
  if (brouillon) {
    d.vue = { nom: 'formulaire', mode: brouillon.mode, id: brouillon.id };
    brouillon = null;
  }

  conteneur.onclick = async (evenement) => {
    const bouton = evenement.target.closest('[data-action]');
    if (!bouton) return;
    const { action, id } = bouton.dataset;
    if (action === 'brancher' || action === 'complete') d.vue = { nom: 'formulaire', mode: action };
    else if (action === 'debrancher' || action === 'modifier') d.vue = { nom: 'formulaire', mode: action, id };
    else if (action === 'detail') d.vue = { nom: 'detail', id };
    else if (action === 'retour') d.vue = { nom: 'liste' };
    else if (action === 'supprimer') {
      if (!window.confirm('Supprimer cette recharge ? Cette action est définitive.')) return;
      await supprimer('recharges', id);
      await charger();
      d.vue = { nom: 'liste' };
      ctx.afficherToast('Recharge supprimée.');
    }
    rendre(d);
  };

  conteneur.oninput = (evenement) => {
    const calculateur = evenement.target.closest('[data-formulaire="calculateur"]');
    if (calculateur) calculateur.querySelector('[data-resultat-calcul]').innerHTML = resultatCalculateur(calculateur, d);
  };
  conteneur.onchange = conteneur.oninput;

  // « toggle » ne remonte pas : écoute en capture, une seule fois même si l'écran est réaffiché.
  if (ecouteurToggle) conteneur.removeEventListener('toggle', ecouteurToggle, true);
  ecouteurToggle = (evenement) => {
    if (evenement.target.matches('[data-calculateur]')) d.calculateurOuvert = evenement.target.open;
  };
  conteneur.addEventListener('toggle', ecouteurToggle, true);

  conteneur.onsubmit = async (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.target;
    const mode = formulaire.dataset.formulaire;
    if (mode === 'calculateur') return;
    const resultat = lireFormulaire(formulaire, mode, d);
    if (resultat.erreurs) {
      montrerErreurs(formulaire, resultat.erreurs);
      return;
    }
    await ecrire('recharges', resultat.recharge);
    await charger();
    d.vue = { nom: 'liste' };
    rendre(d);
    ctx.afficherToast(heureBranchementSuspecte(resultat.recharge)
      ? 'Enregistrée. Attention : heure de branchement probablement fausse.'
      : 'Recharge enregistrée.');
  };

  rendre(d);
}
