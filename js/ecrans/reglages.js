// Écran Réglages (CLAUDE.md section 8). L'export et l'import JSON arrivent en phase 6.

import {
  chargerReglages, ecrire, ecrireTous, enregistrerReglages, lireTout, remplacerStore, SCHEMA_VERSION, viderTout
} from '../db.js';
import { construireExport, csvRecharges, csvTrajets, nomFichier, preparerImport, validerImport } from '../export.js';
import {
  appliquerTarif, calibrerPuissance, calibrerRendement, rechargesSansPrix, tarifRenseigne
} from '../calculs.js';
import { COEFS_TEMPERATURE } from '../reference.js';
import { dateCourte, echapper, isoLocal, lireNombre, nombre } from '../format.js';

const STORES_DONNEES = ['recharges', 'trajets', 'modeles', 'releves'];

// Propose un fichier à enregistrer (téléchargement local, aucun envoi réseau).
function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function lireDonnees() {
  const listes = await Promise.all(STORES_DONNEES.map((store) => lireTout(store)));
  return Object.fromEntries(STORES_DONNEES.map((store, i) => [store, listes[i]]));
}

function resumeImport(resume) {
  const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
  return [
    pluriel(resume.recharges, 'recharge', 'recharges'), pluriel(resume.trajets, 'trajet', 'trajets'),
    pluriel(resume.modeles, 'modèle', 'modèles'), pluriel(resume.releves, 'relevé', 'relevés')
  ].join(', ');
}

function rendreSauvegarde(reglages) {
  return `<section class="carte"><h2>Sauvegarde</h2>
    <p class="discret">Dernière sauvegarde : ${reglages.derniereSauvegarde ? dateCourte(reglages.derniereSauvegarde) : 'jamais'}.
      Les données ne sont que sur ce téléphone : exporte-les régulièrement.</p>
    <button type="button" class="btn" data-action="exporter-json">Exporter une sauvegarde (JSON)</button>
    <label class="btn btn-secondaire bouton-fichier">Importer une sauvegarde (JSON)
      <input type="file" accept="application/json,.json" data-import hidden>
    </label>
    <div data-zone-import></div>
    <button type="button" class="btn btn-secondaire" data-action="exporter-csv-recharges">Recharges en CSV (Excel)</button>
    <button type="button" class="btn btn-secondaire" data-action="exporter-csv-trajets">Trajets en CSV (Excel)</button>
  </section>`;
}

// Valeur d'un champ numérique, au format français.
const enChamp = (valeur, decimales) => (valeur === null || valeur === undefined
  ? ''
  : (decimales === undefined ? String(valeur) : valeur.toFixed(decimales)).replace('.', ','));

function champNombre(libelle, champ, valeur, suffixe = '') {
  return `<label class="champ"><span>${libelle}</span>
    <span class="saisie"><input type="text" inputmode="decimal" data-champ="${champ}" value="${echapper(enChamp(valeur))}">${suffixe ? `<span class="unite">${suffixe}</span>` : ''}</span>
  </label>`;
}

const LIBELLES_PALIERS = ['≥ 15 °C', '5 à < 15 °C', '0 à < 5 °C', '< 0 °C'];

function rendreProfil(profil, index, recharges, capacite) {
  const rendement = calibrerRendement(recharges, profil.id, capacite);
  const puissance = calibrerPuissance(recharges, profil.id);
  return `<fieldset class="profil">
    <legend>Profil ${index + 1}</legend>
    <label class="champ"><span>Nom</span><span class="saisie"><input type="text" data-champ="profil.${index}.nom" value="${echapper(profil.nom)}"></span></label>
    ${champNombre('Intensité réglée (facultatif)', `profil.${index}.intensiteA`, profil.intensiteA, 'A')}
    ${profil.intensiteA > 10 ? '<p class="rappel">Réservé à une prise renforcée ou une borne : une prise classique n\'est pas faite pour tenir une forte intensité pendant des heures.</p>' : ''}
    ${champNombre('Puissance', `profil.${index}.puissanceKw`, profil.puissanceKw, 'kW')}
    ${champNombre('Rendement', `profil.${index}.rendement`, profil.rendement)}
    <label class="case"><input type="checkbox" data-champ="profil.${index}.actif" ${profil.actif ? 'checked' : ''}><span>Actif</span></label>
    ${rendement ? `<button type="button" class="btn" data-action="appliquer-rendement" data-index="${index}" data-valeur="${rendement.rendement}" data-n="${rendement.n}">Rendement mesuré : ${nombre(rendement.rendement, 3)} (sur ${rendement.n} recharges) — appliquer ?</button>` : ''}
    ${puissance ? `<button type="button" class="btn" data-action="appliquer-puissance" data-index="${index}" data-valeur="${puissance.puissanceKw}" data-n="${puissance.n}">Puissance moyenne mesurée : ${nombre(puissance.puissanceKw, 1)} kW (sur ${puissance.n} recharges) — appliquer ?</button>` : ''}
  </fieldset>`;
}

