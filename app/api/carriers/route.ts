import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchEasyExpressRates } from "@/lib/easy-express";
import { getCachedEasyExpressApiKey, getCachedShippingMargin } from "@/lib/cached-data";
import { z } from "zod";
import { logger } from "@/lib/logger";

const carriersSchema = z.object({
  zipCode: z.string().min(1),
  country: z.string().min(2).max(3),
  weightKg: z.number().min(0),
});

/**
 * POST /api/carriers
 *
 * Retourne les transporteurs disponibles via Easy-Express /api/v3/shipments/rates.
 * Inclut le transactionId à conserver côté client pour le checkout.
 *
 * Body : { zipCode, country, weightKg }
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

  const { zipCode, country, weightKg } = parsed.data;

  // Vérifier la clé API (DB uniquement, configurée via paramètres admin)
  const apiKey = await getCachedEasyExpressApiKey();

  // Si aucune clé API configurée → pas de transporteur disponible
  if (!apiKey) {
    return NextResponse.json({
      transactionId: "",
      carriers: [],
      noCarrierConfigured: true,
    });
  }

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
      noCarrierConfigured: true,
    });
  }

  // Si l'API retourne une liste vide → aucun transporteur
  if (result.carriers.length === 0) {
    logger.warn("[carriers] Easy-Express: aucun transporteur retourné");
    return NextResponse.json({
      transactionId: result.transactionId,
      carriers: [],
      noCarrierConfigured: true,
    });
  }

  // Marge configurable (paramètres admin > Livraison)
  const margin = await getCachedShippingMargin();

  return NextResponse.json({
    transactionId: result.transactionId,
    carriers: result.carriers.map((c) => {
      let finalPrice = c.price;
      if (margin.value > 0) {
        if (margin.type === "fixed") {
          finalPrice += margin.value;
        } else {
          finalPrice *= (1 + margin.value / 100);
        }
      }
      return {
        id:    c.carrierId,
        name:  c.name,
        price: Math.round(finalPrice * 100) / 100,
        delay: c.delay,
        logo:  c.logo,
      };
    }),
  });
}

