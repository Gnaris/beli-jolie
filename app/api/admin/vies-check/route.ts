import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/vies-check?vat=BE0506978319
 *
 * Vérifie un numéro de TVA intracommunautaire auprès de VIES
 * (base officielle de la Commission européenne).
 *
 * Le service est purement informatif — l'admin prend la décision finale
 * d'approbation du compte. On renvoie les infos brutes de VIES ainsi
 * qu'un éventuel message d'erreur (service indisponible, format invalide…).
 *
 * Endpoint VIES : https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{CC}/vat/{NUMBER}
 * (NUMBER sans le préfixe pays)
 */

const EU_MEMBER_STATES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR",
  "GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL",
  "PT","RO","SE","SI","SK","XI", // XI = Irlande du Nord (post-Brexit, reconnue par VIES)
]);

const VIES_TIMEOUT_MS = 10_000;

interface ViesResult {
  valid: boolean;
  countryCode: string;
  vatNumber: string;
  name: string | null;
  address: string | null;
  requestDate: string | null;
  /** Présent uniquement si VIES n'a pas pu être joint ou a renvoyé un format inattendu. */
  serviceError?: string;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("vat")?.trim().toUpperCase() ?? "";
  if (!raw) {
    return NextResponse.json({ error: "Paramètre 'vat' manquant." }, { status: 400 });
  }

  // Normalisation : enlève espaces et points, ne garde que [A-Z0-9]
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 4 || cleaned.length > 15) {
    return NextResponse.json(
      { error: "Format invalide : 2 lettres de pays + numéro (ex: BE0506978319)." },
      { status: 400 }
    );
  }

  const countryCode = cleaned.slice(0, 2);
  const number = cleaned.slice(2);

  if (!EU_MEMBER_STATES.has(countryCode)) {
    return NextResponse.json(
      { error: `Pays '${countryCode}' non membre de l'UE (ou non reconnu par VIES).` },
      { status: 400 }
    );
  }

  const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${number}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIES_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn("[VIES] non-200 response", { countryCode, status: res.status });
      const result: ViesResult = {
        valid: false,
        countryCode,
        vatNumber: number,
        name: null,
        address: null,
        requestDate: null,
        serviceError: `VIES a répondu ${res.status}. Service peut-être temporairement indisponible.`,
      };
      return NextResponse.json(result, { status: 200 });
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      const result: ViesResult = {
        valid: false,
        countryCode,
        vatNumber: number,
        name: null,
        address: null,
        requestDate: null,
        serviceError: "Réponse VIES illisible.",
      };
      return NextResponse.json(result, { status: 200 });
    }

    // Champs VIES : isValid, name, address, requestDate (et parfois userError pour "INVALID_INPUT" etc.)
    const d = data as Record<string, unknown>;
    const result: ViesResult = {
      valid: d.isValid === true || d.valid === true,
      countryCode,
      vatNumber: number,
      name: typeof d.name === "string" && d.name.trim() && d.name !== "---" ? d.name : null,
      address: typeof d.address === "string" && d.address.trim() && d.address !== "---" ? d.address : null,
      requestDate: typeof d.requestDate === "string" ? d.requestDate : null,
    };

    // VIES renvoie un userError non vide (ex: "INVALID_INPUT", "SERVICE_UNAVAILABLE") en cas de souci
    if (typeof d.userError === "string" && d.userError && d.userError !== "VALID") {
      result.serviceError = `VIES : ${d.userError}`;
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === "AbortError";
    logger.error("[VIES] fetch failed", {
      countryCode,
      error: err instanceof Error ? err.message : String(err),
    });
    const result: ViesResult = {
      valid: false,
      countryCode,
      vatNumber: number,
      name: null,
      address: null,
      requestDate: null,
      serviceError: isAbort
        ? "VIES n'a pas répondu dans les 10 secondes."
        : "Impossible de joindre VIES.",
    };
    return NextResponse.json(result, { status: 200 });
  }
}