function rendreTarif(tarif) {
  const plage = (i) => tarif.plagesHc[i] ?? { debut: '', fin: '' };
  const champsPlage = (i, libelle) => `<div class="plage"><span>${libelle}</span>
    <input type="time" aria-label="${libelle} : début" data-champ="plage.${i}.debut" value="${echapper(plage(i).debut)}">
    <input type="time" aria-label="${libelle} : fin" data-champ="plage.${i}.fin" value="${echapper(plage(i).fin)}">
  </div>`;
  return `<label class="champ"><span>Contrat</span><span class="saisie"><select data-champ="tarif.type">
      <option value="base" ${tarif.type === 'base' ? 'selected' : ''}>Base</option>
      <option value="hphc" ${tarif.type === 'hphc' ? 'selected' : ''}>Heures pleines / creuses</option>
    </select></span></label>
    ${tarif.type === 'base'
    ? champNombre('Prix du kWh TTC', 'tarif.prixBaseKwh', tarif.prixBaseKwh, '€')
    : `${champNombre('Prix heures pleines TTC', 'tarif.prixHpKwh', tarif.prixHpKwh, '€')}
       ${champNombre('Prix heures creuses TTC', 'tarif.prixHcKwh', tarif.prixHcKwh, '€')}
       ${champsPlage(0, 'Plage creuse 1')}
       ${champsPlage(1, 'Plage creuse 2 (facultatif)')}`}`;
}

function rendre(reglages, recharges, ctx) {
  const capacite = reglages.capaciteNetteKwh;
  const coefs = reglages.coefsTemperature ?? COEFS_TEMPERATURE;
  const sansPrix = tarifRenseigne(reglages.tarif) ? rechargesSansPrix(recharges).length : 0;
  return `
    <section class="carte"><h2>Batterie</h2>
      ${champNombre('Capacité nette', 'capaciteNetteKwh', capacite, 'kWh')}
      <p class="discret">Capacité brute : ${nombre(reglages.capaciteBruteKwh, 0)} kWh (information).</p>
    </section>
    <section class="carte"><h2>Profils de charge</h2>
      ${reglages.profilsCharge.map((p, i) => rendreProfil(p, i, recharges, capacite)).join('')}
    </section>
    <section class="carte"><h2>Tarif</h2>
      ${rendreTarif(reglages.tarif)}
      ${sansPrix > 0 ? `<button type="button" class="btn" data-action="appliquer-tarif">Appliquer ce tarif aux ${sansPrix} recharges à domicile sans prix ?</button>` : ''}
    </section>
    <section class="carte"><h2>Simulation et charge</h2>
      ${champNombre("Seuil mini d'arrivée", 'seuilMiniPct', reglages.seuilMiniPct, '%')}
      ${champNombre('Marge de sécurité', 'margeSimulationPct', reglages.margeSimulationPct, '%')}
      ${champNombre('Charge cible habituelle', 'chargeCiblePct', reglages.chargeCiblePct, '%')}
    </section>
    <section class="carte"><details><summary>Coefficients de température (avancé)</summary>
      ${coefs.map((p, i) => champNombre(LIBELLES_PALIERS[i], `coef.${i}`, p.coef)).join('')}
    </details></section>
    <section class="carte"><h2>Affichage</h2>
      <label class="champ"><span>Thème</span><span class="saisie"><select data-champ="theme">
        <option value="sombre" ${reglages.theme !== 'clair' ? 'selected' : ''}>Sombre</option>
        <option value="clair" ${reglages.theme === 'clair' ? 'selected' : ''}>Clair</option>
      </select></span></label>
    </section>
    ${rendreSauvegarde(reglages)}
    <section class="carte"><h2>Appli</h2>
      <p class="discret">Version ${echapper(ctx.version)}.</p>
      <button type="button" class="btn btn-danger" data-action="effacer">Effacer toutes les données</button>
    </section>`;
}

