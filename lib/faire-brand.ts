/**
 * Faire Brand Profile — `GET /brands/profile` (cache 60min).
 *
 * Utilisé pour :
 *   - récupérer la devise par défaut du compte brand (USD/EUR/GBP/…)
 *   - savoir si la marque a été validée par Faire (sinon les produits restent
 *     en DRAFT — étape humaine ~1-2 semaines)
 *   - lister les marchés actifs (impacte le `geo_constraint` à envoyer)
 *
 * Pas de mutation possible ici : tout est configuré côté portail brand.
 */

import { unstable_cache } from "next/cache";
import { faireFetch } from "@/lib/faire-api";
import { logger } from "@/lib/logger";

export interface FaireBrandProfile {
  brandId?: string;
  name?: string;
  defaultCurrency?: string;
  /** `true` si Faire a validé manuellement le profil (logo, story…). */
  isApproved?: boolean;
  /** Marchés sur lesquels la marque vend (ex: ["UNITED_STATES", "EUROPEAN_UNION"]). */
  markets?: string[];
}

interface FaireBrandProfileRaw {
  id?: string;
  brand_id?: string;
  name?: string;
  default_currency?: string;
  currency?: string;
  is_approved?: boolean;
  approval_state?: string;
  markets?: string[];
  market_codes?: string[];
}

function normalize(raw: FaireBrandProfileRaw): FaireBrandProfile {
  const approved =
    typeof raw.is_approved === "boolean"
      ? raw.is_approved
      : raw.approval_state === "APPROVED";
  return {
    brandId: raw.id ?? raw.brand_id,
    name: raw.name,
    defaultCurrency: raw.default_currency ?? raw.currency,
    isApproved: approved,
    markets: raw.markets ?? raw.market_codes,
  };
}

async function loadFreshBrandProfile(): Promise<FaireBrandProfile | null> {
  try {
    const res = await faireFetch(`/brands/profile`);
    if (!res.ok) {
      logger.warn("[Faire Brand] GET /brands/profile failed", {
        status: res.status,
      });
      return null;
    }
    const data = (await res.json()) as FaireBrandProfileRaw;
    return normalize(data);
  } catch (err) {
    logger.warn("[Faire Brand] load failed", { error: String(err) });
    return null;
  }
}

const cachedProfile = unstable_cache(
  loadFreshBrandProfile,
  ["faire-brand-profile-v1"],
  { revalidate: 3600, tags: ["faire-brand"] },
);

export async function getFaireBrandProfile(): Promise<FaireBrandProfile | null> {
  return cachedProfile();
}

export async function getFaireBrandProfileFresh(): Promise<FaireBrandProfile | null> {
  return loadFreshBrandProfile();
}
