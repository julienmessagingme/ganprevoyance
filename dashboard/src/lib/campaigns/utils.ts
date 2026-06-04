import type { CampaignRef } from "./types";

/**
 * Reconstruit la clé de palette (`PaletteItem.ref_id`) à partir d'une
 * `CampaignRef`. La palette compose un id composite "<school>:<event_ns>"
 * en mode multi-école pour éviter les collisions ; cette fonction applique
 * la même règle dans l'autre sens. En single-school le préfixe est absent.
 */
export function paletteKeyOf(r: CampaignRef): string {
  if (r.step_type === "mm_event") {
    return r.event_school_slug
      ? `${r.event_school_slug}:${r.event_ns}`
      : r.event_ns ?? "";
  }
  return r.redirect_event_id ?? "";
}