// Applique une saisie aux réglages. Renvoie un message d'erreur, ou null si tout va bien.
function appliquerSaisie(reglages, champ, cible) {
  const brut = cible.type === 'checkbox' ? cible.checked : cible.value;
  const nombreSaisi = lireNombre(brut);
  const parties = champ.split('.');

  if (parties[0] === 'profil') {
    const profil = reglages.profilsCharge[Number(parties[1])];
    const cle = parties[2];
    if (cle === 'nom') {
      if (!String(brut).trim()) return 'Le nom du profil est obligatoire.';
      profil.nom = String(brut).trim();
    } else if (cle === 'actif') {
      profil.actif = brut;
    } else if (cle === 'intensiteA') {
      if (String(brut).trim() !== '' && !(nombreSaisi > 0)) return 'Intensité invalide.';
      profil.intensiteA = nombreSaisi;
    } else if (cle === 'puissanceKw') {
      if (!(nombreSaisi > 0)) return 'La puissance doit être supérieure à 0.';
      profil.puissanceKw = nombreSaisi;
      profil.calibrage.puissanceN = null;
    } else if (cle === 'rendement') {
      if (!(nombreSaisi > 0 && nombreSaisi <= 1)) return 'Le rendement doit être compris entre 0 et 1.';
      profil.rendement = nombreSaisi;
      profil.calibrage.rendementN = null;
    }
    return null;
  }
  if (parties[0] === 'tarif') {
    if (parties[1] === 'type') {
      reglages.tarif.type = brut;
      return null;
    }
    if (String(brut).trim() !== '' && !(nombreSaisi >= 0)) return 'Prix invalide.';
    reglages.tarif[parties[1]] = nombreSaisi;
    return null;
  }
  if (parties[0] === 'plage') {
    const i = Number(parties[1]);
    const plages = reglages.tarif.plagesHc;
    plages[i] = { debut: '', fin: '', ...plages[i], [parties[2]]: brut };
    return null;
  }
  if (parties[0] === 'coef') {
    if (!(nombreSaisi > 0)) return 'Le coefficient doit être supérieur à 0.';
    const coefs = (reglages.coefsTemperature ?? COEFS_TEMPERATURE).map((p) => ({ ...p }));
    coefs[Number(parties[1])].coef = nombreSaisi;
    reglages.coefsTemperature = coefs;
    return null;
  }
  if (champ === 'theme') {
    reglages.theme = brut;
    return null;
  }
  if (champ === 'capaciteNetteKwh' && !(nombreSaisi > 0)) return 'La capacité doit être supérieure à 0.';
  if (['seuilMiniPct', 'margeSimulationPct', 'chargeCiblePct'].includes(champ)
    && !(nombreSaisi >= 0 && nombreSaisi <= 100)) return 'La valeur doit être comprise entre 0 et 100.';
  reglages[champ] = nombreSaisi;
  return null;
}

// Une plage incomplète (début ou fin vide) n'est pas enregistrée dans le calcul.
function nettoyerPlages(reglages) {
  reglages.tarif.plagesHc = reglages.tarif.plagesHc.filter((p) => p && (p.debut || p.fin));
}

