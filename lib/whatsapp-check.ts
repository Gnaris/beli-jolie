/**
 * lib/whatsapp-check.ts
 *
 * Vérification « ce numéro a-t-il WhatsApp ? » avec cache BDD + rate-limit journalier.
 *
 * Pyramide de garde-fous (dans l'ordre d'évaluation) :
 *   1. Session Baileys prête ?           sinon → "unknown" (silencieux, pas de counter)
 *   2. Numéro valide (pas une ligne fixe) ? sinon → "unknown"
 *   3. Cache BDD valide (User.hasWhatsapp)  → "yes" | "no"
 *   4. Rate-limit journalier atteint ?     → "ratelimited"
 *   5. Vrai appel Baileys `onWhatsApp(...)` + persist résultat en BDD + incr counter
 *
 * Le rate-limit est GLOBAL (variable in-memory + fichier disque backup) car la
 * session Baileys est partagée entre les 2 tenants (BJ + Issyma). Mettre un
 * compteur par tenant défoncerait la limite réelle Meta.
 *
 * Reset auto à minuit UTC. Max par défaut : 100 vérifications / jour (voir MAX_PER_DAY).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkWhatsappNumberRaw } from "@/lib/whatsapp-session";

export type WhatsappCheckOutcome = "yes" | "no" | "unknown" | "ratelimited";

const MAX_PER_DAY = 100;
const COUNTER_FILE = path.resolve(
  process.cwd(),
  "private",
  "whatsapp-session",
  "daily-counter.json",
);

interface CounterSnapshot {
  dateUtc: string; // YYYY-MM-DD
  value: number;
}

let counterCache: CounterSnapshot | null = null;

/**
 * Vérifie si `phone` a WhatsApp, en remontant le résultat au `User`.
 *
 * - Si `userId` est fourni ET qu'on obtient un résultat ferme (`yes`/`no`),
 *   le résultat est écrit en BDD (`User.hasWhatsapp` + `whatsappCheckedAt`).
 * - Si le cache BDD est frais, on le renvoie sans toucher à Baileys.
 * - Si rate-limited, on renvoie `"ratelimited"` sans consommer de slot.
 */
export async function checkWhatsappNumber(
  phone: string | null | undefined,
  userId?: string | null,
): Promise<WhatsappCheckOutcome> {
  const raw = (phone ?? "").trim();
  if (!raw || isLikelyLandline(raw)) return "unknown";

  // 1. Cache BDD : si on connait déjà la réponse pour ce userId, on la ressort.
  if (userId) {
    const cached = await prisma.user.findUnique({
      where: { id: userId },
      select: { hasWhatsapp: true, whatsappCheckedAt: true },
    });
    if (cached && cached.hasWhatsapp !== null) {
      return cached.hasWhatsapp ? "yes" : "no";
    }
  }

  // 2. Rate-limit global (variable in-memory + fichier disque backup).
  const counter = await readCounter();
  if (counter.value >= MAX_PER_DAY) {
    return "ratelimited";
  }

  // 3. Vrai appel Baileys. `null` = session pas prête → on ne consomme pas de slot.
  const result = await checkWhatsappNumberRaw(raw);
  if (result === null) return "unknown";

  // 4. Persist en BDD si on a un userId.
  if (userId) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { hasWhatsapp: result, whatsappCheckedAt: new Date() },
      });
    } catch (err) {
      logger.warn("[WhatsApp] Impossible d'enregistrer le resultat en BDD", {
        error: err as Error,
      });
    }
  }

  // 5. Incrémenter le counter uniquement sur un vrai appel API.
  await incrementCounter();

  return result ? "yes" : "no";
}

/** Petit helper réutilisable pour un lazy-check côté page serveur. */
export async function checkWhatsappNumberFireAndForget(
  phone: string | null | undefined,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    await checkWhatsappNumber(phone, userId);
  } catch (err) {
    logger.warn("[WhatsApp] fire-and-forget a echoue", { error: err as Error });
  }
}

/** Expose l'etat du counter pour l'UI admin (étape 1b/4 : debug + info). */
export async function getWhatsappDailyCounter(): Promise<{
  used: number;
  limit: number;
  dateUtc: string;
}> {
  const counter = await readCounter();
  return { used: counter.value, limit: MAX_PER_DAY, dateUtc: counter.dateUtc };
}

/** Reset manuel (utile pour tests ou commande admin). */
export async function resetWhatsappDailyCounter(): Promise<void> {
  counterCache = { dateUtc: todayUtc(), value: 0 };
  await persistCounter(counterCache);
}

/* ─────────────────────── Internes ─────────────────────── */

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readCounter(): Promise<CounterSnapshot> {
  const today = todayUtc();
  if (counterCache && counterCache.dateUtc === today) return counterCache;

  // Soit le cache in-memory est perime (changement de jour), soit on vient
  // de boot le process → on relit le fichier disque.
  try {
    const buf = await fs.readFile(COUNTER_FILE, "utf-8");
    const parsed = JSON.parse(buf) as CounterSnapshot;
    if (parsed.dateUtc === today) {
      counterCache = parsed;
      return parsed;
    }
  } catch {
    // Fichier absent ou corrompu → on repart de zero.
  }

  counterCache = { dateUtc: today, value: 0 };
  await persistCounter(counterCache);
  return counterCache;
}

async function incrementCounter(): Promise<void> {
  const current = await readCounter();
  counterCache = { dateUtc: current.dateUtc, value: current.value + 1 };
  await persistCounter(counterCache);
}

async function persistCounter(snap: CounterSnapshot): Promise<void> {
  try {
    await fs.mkdir(path.dirname(COUNTER_FILE), { recursive: true });
    await fs.writeFile(COUNTER_FILE, JSON.stringify(snap), "utf-8");
  } catch (err) {
    logger.warn("[WhatsApp] Persistance du counter echouee", {
      error: err as Error,
    });
  }
}

/**
 * Lignes fixes françaises typiques — on refuse de les tester (gaspillage
 * de slot + bien peu de chance qu'un fixe soit sur WhatsApp).
 *
 * Note : volontairement identique a l'heuristique de PhoneContactIcons.tsx
 * pour que le comportement UI/serveur soit coherent. A garder synchronise.
 */
export function isLikelyLandline(raw: string): boolean {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.length === 10 && /^0[123459]/.test(cleaned)) return true;
  if (cleaned.startsWith("+33") && /^\+33[123459]/.test(cleaned)) return true;
  if (cleaned.startsWith("0033") && /^0033[123459]/.test(cleaned)) return true;
  if (cleaned.startsWith("33") && cleaned.length === 11 && /^33[123459]/.test(cleaned)) return true;
  return false;
}
