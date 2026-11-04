// Écran Trajets (CLAUDE.md section 8) : trajets effectués, modèles (avec modèle retour), relevés de %,
// conso apprise (7.4 à 7.6). L'import ABRP arrive en phase 3 bis, les graphiques en phase 5.

import { chargerReglages, ecrire, lireTout, supprimer } from '../db.js';
import {
  consoMesuree, consoNormalisee, consoParType, dernierPctConnu, erreursReleve, erreursSegments, erreursTrajet,
  etatApprentissage, kmDesSegments, kwhConsommes, lierModeles, nomInverse, resumeModele, segmentsInverses,
  typesDuTrajet, nuageConsoTemperature
} from '../calculs.js';
import { CONSO_REFERENCE, TYPES_SEGMENT } from '../reference.js';
import { blocGraphique, detruireGraphiques, graphiqueBarres, graphiqueNuage } from '../graphiques.js';
import { consoKwh100, dateCourte, echapper, isoLocal, kwh, lireNombre, nombre, pct } from '../format.js';
import {
  champ, editeurSegments, enChamp, gererSegments, LIBELLES_TYPES as LIBELLES, ligneSegment, lireSegments, montrerErreurs
} from './formulaire.js';

export const resumeSegments = (segments) => segments.map((s) => `${LIBELLES[s.type]} ${nombre(s.km, 0)} km`).join(' · ');

// Formulaire à ouvrir au prochain affichage de l'écran, pré-rempli depuis un autre écran (le simulateur).
let brouillon = null;
export function ouvrirAvec(vue, donnees) {
  brouillon = { vue, donnees };
}

// ---------- Liste des trajets ----------

function badgesTrajet(trajet, capacite) {
  const etat = etatApprentissage(trajet, capacite);
  return [
    trajet.source === 'abrp' ? '<span class="badge">ABRP</span>' : '',
    etat.motif ? `<span class="badge badge-alerte">non pris en compte : ${echapper(etat.motif)}</span>` : '',
    etat.temperatureManquante ? '<span class="badge badge-discret">température manquante</span>' : ''
  ].join('');
}

function ligneTrajet(trajet, capacite) {
  return `<button type="button" class="ligne" data-action="detail" data-id="${trajet.id}">
    <span class="ligne-haut"><strong>${dateCourte(trajet.date)}</strong><span>${nombre(trajet.kmTotal, 0)} km</span></span>
    <span class="ligne-bas">
      <span>${pct(trajet.socDepart)} → ${pct(trajet.socArrivee)}</span>
      <span>${consoKwh100(consoMesuree(trajet, capacite))}</span>
      <span>${typesDuTrajet(trajet).map((t) => LIBELLES[t]).join(', ')}</span>
    </span>
    <span class="badges">${badgesTrajet(trajet, capacite)}</span>
  </button>`;
}

function rendreMaConso(d) {
  const { capacite, coefs } = d;
  return `<section class="carte"><h2>Ma conso</h2>
    <p class="discret">Consommations ramenées à 15 °C, utilisées par le simulateur.</p>
    <dl class="valeurs">
      ${TYPES_SEGMENT.map((type) => {
    const r = consoParType(d.trajets, type, capacite, coefs);
    const source = r.source === 'perso' ? `Ta moyenne (${r.n} trajets)` : 'Valeur de référence';
    return `<dt>${type === 'mixte' ? 'Mixte (tous trajets)' : LIBELLES[type]}</dt>
          <dd>${consoKwh100(r.conso)}<small class="discret">${source}</small></dd>`;
  }).join('')}
    </dl>
  </section>`;
}

function rendreReleves(d) {
  const releves = [...d.releves].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  if (!releves.length) return '';
  return `<section class="carte"><details><summary>Relevés de % (${d.releves.length})</summary>
    ${releves.map((r) => `<div class="ligne-releve">
      <span>${dateCourte(r.date)} : <strong>${pct(r.soc)}</strong>${r.note ? ` · ${echapper(r.note)}` : ''}</span>
      <button type="button" class="btn-icone" data-action="supprimer-releve" data-id="${r.id}" aria-label="Supprimer ce relevé">✕</button>
    </div>`).join('')}
  </details></section>`;
}

