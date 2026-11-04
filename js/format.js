// Formatage français : virgule décimale, dates et durées. « — » pour toute valeur inconnue.

const INCONNU = '—';

function estConnu(valeur) {
  return valeur !== null && valeur !== undefined && Number.isFinite(valeur);
}

export function nombre(valeur, decimales = 2) {
  if (!estConnu(valeur)) return INCONNU;
  return valeur.toLocaleString('fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  });
}

export const kwh = (valeur) => (estConnu(valeur) ? `${nombre(valeur, 2)} kWh` : INCONNU);
export const pct = (valeur) => (estConnu(valeur) ? `${nombre(valeur, 1)} %` : INCONNU);
export const euros = (valeur) => (estConnu(valeur) ? `${nombre(valeur, 2)} €` : INCONNU);

export function dureeHeures(heures) {
  if (!estConnu(heures)) return INCONNU;
  const minutes = Math.round(heures * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

export function rendement(valeur) {
  return estConnu(valeur) ? nombre(valeur, 3) : INCONNU;
}

export const echapper = (texte) => String(texte ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const deux = (n) => String(n).padStart(2, '0');

// Date → "AAAA-MM-JJTHH:MM" en heure locale (format du stockage et des champs datetime-local).
export function isoLocal(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}T${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

export const heureMinute = (date) => {
  const d = new Date(date);
  return `${deux(d.getHours())}:${deux(d.getMinutes())}`;
};

// « aujourd'hui 08:10 », « demain 08:10 », « hier 20:00 », « mercredi 14:30 », sinon « 12/11 14:30 ».
export function heureRelative(date, maintenant = new Date()) {
  const d = new Date(date);
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecartJours = Math.round((jour(d) - jour(new Date(maintenant))) / 86400000);
  const heure = heureMinute(d);
  if (ecartJours === 0) return `aujourd'hui ${heure}`;
  if (ecartJours === 1) return `demain ${heure}`;
  if (ecartJours === -1) return `hier ${heure}`;
  if (ecartJours > 1 && ecartJours < 7) return `${d.toLocaleDateString('fr-FR', { weekday: 'long' })} ${heure}`;
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)} ${heure}`;
}

// « lun. 2 nov. 20:00 »
export function dateCourte(date) {
  const d = new Date(date);
  return `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} ${heureMinute(d)}`;
}

// "2026-11" → « novembre 2026 »
export function nomMois(cle) {
  const [annee, mois] = cle.split('-').map(Number);
  return new Date(annee, mois - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

// Secondes → « 03:14:09 », comme l'écran du câble.
export function dureeCable(secondes) {
  if (!estConnu(secondes)) return '';
  const s = Math.round(secondes);
  return `${deux(Math.floor(s / 3600))}:${deux(Math.floor(s % 3600 / 60))}:${deux(s % 60)}`;
}

// Lit un nombre saisi au format français ou anglais. Champ vide ou invalide : null.
export function lireNombre(texte) {
  if (texte === null || texte === undefined) return null;
  const propre = String(texte).trim().replace(',', '.');
  if (propre === '') return null;
  const valeur = Number(propre);
  return Number.isFinite(valeur) ? valeur : null;
}

export const consoKwh100 = (valeur) => (estConnu(valeur) ? `${nombre(valeur, 1)} kWh/100 km` : INCONNU);

// « à l'instant », « il y a 5 min », « il y a 2 h », « il y a 3 j ».
export function ilYA(date, maintenant = new Date()) {
  const minutes = Math.floor((new Date(maintenant) - new Date(date)) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 24 * 60) return `il y a ${Math.floor(minutes / 60)} h`;
  return `il y a ${Math.floor(minutes / 1440)} j`;
}

// "2026-11" → « nov. »
export function moisCourt(cle) {
  const [annee, mois] = cle.split('-').map(Number);
  return new Date(annee, mois - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
}
