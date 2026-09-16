/**
 * Configuration du paiement par virement bancaire (par tenant).
 *
 * Trois clés SiteConfig :
 *  - `bank_transfer_enabled` : "1" | "0"
 *  - `bank_transfer_holder`  : titulaire du compte (en clair)
 *  - `bank_transfer_iban`    : IBAN chiffré (dans SENSITIVE_KEYS)
 *
 * Lecture cachée 5 min par tenant, invalidée par `revalidateTag("site-config")`
 * après chaque écriture depuis `setBankTransferConfig`.
 */
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import { getCurrentTenantId } from "@/lib/tenant";

// Ré-export des helpers pur format (déplacés dans un fichier neutre pour
// pouvoir être importés depuis des composants client sans traîner Prisma).
export { formatIbanForDisplay, normalizeIban, isPlausibleIban } from "@/lib/iban-format";

export interface BankTransferConfig {
  enabled: boolean;
  holder: string;
  iban: string;
}

const EMPTY: BankTransferConfig = { enabled: false, holder: "", iban: "" };

async function fetchBankTransferConfig(tenantId: string): Promise<BankTransferConfig> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      tenantId,
      key: { in: ["bank_transfer_enabled", "bank_transfer_holder", "bank_transfer_iban"] },
    },
    select: { key: true, value: true },
  });

  const map = new Map(rows.map((r) => [r.key, r.value] as const));
  const holderRaw = map.get("bank_transfer_holder")?.trim() ?? "";
  const ibanRaw = map.get("bank_transfer_iban")?.trim() ?? "";
  const enabledRaw = map.get("bank_transfer_enabled")?.trim() ?? "";

  // IBAN est stocké chiffré (voir SENSITIVE_KEYS). decryptIfSensitive gère aussi
  // le cas legacy en clair (retourne la valeur telle quelle).
  const iban = ibanRaw ? decryptIfSensitive("bank_transfer_iban", ibanRaw) : "";

  const enabled = enabledRaw === "1" && !!holderRaw && !!iban;

  return { enabled, holder: holderRaw, iban };
}

const cachedFetcher = unstable_cache(
  async (tenantId: string) => fetchBankTransferConfig(tenantId),
  ["bank-transfer-config"],
  { revalidate: 300, tags: ["site-config"] },
);

/**
 * Retourne la config virement du tenant courant (résolu via ALS/headers).
 * En dehors d'un contexte requête (scripts), retourne EMPTY.
 */
export async function getCachedBankTransferConfig(): Promise<BankTransferConfig> {
  const tid = await getCurrentTenantId();
  if (!tid) return EMPTY;
  return cachedFetcher(tid);
}

/**
 * Version sans cache — pour les écrans admin qui ont besoin de la valeur
 * immédiatement après un save (le revalidateTag met parfois quelques ms).
 */
export async function getBankTransferConfigFresh(): Promise<BankTransferConfig> {
  const tid = await getCurrentTenantId();
  if (!tid) return EMPTY;
  return fetchBankTransferConfig(tid);
}