function rendreOnglets(actif) {
  const bouton = (onglet, libelle) => `<button type="button" class="onglet" data-action="onglet" data-onglet="${onglet}" aria-pressed="${actif === onglet}">${libelle}</button>`;
  return `<div class="onglets">${bouton('trajets', 'Trajets')}${bouton('modeles', 'Mes trajets enregistrés')}</div>`;
}

function rendreListeTrajets(d) {
  const filtre = d.filtre;
  const trajets = d.trajets
    .filter((t) => filtre === 'tous' || typesDuTrajet(t).includes(filtre))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const puce = (valeur, libelle) => `<button type="button" class="puce" data-action="filtre" data-type="${valeur}" aria-pressed="${filtre === valeur}">${libelle}</button>`;
  return `${rendreOnglets('trajets')}
    <button type="button" class="btn" data-action="nouveau-trajet">+ Trajet</button>
    <button type="button" class="btn btn-secondaire" data-action="nouveau-releve">Noter le %</button>
    ${rendreMaConso(d)}
    ${rendreReleves(d)}
    <section class="carte">
      <h2>Trajets effectués</h2>
      <div class="puces">${puce('tous', 'Tous')}${TYPES_SEGMENT.map((t) => puce(t, LIBELLES[t])).join('')}</div>
      ${trajets.map((t) => ligneTrajet(t, d.capacite)).join('') || '<p class="discret vide">Aucun trajet pour ce filtre.</p>'}
    </section>
    ${d.trajets.length ? rendreGraphiques(d) : ''}`;
}

// ---------- Graphiques ----------

function donneesParType(d) {
  return TYPES_SEGMENT.map((type) => {
    const perso = consoParType(d.trajets, type, d.capacite, d.coefs);
    return { type, perso: perso.source === 'perso' ? perso.conso : null, n: perso.n, reference: CONSO_REFERENCE[type] };
  });
}

function rendreGraphiques(d) {
  const parType = donneesParType(d);
  const points = nuageConsoTemperature(d.trajets, d.capacite);
  return `<section class="carte"><h2>Graphiques</h2>
    ${blocGraphique('par-type', 'Conso par type de route, à 15 °C', ['Type', 'Ta moyenne', 'Référence'],
    parType.map((l) => [LIBELLES[l.type], l.perso === null ? '— (moins de 3 trajets)' : `${consoKwh100(l.perso)} (${l.n})`, consoKwh100(l.reference)]))}
    ${points.length
    ? blocGraphique('nuage', 'Conso selon la température', ['Date', 'Température', 'Conso'],
      points.map((p) => [dateCourte(p.date), `${nombre(p.x, 0)} °C`, consoKwh100(p.y)]))
    : '<p class="discret">Le nuage conso / température apparaîtra dès un trajet utilisable (éligible et avec sa température).</p>'}
  </section>`;
}

function dessinerGraphiques(d) {
  const canvasType = d.conteneur.querySelector('[data-graphique="par-type"]');
  const canvasNuage = d.conteneur.querySelector('[data-graphique="nuage"]');
  if (canvasType) {
    const parType = donneesParType(d);
    graphiqueBarres(canvasType, {
      etiquettes: parType.map((l) => LIBELLES[l.type]),
      series: [
        { nom: 'Ta moyenne', valeurs: parType.map((l) => l.perso), couleur: 'serie1' },
        { nom: 'Référence', valeurs: parType.map((l) => l.reference), couleur: 'serie2' }
      ],
      unite: 'kWh/100 km', formater: (v) => nombre(v, 1), titreY: 'kWh/100 km'
    });
  }
  if (canvasNuage) {
    graphiqueNuage(canvasNuage, {
      points: nuageConsoTemperature(d.trajets, d.capacite),
      titreX: 'Température (°C)', titreY: 'kWh/100 km', unite: 'kWh/100 km', formater: (v) => nombre(v, 1)
    });
  }
}

// ---------- Détail d'un trajet ----------

