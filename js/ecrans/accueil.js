// Écran Accueil (CLAUDE.md section 8) : jauge du dernier %, autonomie, recharge en cours, raccourcis,
// chiffres du mois et rappel de sauvegarde.

import { chargerReglages, lireTout } from '../db.js';
import {
  autonomieKm, chiffresDuMois, coefTemp, consoMixte, derniereTemperature, dernierPctConnu, moisDe, rappelSauvegarde
} from '../calculs.js';
import { consoKwh100, euros, ilYA, kwh, nomMois, nombre } from '../format.js';
import { ouvrirAvec as ouvrirRecharges, rendreEnCours } from './recharges.js';
import { ouvrirAvec as ouvrirTrajets } from './trajets.js';

function rendreJauge(d) {
  const { reglages } = d;
  const dernier = dernierPctConnu(d);
  if (dernier.soc === null && !dernier.perime) {
    return `<section class="carte jauge">
      <p class="jauge-valeur">— %</p>
      <p class="discret">Aucun % connu. Note le % affiché par la voiture pour démarrer.</p>
    </section>`;
  }
  const temperature = derniereTemperature(d);
  const mixte = consoMixte(d.trajets, reglages.capaciteNetteKwh, reglages.coefsTemperature);
  const autonomie = autonomieKm(dernier.soc, mixte.conso, coefTemp(temperature, reglages.coefsTemperature), reglages.capaciteNetteKwh);
  const correction = temperature === null ? 'sans correction de température' : `à ${nombre(temperature, 0)} °C`;
  const source = mixte.source === 'perso' ? `ta conso mixte (${mixte.n} trajets)` : 'conso de référence';
  return `<section class="carte jauge">
    <p class="jauge-valeur">${dernier.soc === null ? '—' : nombre(dernier.soc, 0)} %</p>
    <div class="jauge-barre" aria-hidden="true"><span data-niveau="${dernier.soc ?? 0}"></span></div>
    ${dernier.perime
    ? '<p class="rappel">% périmé : une recharge a eu lieu depuis, à compléter. <a href="#trajets" data-action="noter">Noter le %</a></p>'
    : `<p class="discret">Relevé ${ilYA(dernier.date)}</p>`}
    <p class="jauge-autonomie">≈ ${nombre(autonomie, 0)} km d'autonomie${dernier.perime ? ' (non fiable)' : ''}</p>
    <p class="discret">${source}, ${correction}</p>
  </section>`;
}

function rendreChiffres(d) {
  const cle = moisDe(new Date());
  const c = chiffresDuMois(d, d.reglages.capaciteNetteKwh, cle);
  const cout = c.cout === null ? '—' : `${euros(c.cout)}${c.coutsInconnus ? ' (incomplet)' : ''}`;
  return `<section class="carte"><h2>${nomMois(cle)}</h2>
    <dl class="chiffres">
      <div><dt>Prise, à la maison</dt><dd>${kwh(c.kwhPrise)}</dd></div>
      <div><dt>Coût</dt><dd>${cout}</dd></div>
      <div><dt>Parcourus</dt><dd>${nombre(c.km, 0)} km</dd></div>
      <div><dt>Conso moyenne</dt><dd>${consoKwh100(c.conso)}</dd></div>
    </dl>
    ${c.cout === null && c.recharges > 0 ? '<p class="discret"><a href="#reglages">Renseigne le tarif</a> pour voir le coût.</p>' : ''}
  </section>`;
}

function rendre(d) {
  const enCours = d.recharges.filter((r) => r.statut === 'en_cours').sort((a, b) => new Date(b.debut) - new Date(a.debut));
  const aDesDonnees = d.recharges.length + d.trajets.length + d.releves.length > 0;
  return `
    ${rendreJauge(d)}
    ${enCours.map((r) => rendreEnCours(r, d)).join('')}
    <div class="raccourcis">
      <button type="button" class="btn gros" data-action="brancher">Je branche</button>
      <button type="button" class="btn gros" data-action="trajet">+ Trajet</button>
      <a class="btn gros" href="#simuler">Simuler</a>
    </div>
    <p class="lien-secondaire"><a href="#trajets" data-action="noter">Noter le %</a></p>
    ${rendreChiffres(d)}
    ${rappelSauvegarde(d.reglages.derniereSauvegarde, new Date(), aDesDonnees)
    ? '<p class="rappel carte">Pense à sauvegarder tes données (export dans <a href="#reglages">Réglages</a>) : aucune sauvegarde depuis plus de 30 jours.</p>'
    : ''}`;
}

export async function afficher(conteneur) {
  const d = { conteneur };
  [d.reglages, d.recharges, d.trajets, d.releves] = await Promise.all([
    chargerReglages(), lireTout('recharges'), lireTout('trajets'), lireTout('releves')
  ]);
  conteneur.innerHTML = rendre(d);
  // Largeur de la jauge : propriété CSS posée par script, la CSP interdisant l'attribut style.
  const niveau = conteneur.querySelector('[data-niveau]');
  if (niveau) niveau.style.width = `${Math.max(0, Math.min(100, Number(niveau.dataset.niveau)))}%`;

  conteneur.onclick = (evenement) => {
    const cible = evenement.target.closest('[data-action]');
    if (!cible) return;
    const { action, id } = cible.dataset;
    if (action === 'brancher') ouvrirRecharges('brancher');
    else if (action === 'debrancher') ouvrirRecharges('debrancher', id);
    else if (action === 'trajet') ouvrirTrajets('trajet', undefined);
    else if (action === 'noter') ouvrirTrajets('releve', undefined);
    else return;
    evenement.preventDefault();
    window.location.hash = action === 'trajet' || action === 'noter' ? '#trajets' : '#recharges';
  };
}
