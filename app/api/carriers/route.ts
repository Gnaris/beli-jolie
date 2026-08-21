import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as crypto from "crypto";
import { authOptions } from "@/lib/auth";
import { fetchEasyExpressRates, splitWeightIntoParcels } from "@/lib/easy-express";
import { smarty365Rates } from "@/lib/smarty365";
import {
  getCachedEasyExpressApiKey,
  getCachedSmarty365ApiKey,
  getCachedShippingMargin,
  getCachedActiveShippingProvider,
  getCachedSmarty365InsuranceRatePct,
} from "@/lib/cached-data";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { signCarrier } from "@/lib/carrier-signature";

const carriersSchema = z.object({
  zipCode: z.string().min(1),
  country: z.string().min(2).max(3),
  weightKg: z.number().min(0),
  // Optionnel : valeur HT du panier, utilisée pour calculer le supplément
  // d'assurance Smarty365 (fondu dans le prix affiché). Absence tolérée pour
  // rétrocompatibilité avec un client qui ne l'enverrait pas encore.
  subtotalHT: z.number().min(0).optional(),
});

/**
 * POST /api/carriers
 *
 * Renvoie la liste des transporteurs disponibles pour un couple pays/CP/poids
 * donné, en interrogeant le fournisseur actif (Easy-Express ou Smarty365).
 *
 * Le format de réponse est stable pour ne pas casser le composant client :
 *   { transactionId, carriers[], parcelCount, noCarrierConfigured? }
 *
 * Cas Smarty365 :
 *   - `transactionId` = jeton synthétique `smarty:v1:{random}` — Smarty365 ne
 *     délivre pas de token de cotation, mais on en génère un côté serveur pour
 *     nourrir la signature HMAC (sinon verifyCarrierSignature refuse). Le
 *     client le repasse tel quel à /api/payments/create-intent.
 *   - Les prix incluent le supplément d'assurance obligatoire (fondu, non
 *     affiché séparément à la cliente).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const parsed = carriersSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  const { zipCode, country, weightKg, subtotalHT } = parsed.data;
  const parcelCount = splitWeightIntoParcels(weightKg).length;

  const activeProvider = await getCachedActiveShippingProvider();

  // Vérifie qu'une clé est bien configurée pour le fournisseur actif.
  const apiKey =
    activeProvider === "smarty365"
      ? await getCachedSmarty365ApiKey()
      : await getCachedEasyExpressApiKey();

  if (!apiKey) {
    return NextResponse.json({
      transactionId: "",
      carriers: [],
      parcelCount,
      noCarrierConfigured: true,
    });
  }

  // Appelle le bon provider et harmonise la réponse.
  let transactionId = "";
  let carriers: { carrierId: string; name: string; price: number; delay: string; logo: string }[] = [];
  let insuranceSurchargeEur = 0;

  if (activeProvider === "smarty365") {
    const result = await smarty365Rates({
      receiverCountry: country,
      receiverZipCode: zipCode,
      weightKg,
    });
    if (!result.success) {
      logger.error("[carriers] Smarty365 error", { error: result.error });
      return NextResponse.json({
        transactionId: "",
        carriers: [],
        parcelCount,
        noCarrierConfigured: true,
      });
    }
    carriers = result.carriers.map((c) => ({
      carrierId: c.carrierId,
      name: c.name,
      price: c.price,
      delay: c.delay,
      logo: c.logo,
    }));
    // Jeton synthétique pour la signature HMAC (verifyCarrierSignature refuse
    // transactionId vide, cf. lib/carrier-signature.ts).
    transactionId = `smarty:v1:${crypto.randomBytes(12).toString("hex")}`;

    // Assurance obligatoire : supplément fondu dans le prix de port. Calculé
    // en % de la valeur HT du panier ; taux par défaut 1 % (configurable via
    // SiteConfig `smarty365_insurance_rate_pct`).
    if (subtotalHT && subtotalHT > 0) {
      const ratePct = await getCachedSmarty365InsuranceRatePct();
      insuranceSurchargeEur = Math.round(subtotalHT * ratePct / 100 * 100) / 100;
    }
  } else {
    const result = await fetchEasyExpressRates({
      receiverCountry: country,
      receiverZipCode: zipCode,
      weightKg,
    });
    if (!result.success) {
      logger.error("[carriers] Easy-Express error", { error: result.error });
      return NextResponse.json({
        transactionId: "",
        carriers: [],
        parcelCount,
        noCarrierConfigured: true,
      });
    }
    transactionId = result.transactionId;
    carriers = result.carriers.map((c) => ({
      carrierId: c.carrierId,
      name: c.name,
      price: c.price,
      delay: c.delay,
      logo: c.logo,
    }));
  }

  if (carriers.length === 0) {
    logger.warn("[carriers] provider retourna liste vide", { provider: activeProvider });
    return NextResponse.json({
      transactionId,
      carriers: [],
      parcelCount,
      noCarrierConfigured: true,
    });
  }

  // Marge configurable (paramètres admin > Livraison)
  const margin = await getCachedShippingMargin();

  return NextResponse.json({
    transactionId,
    parcelCount,
    carriers: carriers.map((c) => {
      // Assurance fondue AVANT la marge : la marge s'applique sur le tarif
      // transport + assurance (traité comme un seul « coût de port réel »).
      let finalPrice = c.price + insuranceSurchargeEur;
      if (margin.value > 0) {
        if (margin.type === "fixed") {
          finalPrice += margin.value;
        } else {
          finalPrice *= (1 + margin.value / 100);
        }
      }
      const priceCents = Math.round(finalPrice * 100);
      return {
        id: c.carrierId,
        name: c.name,
        price: priceCents / 100,
        delay: c.delay,
        logo: c.logo,
        // Signature HMAC anti-fraude carrierPrice (audit checkout §8) —
        // le client doit repasser `sig` à /api/payments/create-intent.
        sig: signCarrier({
          carrierId: c.carrierId,
          priceCents,
          transactionId,
        }),
      };
    }),
  });
}
