import { logger } from "@/lib/logger";

/**
 * Vérification SIRET via l'API Recherche d'entreprises (data.gouv.fr).
 * Endpoint : https://recherche-entreprises.api.gouv.fr/search?q={SIRET}
 * Données INSEE Sirene, gratuit, sans clé.
 */

const SIRET_TIMEOUT_MS = 10_000;

export interface SiretResult {
  found: boolean;
  siret: string;
  companyName: string | null;
  address: string | null;
  activity: string | null;
  activeStatus: "active" | "closed" | null;
  creationDate: string | null;
  requestDate: string;
  serviceError?: string;
}

export function normalizeSiret(raw: string): string | null {
  const cleaned = raw.replace(/\D/g, "");
  if (cleaned.length !== 14) return null;
  return cleaned;
}

interface RechercheEtablissement {
  siret?: string;
  adresse?: string;
  etat_administratif?: string;
}

interface RechercheResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  activite_principale?: string;
  libelle_activite_principale?: string;
  date_creation?: string;
  etat_administratif?: string;
  siege?: RechercheEtablissement;
  matching_etablissements?: RechercheEtablissement[];
}

interface RechercheResponse {
  results?: RechercheResult[];
  total_results?: number;
}

function pickEtablissement(
  result: RechercheResult,
  siret: string,
): RechercheEtablissement | null {
  const matching = result.matching_etablissements ?? [];
  const byExact = matching.find((e) => e.siret === siret);
  if (byExact) return byExact;
  if (result.siege?.siret === siret) return result.siege;
  return matching[0] ?? result.siege ?? null;
}

function mapActiveStatus(etat: string | undefined): "active" | "closed" | null {
  if (etat === "A") return "active";
  if (etat === "C") return "closed";
  return null;
}

export async function checkSiret(rawSiret: string): Promise<SiretResult> {
  const now = new Date().toISOString();
  const siret = normalizeSiret(rawSiret);
  if (!siret) {
    return {
      found: false,
      siret: rawSiret,
      companyName: null,
      address: null,
      activity: null,
      activeStatus: null,
      creationDate: null,
      requestDate: now,
      serviceError: "Le SIRET doit contenir exactement 14 chiffres.",
    };
  }

  const url = `https://recherche-entreprises.api.gouv.fr/search?q=${siret}&page=1&per_page=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIRET_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn("[SIRET] non-200 response", { status: res.status });
      return {
        found: false,
        siret,
        companyName: null,
        address: null,
        activity: null,
        activeStatus: null,
        creationDate: null,
        requestDate: now,
        serviceError: `Le service INSEE a répondu ${res.status}. Réessayez.`,
      };
    }

    const data = (await res.json().catch(() => null)) as RechercheResponse | null;
    const first = data?.results?.[0];
    if (!first) {
      return {
        found: false,
        siret,
        companyName: null,
        address: null,
        activity: null,
        activeStatus: null,
        creationDate: null,
        requestDate: now,
      };
    }

    const etab = pickEtablissement(first, siret);
    const companyName = first.nom_complet || first.nom_raison_sociale || null;
    const activity = first.libelle_activite_principale || null;

    return {
      found: true,
      siret,
      companyName,
      address: etab?.adresse ?? null,
      activity,
      activeStatus: mapActiveStatus(etab?.etat_administratif ?? first.etat_administratif),
      creationDate: first.date_creation ?? null,
      requestDate: now,
    };
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === "AbortError";
    logger.error("[SIRET] fetch failed", { error: err });
    return {
      found: false,
      siret,
      companyName: null,
      address: null,
      activity: null,
      activeStatus: null,
      creationDate: null,
      requestDate: now,
      serviceError: isAbort
        ? "Le service INSEE n'a pas répondu à temps."
        : "Impossible de joindre le service INSEE.",
    };
  }
}
