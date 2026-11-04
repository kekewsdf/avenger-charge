// Valeurs de référence : conso batterie (kWh/100 km) et coefficients de température (CLAUDE.md 7.5).

export const CONSO_REFERENCE = {
  ville: 13.0,        // Essais publiés (pas de trajet ABRP en ville)
  route: 14.0,        // ABRP : 3 trajets, 93 km (14,1)
  voie_rapide: 17.0,  // ABRP : 7 trajets, 828 km (17,0)
  autoroute: 25.0,    // Essais publiés (pas de trajet ABRP à 130 km/h constant)
  mixte: 17.0         // ABRP : 13 trajets, 1 192 km (16,9)
};

// Du plus chaud au plus froid : le premier palier dont `min` est atteint s'applique.
// min null = dernier palier. Format JSON pour pouvoir être stocké dans les réglages.
export const COEFS_TEMPERATURE = [
  { min: 15, coef: 1.00 },
  { min: 5, coef: 1.10 },
  { min: 0, coef: 1.20 },
  { min: null, coef: 1.30 }
];

export const TYPES_SEGMENT = ['ville', 'route', 'voie_rapide', 'autoroute', 'mixte'];
