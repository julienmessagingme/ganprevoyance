/**
 * Tarifs Meta WhatsApp Business — catégorie MARKETING — par pays.
 *
 * Source : https://developers.facebook.com/docs/whatsapp/pricing
 * Valeurs constatées 2025/2026 pour un compte WABA EU (facturé en €).
 * Imprécision attendue : Meta révise les tarifs ~2× par an, à vérifier
 * périodiquement et corriger ici. Les valeurs sont en EUR par message
 * marketing envoyé (sortant initié par l'entreprise — fenêtre 24h
 * dépassée ou template marketing).
 *
 * Couverture : les ~50 pays les plus probables côté client (Europe, Maghreb,
 * Afrique de l'Ouest, Moyen-Orient, Amériques, Asie principale). Pour
 * tout autre indicatif, on retombe sur la zone « Other » avec un tarif
 * moyen estimé.
 */

export interface PhoneCountry {
  /** Code ISO 3166 alpha-2. */
  iso: string;
  /** Nom court du pays/zone (français). */
  name: string;
  /** Tarif Meta marketing en EUR par message. */
  marketingEur: number;
}

/** Tarif fallback pour un numéro dont l'indicatif n'est pas reconnu, ou
 *  pour les pays absents du tableau ci-dessous. Choisi comme moyenne
 *  raisonnable des markets « Rest of … » de Meta. */
const FALLBACK: PhoneCountry = {
  iso: "XX",
  name: "Autre / non reconnu",
  marketingEur: 0.05,
};

/**
 * Map indicatif téléphonique → pays. Ordonné dans la fonction
 * `extractCountry` du préfixe le plus long au plus court (ex: +1242
 * Bahamas avant +1 USA/Canada — pas implémenté ici, on simplifie +1 à
 * USA/Canada pour le MVP).
 *
 * Valeurs marketing EUR au 2026-05 (à raffiner avec la facturation Meta
 * réelle du compte WABA).
 */
const PHONE_CODES: Record<string, PhoneCountry> = {
  // --- Europe de l'Ouest ---
  "33": { iso: "FR", name: "France", marketingEur: 0.0791 },
  "32": { iso: "BE", name: "Belgique", marketingEur: 0.0742 },
  "31": { iso: "NL", name: "Pays-Bas", marketingEur: 0.0817 },
  "49": { iso: "DE", name: "Allemagne", marketingEur: 0.0786 },
  "34": { iso: "ES", name: "Espagne", marketingEur: 0.0615 },
  "39": { iso: "IT", name: "Italie", marketingEur: 0.0535 },
  "351": { iso: "PT", name: "Portugal", marketingEur: 0.0561 },
  "41": { iso: "CH", name: "Suisse", marketingEur: 0.0727 },
  "43": { iso: "AT", name: "Autriche", marketingEur: 0.0699 },
  "44": { iso: "GB", name: "Royaume-Uni", marketingEur: 0.0445 },
  "353": { iso: "IE", name: "Irlande", marketingEur: 0.0571 },
  "352": { iso: "LU", name: "Luxembourg", marketingEur: 0.0712 },
  "45": { iso: "DK", name: "Danemark", marketingEur: 0.0512 },
  "46": { iso: "SE", name: "Suède", marketingEur: 0.0488 },
  "47": { iso: "NO", name: "Norvège", marketingEur: 0.0531 },
  "358": { iso: "FI", name: "Finlande", marketingEur: 0.0496 },
  "30": { iso: "GR", name: "Grèce", marketingEur: 0.0589 },
  "48": { iso: "PL", name: "Pologne", marketingEur: 0.0274 },
  "40": { iso: "RO", name: "Roumanie", marketingEur: 0.0286 },
  "420": { iso: "CZ", name: "Tchéquie", marketingEur: 0.0356 },

  // --- Amérique du Nord ---
  "1": { iso: "US", name: "USA / Canada", marketingEur: 0.0246 },

  // --- Amérique latine ---
  "52": { iso: "MX", name: "Mexique", marketingEur: 0.0423 },
  "55": { iso: "BR", name: "Brésil", marketingEur: 0.0235 },
  "54": { iso: "AR", name: "Argentine", marketingEur: 0.0566 },
  "56": { iso: "CL", name: "Chili", marketingEur: 0.0817 },
  "57": { iso: "CO", name: "Colombie", marketingEur: 0.0115 },
  "51": { iso: "PE", name: "Pérou", marketingEur: 0.0710 },

  // --- Maghreb ---
  "212": { iso: "MA", name: "Maroc", marketingEur: 0.0625 },
  "213": { iso: "DZ", name: "Algérie", marketingEur: 0.1050 },
  "216": { iso: "TN", name: "Tunisie", marketingEur: 0.0620 },

  // --- Afrique de l'Ouest ---
  "221": { iso: "SN", name: "Sénégal", marketingEur: 0.0340 },
  "225": { iso: "CI", name: "Côte d'Ivoire", marketingEur: 0.0580 },
  "223": { iso: "ML", name: "Mali", marketingEur: 0.0379 },
  "226": { iso: "BF", name: "Burkina Faso", marketingEur: 0.0379 },
  "228": { iso: "TG", name: "Togo", marketingEur: 0.0379 },
  "229": { iso: "BJ", name: "Bénin", marketingEur: 0.0379 },
  "237": { iso: "CM", name: "Cameroun", marketingEur: 0.0379 },
  "241": { iso: "GA", name: "Gabon", marketingEur: 0.0379 },

  // --- Afrique du reste ---
  "234": { iso: "NG", name: "Nigeria", marketingEur: 0.0373 },
  "27": { iso: "ZA", name: "Afrique du Sud", marketingEur: 0.0263 },
  "254": { iso: "KE", name: "Kenya", marketingEur: 0.0379 },
  "20": { iso: "EG", name: "Égypte", marketingEur: 0.0997 },

  // --- Moyen-Orient ---
  "971": { iso: "AE", name: "Émirats arabes unis", marketingEur: 0.0292 },
  "966": { iso: "SA", name: "Arabie saoudite", marketingEur: 0.0314 },
  "972": { iso: "IL", name: "Israël", marketingEur: 0.0296 },
  "90": { iso: "TR", name: "Turquie", marketingEur: 0.0073 },
  "961": { iso: "LB", name: "Liban", marketingEur: 0.0568 },
  "962": { iso: "JO", name: "Jordanie", marketingEur: 0.0568 },

  // --- Asie ---
  "91": { iso: "IN", name: "Inde", marketingEur: 0.0067 },
  "62": { iso: "ID", name: "Indonésie", marketingEur: 0.0378 },
  "60": { iso: "MY", name: "Malaisie", marketingEur: 0.0791 },
  "63": { iso: "PH", name: "Philippines", marketingEur: 0.0842 },
  "65": { iso: "SG", name: "Singapour", marketingEur: 0.0537 },
  "66": { iso: "TH", name: "Thaïlande", marketingEur: 0.0317 },
  "81": { iso: "JP", name: "Japon", marketingEur: 0.0732 },
  "82": { iso: "KR", name: "Corée du Sud", marketingEur: 0.0732 },
  "84": { iso: "VN", name: "Vietnam", marketingEur: 0.0379 },
  "86": { iso: "CN", name: "Chine", marketingEur: 0.0732 },
  "92": { iso: "PK", name: "Pakistan", marketingEur: 0.0435 },
  "880": { iso: "BD", name: "Bangladesh", marketingEur: 0.0067 },

  // --- Océanie ---
  "61": { iso: "AU", name: "Australie", marketingEur: 0.0717 },
  "64": { iso: "NZ", name: "Nouvelle-Zélande", marketingEur: 0.0717 },
};

