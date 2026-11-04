// Graphiques Chart.js (vendor/chart.umd.min.js, chargé par index.html sous window.Chart).
// Couleurs : emplacements 1 et 2 de la palette de référence, validés en clair et en sombre
// (séparation daltonisme et contraste) contre les surfaces de l'appli.
// Chaque graphique a sa vue en tableau, pour ne jamais dépendre de la seule couleur.

import { echapper } from './format.js';

const THEMES = {
  sombre: { serie1: '#3987e5', serie2: '#d95926', texte: '#a4abb6', grille: '#363b44', surface: '#1f2228' },
  clair: { serie1: '#2a78d6', serie2: '#eb6834', texte: '#5a616d', grille: '#e3e6ea', surface: '#ffffff' }
};

const theme = () => THEMES[document.documentElement.dataset.theme === 'clair' ? 'clair' : 'sombre'];

export const chartDisponible = () => typeof window.Chart === 'function';

// Détruit les graphiques d'un conteneur avant de remplacer son contenu.
export function detruireGraphiques(conteneur) {
  if (!chartDisponible()) return;
  for (const canvas of conteneur.querySelectorAll('canvas')) window.Chart.getChart(canvas)?.destroy();
}

function optionsCommunes(t, { unite, formater, legende }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { display: legende, labels: { color: t.texte, boxWidth: 12, boxHeight: 12 } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const valeur = ctx.parsed.y;
            const texte = valeur === null || valeur === undefined ? '—' : `${formater(valeur)} ${unite}`;
            return legende ? `${ctx.dataset.label} : ${texte}` : texte;
          }
        }
      }
    }
  };
}

const axe = (t, titre, { debutAZero = true } = {}) => ({
  beginAtZero: debutAZero,
  ticks: { color: t.texte },
  grid: { color: t.grille },
  border: { display: false },
  title: titre ? { display: true, text: titre, color: t.texte } : undefined
});

// Barres, une ou deux séries. series : [{ nom, valeurs, couleur: 'serie1' | 'serie2' }].
export function graphiqueBarres(canvas, { etiquettes, series, unite, formater, titreY }) {
  if (!chartDisponible()) return;
  const t = theme();
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: etiquettes,
      datasets: series.map((s) => ({
        label: s.nom,
        data: s.valeurs,
        backgroundColor: t[s.couleur],
        borderRadius: { topLeft: 4, topRight: 4 },
        borderSkipped: 'bottom',
        borderColor: t.surface,
        borderWidth: { left: 1, right: 1 },
        maxBarThickness: 28
      }))
    },
    options: {
      ...optionsCommunes(t, { unite, formater, legende: series.length > 1 }),
      scales: { x: { ...axe(t), grid: { display: false } }, y: axe(t, titreY) }
    }
  });
}

// Nuage de points, une série. points : [{ x, y }].
export function graphiqueNuage(canvas, { points, titreX, titreY, unite, formater }) {
  if (!chartDisponible()) return;
  const t = theme();
  return new window.Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [{
        label: titreY,
        data: points,
        backgroundColor: t.serie1,
        borderColor: t.surface,
        borderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointHitRadius: 10
      }]
    },
    options: {
      ...optionsCommunes(t, { unite, formater, legende: false }),
      interaction: { mode: 'nearest', intersect: true },
      scales: { x: axe(t, titreX, { debutAZero: false }), y: axe(t, titreY, { debutAZero: false }) }
    }
  });
}

// Bloc HTML d'un graphique : titre, zone du canvas et tableau repliable des mêmes données.
// colonnes : en-têtes ; lignes : tableaux de cellules déjà formatées.
export function blocGraphique(id, titre, colonnes, lignes) {
  const tableau = `<details class="vue-tableau"><summary>Voir en tableau</summary>
    <table><thead><tr>${colonnes.map((c) => `<th scope="col">${echapper(c)}</th>`).join('')}</tr></thead>
    <tbody>${lignes.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </details>`;
  const zone = chartDisponible()
    ? `<div class="graphique"><canvas data-graphique="${id}" role="img" aria-label="${echapper(titre)}"></canvas></div>`
    : '<p class="discret">Graphique indisponible : vue en tableau ci-dessous.</p>';
  return `<h3 class="titre-graphique">${echapper(titre)}</h3>${zone}${tableau}`;
}