export async function afficher(conteneur, ctx) {
  const reglages = await chargerReglages();
  const recharges = await lireTout('recharges');

  const rafraichir = () => { conteneur.innerHTML = rendre(reglages, recharges, ctx); };
  let importEnAttente = null;

  // Lecture et contrôle du fichier choisi : rien n'est écrit avant la confirmation.
  async function lireFichierImport(fichier) {
    const zone = conteneur.querySelector('[data-zone-import]');
    importEnAttente = null;
    let objet;
    try {
      objet = JSON.parse(await fichier.text());
    } catch {
      zone.innerHTML = '<p class="rappel">Ce fichier n\'est pas un JSON lisible.</p>';
      return;
    }
    const { erreurs, resume } = validerImport(objet, SCHEMA_VERSION);
    if (erreurs.length) {
      zone.innerHTML = `<p class="rappel">Fichier refusé :<br>${erreurs.map(echapper).join('<br>')}</p>`;
      return;
    }
    importEnAttente = objet;
    zone.innerHTML = `<div class="import-resume">
      <p><strong>${echapper(fichier.name)}</strong> : ${resumeImport(resume)}${objet.dateExport ? `, exporté le ${dateCourte(objet.dateExport)}` : ''}.</p>
      <label class="case"><input type="radio" name="modeImport" value="fusionner" checked><span>Fusionner avec les données du téléphone</span></label>
      <label class="case"><input type="radio" name="modeImport" value="remplacer"><span>Remplacer toutes les données du téléphone</span></label>
      <button type="button" class="btn" data-action="confirmer-import">Importer</button>
      <button type="button" class="btn btn-secondaire" data-action="annuler-import">Annuler</button>
    </div>`;
  }

  conteneur.onchange = async (evenement) => {
    const cible = evenement.target;
    if (cible.matches('[data-import]')) {
      if (cible.files[0]) await lireFichierImport(cible.files[0]);
      return;
    }
    const champ = cible.dataset.champ;
    if (!champ) return;
    const erreur = appliquerSaisie(reglages, champ, cible);
    if (erreur) ctx.afficherToast(erreur);
    else {
      if (champ.startsWith('plage.')) nettoyerPlages(reglages);
      await enregistrerReglages(reglages);
      if (champ === 'theme') ctx.appliquerTheme(reglages.theme);
    }
    rafraichir();
  };

  conteneur.onclick = async (evenement) => {
    const bouton = evenement.target.closest('[data-action]');
    if (!bouton) return;
    const { action, index, valeur, n } = bouton.dataset;
    if (action === 'appliquer-rendement' || action === 'appliquer-puissance') {
      const profil = reglages.profilsCharge[Number(index)];
      if (action === 'appliquer-rendement') {
        profil.rendement = Number(valeur);
        profil.calibrage.rendementN = Number(n);
      } else {
        profil.puissanceKw = Number(valeur);
        profil.calibrage.puissanceN = Number(n);
      }
      await enregistrerReglages(reglages);
      ctx.afficherToast('Valeur mesurée appliquée.');
    } else if (action === 'appliquer-tarif') {
      const modifiees = appliquerTarif(recharges, reglages.tarif);
      for (const recharge of modifiees) {
        await ecrire('recharges', recharge);
        recharges[recharges.findIndex((r) => r.id === recharge.id)] = recharge;
      }
      ctx.afficherToast(`Tarif appliqué à ${modifiees.length} recharges.`);
    } else if (action === 'exporter-json') {
      // Date notée avant l'export, pour que le fichier la contienne aussi.
      const maintenant = isoLocal(new Date());
      reglages.derniereSauvegarde = maintenant;
      await enregistrerReglages(reglages);
      const sauvegarde = construireExport({ reglages, ...(await lireDonnees()) }, SCHEMA_VERSION, maintenant);
      telecharger(nomFichier(new Date(), 'json'), JSON.stringify(sauvegarde, null, 2), 'application/json');
      ctx.afficherToast('Sauvegarde exportée.');
    } else if (action === 'exporter-csv-recharges' || action === 'exporter-csv-trajets') {
      const donnees = await lireDonnees();
      const [suffixe, csv] = action === 'exporter-csv-recharges'
        ? ['-recharges', csvRecharges(donnees.recharges, reglages)]
        : ['-trajets', csvTrajets(donnees.trajets, reglages, donnees.modeles)];
      telecharger(nomFichier(new Date(), 'csv', suffixe), csv, 'text/csv;charset=utf-8');
      return;
    } else if (action === 'annuler-import') {
      importEnAttente = null;
    } else if (action === 'confirmer-import') {
      if (!importEnAttente) return;
      const mode = conteneur.querySelector('[name="modeImport"]:checked')?.value ?? 'fusionner';
      if (mode === 'remplacer' && !window.confirm('Remplacer toutes les données de ce téléphone par celles du fichier ? Celles qui ne sont pas dans le fichier seront perdues.')) return;
      const resultat = preparerImport({ reglages, ...(await lireDonnees()) }, importEnAttente, mode);
      await enregistrerReglages(resultat.reglages);
      for (const store of STORES_DONNEES) {
        await (mode === 'remplacer' ? remplacerStore : ecrireTous)(store, resultat[store]);
      }
      Object.assign(reglages, resultat.reglages);
      recharges.splice(0, recharges.length, ...resultat.recharges);
      importEnAttente = null;
      ctx.appliquerTheme(reglages.theme);
      ctx.afficherToast(`Import terminé : ${resumeImport(Object.fromEntries(STORES_DONNEES.map((s) => [s, resultat[s].length])))}.`);
    } else if (action === 'effacer') {
      if (!window.confirm('Effacer toutes les recharges, tous les trajets et tous les réglages ?')) return;
      if (!window.confirm('Dernière confirmation : cette action est définitive. Tout effacer ?')) return;
      await viderTout();
      Object.assign(reglages, await chargerReglages());
      recharges.length = 0;
      ctx.appliquerTheme(reglages.theme);
      ctx.afficherToast('Toutes les données ont été effacées.');
    }
    rafraichir();
  };

  rafraichir();
}