function rendreDetail(d, trajet) {
  const { capacite, coefs } = d;
  const etat = etatApprentissage(trajet, capacite);
  const modele = d.modeles.find((m) => m.id === trajet.modeleId);
  const conso = consoMesuree(trajet, capacite);
  const statut = etat.motif
    ? `non pris en compte : ${echapper(etat.motif)}`
    : (etat.temperatureManquante ? "température manquante : pas utilisé pour l'apprentissage" : 'pris en compte');
  const ligne = (libelle, valeur) => `<dt>${libelle}</dt><dd>${valeur}</dd>`;
  return `<section class="carte">
    <h2>Trajet du ${dateCourte(trajet.date)}</h2>
    <p class="badges">${badgesTrajet(trajet, capacite)}</p>
    <dl class="valeurs">
      ${modele ? ligne('Modèle', echapper(modele.nom)) : ''}
      ${ligne('Segments', resumeSegments(trajet.segments))}
      ${ligne('Distance', `${nombre(trajet.kmTotal, 0)} km`)}
      ${ligne('%', `${pct(trajet.socDepart)} → ${pct(trajet.socArrivee)}`)}
      ${ligne('kWh consommés', kwh(kwhConsommes(trajet, capacite)))}
      ${ligne('Conso', `${consoKwh100(conso)} (${trajet.consoVoitureKwh100 ? 'voiture' : 'calculée'})`)}
      ${etat.utilisable ? ligne('Conso à 15 °C', consoKwh100(consoNormalisee(trajet, capacite, coefs))) : ''}
      ${ligne('Température', trajet.temperatureExt === null || trajet.temperatureExt === undefined ? '—' : `${nombre(trajet.temperatureExt, 0)} °C`)}
      ${ligne('Apprentissage', statut)}
    </dl>
    ${trajet.note ? `<p>${echapper(trajet.note)}</p>` : ''}
    <label class="case"><input type="checkbox" data-action="exclure" data-id="${trajet.id}" ${trajet.exclusionManuelle ? 'checked' : ''}><span>Exclure des moyennes</span></label>
    <button type="button" class="btn" data-action="modifier-trajet" data-id="${trajet.id}">Modifier</button>
    <button type="button" class="btn btn-danger" data-action="supprimer-trajet" data-id="${trajet.id}">Supprimer</button>
    <button type="button" class="btn btn-secondaire" data-action="retour">Retour</button>
  </section>`;
}

// ---------- Formulaires ----------

function boutonsFormulaire() {
  return `<p class="rappel" data-erreurs hidden></p>
    <button type="submit" class="btn">Enregistrer</button>
    <button type="button" class="btn btn-secondaire" data-action="retour">Annuler</button>`;
}

function rendreFormulaireTrajet(d, trajet = {}) {
  const dernier = dernierPctConnu(d);
  const socDepart = trajet.socDepart ?? (dernier.perime ? null : dernier.soc);
  const options = d.modeles.map((m) => `<option value="${m.id}" ${m.id === trajet.modeleId ? 'selected' : ''}>${echapper(m.nom)}</option>`).join('');
  return `<section class="carte"><h2>${trajet.id ? 'Modifier le trajet' : 'Nouveau trajet'}</h2>
    <form data-formulaire="trajet" data-id="${trajet.id ?? ''}" novalidate>
      ${champ('Date', 'date', trajet.date ?? isoLocal(new Date()), { type: 'datetime-local' })}
      ${d.modeles.length ? `<label class="champ"><span>Modèle<small class="discret">facultatif, remplit les segments</small></span>
        <span class="saisie"><select name="modeleId" data-choix-modele><option value="">Aucun</option>${options}</select></span></label>` : ''}
      ${editeurSegments(trajet.segments ?? [])}
      ${champ('% au départ', 'socDepart', enChamp(socDepart), { decimal: true })}
      ${champ("% à l'arrivée", 'socArrivee', enChamp(trajet.socArrivee), { decimal: true })}
      ${champ('Conso affichée par la voiture', 'consoVoitureKwh100', enChamp(trajet.consoVoitureKwh100), { decimal: true, aide: 'kWh/100 km, facultatif, plus précise' })}
      ${champ('Température extérieure', 'temperatureExt', enChamp(trajet.temperatureExt), { decimal: true, aide: "°C : sans elle, le trajet n'entre pas dans l'apprentissage" })}
      ${champ('Note', 'note', trajet.note ?? '', { aide: 'facultatif' })}
      ${boutonsFormulaire()}
    </form>
  </section>`;
}

