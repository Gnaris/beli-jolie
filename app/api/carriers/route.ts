import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchEasyExpressRates } from "@/lib/easy-express";
import { getCachedEasyExpressApiKey } from "@/lib/cached-data";
import { z } from "zod";

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
    console.error("[carriers] Easy-Express error:", result.error);
    return NextResponse.json({
      transactionId: "",
      carriers: getFallbackCarriers(country, weightKg),
    });
  }

  // Si l'API retourne une liste vide → fallback
  if (result.carriers.length === 0) {
    console.warn("[carriers] Easy-Express: aucun transporteur retourné, fallback.");
    return NextResponse.json({
      transactionId: result.transactionId,
      carriers: getFallbackCarriers(country, weightKg),
    });
  }

  const CARRIER_MARGIN = 5; // marge en euros
  return NextResponse.json({
    transactionId: result.transactionId,
    carriers: result.carriers.map((c) => ({
      id:    c.carrierId,
      name:  c.name,
      price: Math.round((c.price + CARRIER_MARGIN) * 100) / 100,
      delay: c.delay,
      logo:  c.logo,
    })),
  });
}

/**
 * Transporteurs de repli (si l'API échoue ou n'est pas configurée)
 * Les IDs fallback sont préfixés "fallback_" pour les distinguer des vrais carriers.
 */
function getFallbackCarriers(country: string, weightKg: number) {
  const MARGIN = 5; // marge en euros
  const isFrance = country === "FR";
  const isEU     = ["BE","LU","DE","ES","IT","NL","PT","AT","CH"].includes(country);

  if (isFrance) {
    const colissimo = weightKg <= 0.5 ? 4.95 : weightKg <= 2 ? 7.50 : 12.00;
    return [
      { id: "fallback_colissimo_dom", name: "Colissimo — Domicile",     price: colissimo + MARGIN,     delay: "48h ouvrees" },
      { id: "fallback_colissimo_rel", name: "Colissimo — Point Relais", price: colissimo - 1 + MARGIN, delay: "48h ouvrees" },
      { id: "fallback_chronopost",    name: "Chronopost 13h",           price: colissimo + 6 + MARGIN, delay: "Le lendemain avant 13h" },
    ];
  }

  if (isEU) {
    const base = weightKg <= 1 ? 9.90 : weightKg <= 5 ? 15.00 : 25.00;
    return [
      { id: "fallback_colissimo_eu", name: "Colissimo Europe",  price: base + MARGIN,      delay: "4-7 jours ouvres" },
      { id: "fallback_chrono_eu",    name: "Chronopost Europe", price: base + 10 + MARGIN, delay: "2-3 jours ouvres" },
    ];
  }

  const base = weightKg <= 1 ? 19.90 : weightKg <= 5 ? 32.00 : 55.00;
  return [
    { id: "fallback_colissimo_intl", name: "Colissimo International", price: base + MARGIN, delay: "7-14 jours ouvres" },
  ];
}
