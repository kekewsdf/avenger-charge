// Écran Simuler (CLAUDE.md 7.7 et section 8) : modèle ou segments, aller-retour, verdict, recharge à prévoir.
// Le résultat se recalcule à chaque saisie, sans bouton « Calculer ».

import { chargerReglages, lireTout } from '../db.js';
import { dernierPctConnu, erreursSegments, profilParDefaut, simulerTrajet } from '../calculs.js';
import { consoKwh100, dureeHeures, echapper, heureRelative, isoLocal, kwh, lireNombre, nombre, pct } from '../format.js';
import { champ, editeurSegments, enChamp, gererSegments, LIBELLES_TYPES, lireSegments } from './formulaire.js';
import { ouvrirAvec, resumeSegments } from './trajets.js';

const VERDICTS = {
  ok: { classe: 'verdict-ok', texte: '✅ OK' },
  juste: { classe: 'verdict-juste', texte: '⚠️ Juste' },
  recharge: { classe: 'verdict-recharge', texte: '❌ Recharge nécessaire' }
};

function rendreFormulaire(d) {
  const dernier = dernierPctConnu(d);
  let aideSoc = '';
  if (dernier.perime) aideSoc = 'dernier % périmé (recharge depuis) : à saisir';
  else if (dernier.soc !== null) aideSoc = `dernier % connu, ${heureRelative(dernier.date)}`;
  const options = [...d.modeles].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
    .map((m) => `<option value="${m.id}">${echapper(m.nom)}</option>`).join('');
  return `<section class="carte"><h2>Simuler un trajet</h2>
    <form data-formulaire="simulation" novalidate>
      ${d.modeles.length ? `<label class="champ"><span>Trajet</span><span class="saisie"><select name="modeleId" data-choix-modele>
        <option value="">Saisir les segments</option>${options}</select></span></label>
        <p class="discret" data-resume-modele hidden></p>` : ''}
      <div data-bloc-segments>${editeurSegments([])}</div>
      <label class="case"><input type="checkbox" name="allerRetour"><span>Aller-retour</span></label>
      ${champ('Température prévue', 'temperature', '', { decimal: true, aide: '°C, facultatif' })}
      ${champ('% au départ', 'socDepart', dernier.perime ? '' : enChamp(dernier.soc), { decimal: true, aide: aideSoc })}
      ${champ('Heure de départ', 'heureDepart', '', { type: 'datetime-local', aide: 'facultatif' })}
    </form>
  </section>
  <section class="carte" data-resultat aria-live="polite"></section>`;
}

function lireEntrees(formulaire, d) {
  const donnees = new FormData(formulaire);
  const modele = d.modeles.find((m) => m.id === donnees.get('modeleId')) ?? null;
  return {
    modele,
    modeleRetour: modele ? (d.modeles.find((m) => m.id === modele.modeleRetourId) ?? null) : null,
    segments: modele ? modele.segments : lireSegments(donnees),
    allerRetour: donnees.get('allerRetour') === 'on',
    temperature: lireNombre(donnees.get('temperature')),
    socDepart: lireNombre(donnees.get('socDepart')),
    heureDepart: donnees.get('heureDepart') || null
  };
}

function texteSource(ligne) {
  return ligne.source === 'perso' ? `ta moyenne, ${ligne.n} trajets` : 'référence';
}

