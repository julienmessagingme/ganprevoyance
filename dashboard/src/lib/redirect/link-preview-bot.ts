/**
 * Détection des crawlers qui suivent une URL pour générer une link-preview
 * (carte d'aperçu) plutôt qu'une vraie navigation utilisateur.
 *
 * Quand un template WhatsApp contient une URL trackée `/r/<slug>`, Meta
 * (et d'autres plateformes) crawl le lien pour générer la preview montrée
 * au contact dans le chat. Sans filtre, chaque envoi de template produit
 * 1+ hits dans `clicks` — les compteurs reflètent les envois, pas les
 * vrais clics. Constaté en prod (mai 2026) : 149 hits sur 150 étaient
 * `facebookexternalua` depuis le range IPv6 `2a03:2880::/29` (ASN AS32934
 * Facebook).
 *
 * Stratégie : on garde le redirect 302 (sinon Meta ne pourrait pas générer
 * la preview) mais on n'insère PAS de row dans `clicks` pour ces UA.
 *
 * Liste basée sur les UA observés en pratique + les principaux acteurs
 * connus pour faire du link-preview server-side. À enrichir si on voit
 * d'autres bots faire bouger les compteurs.
 */

const PREVIEW_BOT_REGEX =
  /(facebookexternalua|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|skypeuripreview|bingbot|googlebot|google-inspectiontool|applebot|yandexbot|duckduckbot|baiduspider|petalbot|developers\.google\.com\/\+\/web\/snippet|embedly|outbrain|snapchat|pinterest|redditbot)/i;

/**
 * Ranges IP de prévisualisation connus. Depuis 2024, Meta envoie ses bots
 * de preview (`meta-externalagent`) avec un UA spoofé d'iPhone/Android pour
 * paraître "authentiques" — le filtre UA passe à côté. Le seul signal fiable
 * restant : l'IP source ou le Referer Facebook.
 *
 * Constaté en prod Gan Prévoyance (mai 2026) : ~14 hits sur 6 URLs fraîches, tous
 * depuis le bloc IPv6 `2a03:2880::/29` (ASN AS32934 Meta) avec Referer
 * `facebook.com` / `m.facebook.com`, UA Mobile Safari/Chrome standard.
 */
const META_IPV6_PREFIXES = ["2a03:2880:"];
const META_IPV4_PREFIXES = [
  "31.13.",
  "66.220.",
  "69.63.",
  "69.171.",
  "157.240.",
  "173.252.",
  "179.60.",
  "185.60.",
];
const META_REFERER_HOSTS = [
  "facebook.com",
  "m.facebook.com",
  "l.facebook.com",
  "www.facebook.com",
  "lm.facebook.com",
];

function isMetaIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const lower = ip.toLowerCase();
  if (META_IPV6_PREFIXES.some((p) => lower.startsWith(p))) return true;
  if (META_IPV4_PREFIXES.some((p) => lower.startsWith(p))) return true;
  return false;
}

function isMetaReferer(referer: string | null | undefined): boolean {
  if (!referer) return false;
  try {
    const u = new URL(referer);
    const host = u.hostname.toLowerCase();
    return META_REFERER_HOSTS.includes(host) || host.endsWith(".facebook.com");
  } catch {
    // Referer pas une URL parsable : fallback substring
    return /facebook\.com/i.test(referer);
  }
}

export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return PREVIEW_BOT_REGEX.test(userAgent);
}

/**
 * Variante étendue : détecte aussi les bots Meta qui spoofent l'UA d'un vrai
 * navigateur mobile. Utilisée par la route `/r/[slug]` pour ne pas
 * incrémenter le compteur quand Meta crawl pour générer la link preview.
 */
export function isLinkPreviewBotRich(args: {
  userAgent: string | null | undefined;
  ip: string | null | undefined;
  referer: string | null | undefined;
}): boolean {
  if (isLinkPreviewBot(args.userAgent)) return true;
  if (isMetaIp(args.ip)) return true;
  if (isMetaReferer(args.referer)) return true;
  return false;
}