function rendreFormulaireReleve() {
  return `<section class="carte"><h2>Noter le %</h2>
    <form data-formulaire="releve" novalidate>
      ${champ('Date', 'date', isoLocal(new Date()), { type: 'datetime-local' })}
      ${champ('% affiché', 'soc', '', { decimal: true })}
      ${champ('Compteur', 'kmCompteur', '', { decimal: true, aide: 'km, facultatif' })}
      ${champ('Note', 'note', '', { aide: 'facultatif' })}
      ${boutonsFormulaire()}
    </form>
  </section>`;
}

function rendreFormulaireModele(d, modele = {}) {
  const autres = d.modeles.filter((m) => m.id !== modele.id);
  const options = autres.map((m) => `<option value="${m.id}" ${m.id === modele.modeleRetourId ? 'selected' : ''}>${echapper(m.nom)}</option>`).join('');
  return `<section class="carte"><h2>${modele.id ? 'Modifier le modèle' : 'Nouveau modèle'}</h2>
    <p class="discret">Un modèle = un sens : l'aller et le retour ne consomment pas pareil.</p>
    <form data-formulaire="modele" data-id="${modele.id ?? ''}" novalidate>
      ${champ('Nom', 'nom', modele.nom ?? '', { attributs: 'placeholder="Maison → travail"' })}
      ${editeurSegments(modele.segments ?? [])}
      ${modele.id
    ? (autres.length ? `<label class="champ"><span>Modèle retour</span><span class="saisie"><select name="modeleRetourId"><option value="">Aucun</option>${options}</select></span></label>` : '')
    : '<label class="case"><input type="checkbox" name="creerRetour" checked><span>Créer aussi le modèle retour (segments et nom inversés)</span></label>'}
      ${champ('Note', 'note', modele.note ?? '', { aide: 'facultatif' })}
      ${boutonsFormulaire()}
      ${modele.id ? `<button type="button" class="btn btn-danger" data-action="supprimer-modele" data-id="${modele.id}">Supprimer le modèle</button>` : ''}
    </form>
  </section>`;
}

// ---------- Modèles ----------

function rendreListeModeles(d) {
  const cartes = [...d.modeles].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((m) => {
    const resume = resumeModele(d.trajets, m, d.capacite, d.coefs);
    const retour = d.modeles.find((x) => x.id === m.modeleRetourId);
    const moyenne = resume.moyenne
      ? `${consoKwh100(resume.moyenne.conso)} à 15 °C (${resume.moyenne.n} trajets)`
      : 'pas encore assez de trajets utilisables (2 nécessaires)';
    return `<button type="button" class="ligne" data-action="modifier-modele" data-id="${m.id}">
      <span class="ligne-haut"><strong>${echapper(m.nom)}</strong><span>${nombre(kmDesSegments(m.segments), 0)} km</span></span>
      <span class="ligne-bas"><span>${resumeSegments(m.segments)}</span></span>
      <span class="ligne-bas"><span>${resume.realisations} réalisation${resume.realisations > 1 ? 's' : ''}</span><span>${moyenne}</span></span>
      ${retour ? `<span class="ligne-bas"><span>Retour : ${echapper(retour.nom)}</span></span>` : ''}
    </button>`;
  }).join('');
  return `${rendreOnglets('modeles')}
    <button type="button" class="btn" data-action="nouveau-modele">+ Nouveau modèle</button>
    <section class="carte"><h2>Mes trajets enregistrés</h2>
      ${cartes || '<p class="discret vide">Aucun modèle pour l\'instant.</p>'}
    </section>`;
}

// ---------- Enregistrement ----------