function rendreResultat(r, entrees, d) {
  const seuil = d.reglages.seuilMiniPct;
  const profil = profilParDefaut(d.reglages.profilsCharge, d.recharges);
  const morceaux = [];

  if (r.verdict) {
    const { classe, texte } = VERDICTS[r.verdict];
    morceaux.push(`<p class="verdict ${classe}">${texte}</p>`);
  } else {
    morceaux.push('<p class="discret">Renseigne le % de départ pour avoir le verdict.</p>');
  }
  // Sous 0 %, la batterie est vide avant d'arriver : on dit combien il manque plutôt qu'un % négatif.
  const ligneSoc = (libelle, soc) => (soc >= 0
    ? `<p class="resultat-principal">${libelle} : ${pct(soc)}</p>`
    : `<p class="resultat-principal">${libelle} : batterie vide avant (il manque ${pct(-soc)})</p>`);
  if (r.socArrivee !== null) morceaux.push(ligneSoc("À l'arrivée", r.socArrivee));
  if (r.socRetour !== null) morceaux.push(ligneSoc('Au retour', r.socRetour));

  if (r.verdict === 'recharge') {
    const lignes = [];
    if (r.impossible) {
      lignes.push(`<p class="rappel">Même à 100 %, ce trajet ne passe pas : il faudrait ${pct(r.pctConsomme + seuil)} de batterie avec le seuil de ${pct(seuil)}. Prévois une recharge en route.</p>`);
    }
    if (profil && r.dureeChargeH !== null) {
      lignes.push(`<p>Charge à <strong>${pct(r.pctAAtteindre)}</strong> avant de partir : ${dureeHeures(r.dureeChargeH)} avec ${echapper(profil.nom)}.</p>`);
    } else {
      lignes.push(`<p>Charge à <strong>${pct(r.pctAAtteindre)}</strong> avant de partir.</p>`);
    }
    if (r.branchementMax) {
      lignes.push(r.branchementMax < new Date()
        ? '<p class="rappel">Trop tard pour charger complètement avant ce départ.</p>'
        : `<p>Branche au plus tard <strong>${heureRelative(r.branchementMax)}</strong>.</p>`);
    }
    morceaux.push(lignes.join(''));
  }

  const marge = d.reglages.margeSimulationPct;
  const correction = entrees.temperature === null
    ? 'sans correction de température'
    : `× ${nombre(r.coef, 2)} (${nombre(entrees.temperature, 0)} °C)`;
  morceaux.push(`<dl class="valeurs">
    <dt>Distance</dt><dd>${nombre(r.kmAller, 0)} km${entrees.allerRetour ? ' aller' : ''}</dd>
    <dt>kWh estimés</dt><dd>${kwh(r.kwh)}</dd>
    <dt>Avec marge de ${pct(marge)}</dt><dd>${kwh(r.kwhAvecMarge)}</dd>
    <dt>Batterie consommée</dt><dd>${pct(r.pctConsomme)}</dd>
    <dt>Température</dt><dd>${correction}</dd>
  </dl>`);

  const sources = [r.historiqueAller
    ? `Aller : ta moyenne pour ce modèle (${r.historiqueAller.n} trajets).`
    : 'Aller : conso par type de route (détail ci-dessous).'];
  if (entrees.allerRetour) {
    sources.push(r.historiqueRetour
      ? `Retour : ta moyenne pour « ${echapper(entrees.modeleRetour.nom)} » (${r.historiqueRetour.n} trajets).`
      : "Retour : même conso que l'aller.");
  }
  morceaux.push(`<p class="discret">${sources.join('<br>')}</p>`);

  const detail = r.historiqueAller
    ? [`${nombre(r.kmAller, 0)} km × ${consoKwh100(r.historiqueAller.conso)} à 15 °C → ${kwh(r.kwhAller)}`]
    : r.detail.map((l) => `${LIBELLES_TYPES[l.type]} ${nombre(l.km, 0)} km : ${consoKwh100(l.conso)} à 15 °C (${texteSource(l)}) → ${kwh(l.kwh)}`);
  morceaux.push(`<details><summary>Détail de l'aller</summary><ul class="detail-segments">${detail.map((t) => `<li>${t}</li>`).join('')}</ul>
    <p class="discret">kWh de l'aller avec la correction de température, avant marge.</p></details>`);

  morceaux.push(`${entrees.modele ? '' : '<button type="button" class="btn btn-secondaire" data-action="enregistrer-modele">Enregistrer comme modèle</button>'}
    <button type="button" class="btn" data-action="fait">J'ai fait ce trajet</button>`);
  return morceaux.join('');
}

function recalculer(d) {
  const formulaire = d.conteneur.querySelector('[data-formulaire="simulation"]');
  const zone = d.conteneur.querySelector('[data-resultat]');
  const entrees = lireEntrees(formulaire, d);

  const resume = formulaire.querySelector('[data-resume-modele]');
  formulaire.querySelector('[data-bloc-segments]').hidden = Boolean(entrees.modele);
  if (resume) {
    resume.hidden = !entrees.modele;
    resume.innerHTML = entrees.modele
      ? `${resumeSegments(entrees.modele.segments)}${entrees.modeleRetour ? `<br>Retour lié : ${echapper(entrees.modeleRetour.nom)}` : ''}`
      : '';
  }

  d.entrees = entrees;
  if (!entrees.modele && erreursSegments(entrees.segments).length) {
    zone.innerHTML = '<p class="discret">Indique au moins un segment avec sa distance pour lancer la simulation.</p>';
    return;
  }
  if (entrees.socDepart !== null && (entrees.socDepart < 0 || entrees.socDepart > 100)) {
    zone.innerHTML = '<p class="rappel">Le % de départ doit être compris entre 0 et 100.</p>';
    return;
  }
  const r = simulerTrajet({
    ...entrees,
    profil: profilParDefaut(d.reglages.profilsCharge, d.recharges),
    trajets: d.trajets,
    reglages: d.reglages
  });
  zone.innerHTML = rendreResultat(r, entrees, d);
}

export async function afficher(conteneur) {
  const d = { conteneur };
  [d.reglages, d.recharges, d.trajets, d.releves, d.modeles] = await Promise.all([
    chargerReglages(), lireTout('recharges'), lireTout('trajets'), lireTout('releves'), lireTout('modeles')
  ]);
  conteneur.innerHTML = rendreFormulaire(d);

  conteneur.oninput = () => recalculer(d);
  conteneur.onchange = () => recalculer(d);
  conteneur.onsubmit = (evenement) => evenement.preventDefault();

  conteneur.onclick = (evenement) => {
    const bouton = evenement.target.closest('[data-action]');
    if (!bouton) return;
    if (gererSegments(bouton)) {
      recalculer(d);
      return;
    }
    const { entrees } = d;
    if (bouton.dataset.action === 'fait') {
      // Aller seul : le retour se saisit comme un trajet à part (7.7).
      ouvrirAvec('trajet', {
        date: isoLocal(entrees.heureDepart ? new Date(entrees.heureDepart) : new Date()),
        modeleId: entrees.modele?.id ?? null,
        segments: entrees.segments.map((s) => ({ ...s })),
        socDepart: entrees.socDepart,
        temperatureExt: entrees.temperature
      });
      window.location.hash = '#trajets';
    } else if (bouton.dataset.action === 'enregistrer-modele') {
      ouvrirAvec('modele', { segments: entrees.segments.map((s) => ({ ...s })) });
      window.location.hash = '#trajets';
    }
  };

  recalculer(d);
}