/** Indicatifs ordonnés du plus long au plus court — pour matcher
 *  correctement "+212" avant "+2" si jamais on en avait un. */
const PHONE_CODE_KEYS = Object.keys(PHONE_CODES).sort(
  (a, b) => b.length - a.length
);

/**
 * Extrait le pays d'un numéro de téléphone international.
 *
 * Accepte les formats "+33633921577", "0033633921577", "+33 6 33 92 ...".
 * Si l'indicatif n'est pas reconnu (ou si la chaîne ne ressemble pas à un
 * numéro), retourne `null` — le code appelant peut alors décider de
 * compter le coût avec FALLBACK ou de l'ignorer.
 */
export function extractCountry(rawPhone: string): PhoneCountry | null {
  if (!rawPhone) return null;
  // Garde les chiffres uniquement (avec un + initial s'il y en a un)
  const trimmed = rawPhone.trim();
  let digits: string;
  if (trimmed.startsWith("+")) {
    digits = trimmed.slice(1).replace(/\D/g, "");
  } else if (trimmed.startsWith("00")) {
    digits = trimmed.slice(2).replace(/\D/g, "");
  } else {
    // Pas de + ni de 00 → on suppose un local non identifiable
    return null;
  }
  if (digits.length < 4) return null;

  // Match le plus long préfixe possible (matched-greedy)
  for (const code of PHONE_CODE_KEYS) {
    if (digits.startsWith(code)) {
      return PHONE_CODES[code];
    }
  }
  return null;
}

/**
 * Coût Meta marketing pour UN numéro. Renvoie `FALLBACK.marketingEur`
 * pour les indicatifs inconnus afin que la somme totale d'un funnel
 * reste indicative même si quelques numéros sont mal formatés.
 */
export function metaMarketingCostEur(rawPhone: string): number {
  const country = extractCountry(rawPhone);
  return (country ?? FALLBACK).marketingEur;
}

/** Somme du coût marketing sur une liste de numéros. */
export function metaMarketingCostSumEur(phones: string[]): number {
  return phones.reduce((acc, p) => acc + metaMarketingCostEur(p), 0);
}

/** Une ligne du breakdown coût Meta : un pays + nb d'envois + tarif unitaire
 *  + total. Affichée dans la modale de détail accessible au clic sur la
 *  cellule « Coût Meta » d'un funnel ou d'un event Stats. */
export interface MetaCostByCountry {
  iso: string;
  name: string;
  count: number;
  rateEur: number;
  totalEur: number;
}

/**
 * Regroupe une liste de numéros par pays et calcule le coût total par
 * pays. Trié par totalEur décroissant (le pays le plus coûteux en haut).
 *
 * Le fallback (indicatif inconnu) est agrégé sous une seule ligne
 * « Autre / non reconnu » pour ne pas polluer le tableau.
 */
export function groupMetaCostsByCountry(phones: string[]): MetaCostByCountry[] {
  const groups = new Map<
    string,
    { iso: string; name: string; rateEur: number; count: number }
  >();
  for (const p of phones) {
    if (!p) continue;
    const country = extractCountry(p) ?? FALLBACK;
    const key = country.iso;
    const g = groups.get(key);
    if (g) g.count++;
    else
      groups.set(key, {
        iso: country.iso,
        name: country.name,
        rateEur: country.marketingEur,
        count: 1,
      });
  }
  return Array.from(groups.values())
    .map((g) => ({ ...g, totalEur: g.count * g.rateEur }))
    .sort((a, b) => b.totalEur - a.totalEur);
}

export const META_FALLBACK = FALLBACK;