async function enregistrerTrajet(formulaire, d) {
  const donnees = new FormData(formulaire);
  const existant = d.trajets.find((t) => t.id === formulaire.dataset.id);
  const segments = lireSegments(donnees);
  const trajet = {
    ...(existant ?? {
      id: crypto.randomUUID(), kmCompteur: null, dureeMin: null, source: 'manuel', abrpId: null, exclusionManuelle: false
    }),
    date: donnees.get('date') || null,
    modeleId: donnees.get('modeleId') || null,
    segments,
    kmTotal: kmDesSegments(segments.filter((s) => s.km > 0)),
    socDepart: lireNombre(donnees.get('socDepart')),
    socArrivee: lireNombre(donnees.get('socArrivee')),
    consoVoitureKwh100: lireNombre(donnees.get('consoVoitureKwh100')),
    temperatureExt: lireNombre(donnees.get('temperatureExt')),
    note: String(donnees.get('note') ?? '').trim()
  };
  const erreurs = erreursTrajet(trajet);
  if (erreurs.length) return { erreurs };
  await ecrire('trajets', trajet);
  const etat = etatApprentissage(trajet, d.capacite);
  if (etat.motif) return { message: `Enregistré, non pris en compte : ${etat.motif}.` };
  if (etat.temperatureManquante) return { message: "Enregistré. Sans température, il n'entre pas dans l'apprentissage." };
  return { message: 'Trajet enregistré.' };
}

async function enregistrerReleve(formulaire) {
  const donnees = new FormData(formulaire);
  const releve = {
    id: crypto.randomUUID(),
    date: donnees.get('date') || null,
    soc: lireNombre(donnees.get('soc')),
    kmCompteur: lireNombre(donnees.get('kmCompteur')),
    note: String(donnees.get('note') ?? '').trim()
  };
  const erreurs = erreursReleve(releve);
  if (erreurs.length) return { erreurs };
  await ecrire('releves', releve);
  return { message: `Relevé de ${pct(releve.soc)} enregistré.` };
}

async function enregistrerLiens(modeles, idA, idB) {
  for (const modele of lierModeles(modeles, idA, idB)) await ecrire('modeles', modele);
}

async function enregistrerModele(formulaire, d) {
  const donnees = new FormData(formulaire);
  const existant = d.modeles.find((m) => m.id === formulaire.dataset.id);
  const nom = String(donnees.get('nom') ?? '').trim();
  const segments = lireSegments(donnees);
  const erreurs = [...(nom ? [] : ['Le nom est obligatoire.']), ...erreursSegments(segments)];
  if (erreurs.length) return { erreurs };

  const modele = {
    ...(existant ?? { id: crypto.randomUUID(), modeleRetourId: null }),
    nom,
    segments,
    note: String(donnees.get('note') ?? '').trim()
  };
  await ecrire('modeles', modele);
  const autres = d.modeles.filter((m) => m.id !== modele.id);

  if (existant) {
    await enregistrerLiens([...autres, modele], modele.id, donnees.get('modeleRetourId') || null);
    return { message: 'Modèle enregistré.' };
  }
  if (donnees.get('creerRetour') === 'on') {
    const retour = { id: crypto.randomUUID(), nom: nomInverse(nom), segments: segmentsInverses(segments), modeleRetourId: null, note: '' };
    await ecrire('modeles', retour);
    await enregistrerLiens([...autres, modele, retour], modele.id, retour.id);
    return { message: `Modèles « ${nom} » et « ${retour.nom} » enregistrés.` };
  }
  return { message: 'Modèle enregistré.' };
}

// ---------- Écran ----------

function rendre(d) {
  const { vue } = d;
  const trajet = d.trajets.find((t) => t.id === vue.id);
  const modele = d.modeles.find((m) => m.id === vue.id);
  let html;
  detruireGraphiques(d.conteneur);
  if (vue.nom === 'detail' && trajet) html = rendreDetail(d, trajet);
  else if (vue.nom === 'trajet') html = rendreFormulaireTrajet(d, trajet ?? vue.prerempli);
  else if (vue.nom === 'releve') html = rendreFormulaireReleve();
  else if (vue.nom === 'modele') html = rendreFormulaireModele(d, modele ?? vue.prerempli);
  else {
    d.vue = { nom: 'liste' };
    html = d.onglet === 'modeles' ? rendreListeModeles(d) : rendreListeTrajets(d);
  }
  d.conteneur.innerHTML = html;
  if (d.vue.nom === 'liste' && d.onglet === 'trajets') dessinerGraphiques(d);
  window.scrollTo(0, 0);
}

