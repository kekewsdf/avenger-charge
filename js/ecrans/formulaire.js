// Morceaux de formulaire partagés par les écrans.

import { echapper, lireNombre } from '../format.js';
import { TYPES_SEGMENT } from '../reference.js';

export const LIBELLES_TYPES = { ville: 'Ville', route: 'Route', voie_rapide: 'Voie rapide', autoroute: 'Autoroute', mixte: 'Mixte' };

// ---------- Éditeur de segments (type de route + km) ----------

export function ligneSegment(segment) {
  return `<div class="segment" data-segment>
    <select name="segType" aria-label="Type de route">
      ${TYPES_SEGMENT.map((t) => `<option value="${t}" ${t === segment.type ? 'selected' : ''}>${LIBELLES_TYPES[t]}</option>`).join('')}
    </select>
    <input type="text" inputmode="decimal" name="segKm" aria-label="Distance en km" placeholder="km" value="${echapper(enChamp(segment.km))}">
    <button type="button" class="btn-icone" data-action="retirer-segment" aria-label="Retirer ce segment">✕</button>
  </div>`;
}

export function editeurSegments(segments) {
  const lignes = segments.length ? segments : [{ type: 'route', km: null }];
  return `<fieldset class="segments"><legend>Segments (type de route et km)</legend>
    <div data-segments>${lignes.map(ligneSegment).join('')}</div>
    <button type="button" class="btn btn-secondaire" data-action="ajouter-segment">+ Ajouter un segment</button>
  </fieldset>`;
}

export function lireSegments(donnees) {
  const types = donnees.getAll('segType');
  const kms = donnees.getAll('segKm');
  return types.map((type, i) => ({ type, km: lireNombre(kms[i]) }));
}

// Ajout ou retrait d'une ligne de segment. Renvoie true si l'action était l'une des deux.
export function gererSegments(bouton) {
  const { action } = bouton.dataset;
  if (action === 'ajouter-segment') {
    bouton.previousElementSibling.insertAdjacentHTML('beforeend', ligneSegment({ type: 'route', km: null }));
    return true;
  }
  if (action === 'retirer-segment') {
    const lignes = bouton.closest('[data-segments]').querySelectorAll('[data-segment]');
    if (lignes.length > 1) bouton.closest('[data-segment]').remove();
    return true;
  }
  return false;
}

export function champ(libelle, nom, valeur, { type = 'text', decimal = false, aide = '', attributs = '' } = {}) {
  const mode = decimal ? 'inputmode="decimal"' : '';
  return `<label class="champ"><span>${libelle}${aide ? `<small class="discret">${aide}</small>` : ''}</span>
    <span class="saisie"><input type="${type}" name="${nom}" value="${echapper(valeur ?? '')}" ${mode} ${attributs}></span>
  </label>`;
}

// Valeur numérique pour un champ, au format français.
export const enChamp = (valeur) => (valeur === null || valeur === undefined ? '' : String(valeur).replace('.', ','));

// Affiche les erreurs d'un formulaire dans sa zone [data-erreurs].
export function montrerErreurs(formulaire, erreurs) {
  const zone = formulaire.querySelector('[data-erreurs]');
  zone.innerHTML = erreurs.map(echapper).join('<br>');
  zone.hidden = false;
  zone.scrollIntoView({ block: 'center' });
}