export async function afficher(conteneur, ctx) {
  const d = { conteneur, ctx, vue: { nom: 'liste' }, onglet: 'trajets', filtre: 'tous' };
  const charger = async () => {
    [d.reglages, d.recharges, d.trajets, d.releves, d.modeles] = await Promise.all([
      chargerReglages(), lireTout('recharges'), lireTout('trajets'), lireTout('releves'), lireTout('modeles')
    ]);
    d.capacite = d.reglages.capaciteNetteKwh;
    d.coefs = d.reglages.coefsTemperature;
  };
  await charger();
  if (brouillon) {
    d.vue = { nom: brouillon.vue, prerempli: brouillon.donnees };
    if (brouillon.vue === 'modele') d.onglet = 'modeles';
    brouillon = null;
  }

  conteneur.onclick = async (evenement) => {
    const cible = evenement.target.closest('[data-action]');
    if (!cible) return;
    const { action, id } = cible.dataset;

    // Actions qui modifient le formulaire en place, sans le redessiner.
    if (gererSegments(cible)) return;
    if (action === 'exclure') {
      const trajet = d.trajets.find((t) => t.id === id);
      await ecrire('trajets', { ...trajet, exclusionManuelle: cible.checked });
      await charger();
      rendre(d);
      return;
    }

    if (action === 'onglet') d.onglet = cible.dataset.onglet;
    else if (action === 'filtre') d.filtre = cible.dataset.type;
    else if (action === 'nouveau-trajet') d.vue = { nom: 'trajet' };
    else if (action === 'modifier-trajet') d.vue = { nom: 'trajet', id };
    else if (action === 'detail') d.vue = { nom: 'detail', id };
    else if (action === 'nouveau-releve') d.vue = { nom: 'releve' };
    else if (action === 'nouveau-modele') d.vue = { nom: 'modele' };
    else if (action === 'modifier-modele') d.vue = { nom: 'modele', id };
    else if (action === 'retour') d.vue = { nom: 'liste' };
    else if (action === 'supprimer-trajet') {
      if (!window.confirm('Supprimer ce trajet ? Cette action est définitive.')) return;
      await supprimer('trajets', id);
      ctx.afficherToast('Trajet supprimé.');
      d.vue = { nom: 'liste' };
    } else if (action === 'supprimer-releve') {
      if (!window.confirm('Supprimer ce relevé ?')) return;
      await supprimer('releves', id);
    } else if (action === 'supprimer-modele') {
      if (!window.confirm('Supprimer ce modèle ? Les trajets déjà faits sont gardés.')) return;
      await enregistrerLiens(d.modeles, id, null);
      for (const trajet of d.trajets.filter((t) => t.modeleId === id)) await ecrire('trajets', { ...trajet, modeleId: null });
      await supprimer('modeles', id);
      ctx.afficherToast('Modèle supprimé.');
      d.vue = { nom: 'liste' };
    }
    await charger();
    rendre(d);
  };

  // Choisir un modèle dans le formulaire trajet remplit ses segments.
  conteneur.onchange = (evenement) => {
    if (!evenement.target.matches('[data-choix-modele]')) return;
    const modele = d.modeles.find((m) => m.id === evenement.target.value);
    if (modele) evenement.target.form.querySelector('[data-segments]').innerHTML = modele.segments.map(ligneSegment).join('');
  };

  conteneur.onsubmit = async (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.target;
    const enregistrer = { trajet: enregistrerTrajet, releve: enregistrerReleve, modele: enregistrerModele }[formulaire.dataset.formulaire];
    const resultat = await enregistrer(formulaire, d);
    if (resultat.erreurs) {
      montrerErreurs(formulaire, resultat.erreurs);
      return;
    }
    await charger();
    d.vue = { nom: 'liste' };
    rendre(d);
    ctx.afficherToast(resultat.message);
  };

  rendre(d);
}
