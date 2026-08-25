"use server";

/**
 * Server actions Microstore — CRUD des attributs bibliothèque (catégorie,
 * marque, année, saison, composition) et couleurs. Wrappers autour de
 * `lib/microstore-attributes.ts` avec `requireAdmin()` + retour standardisé.
 */

import { requireAdmin } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import {
  microstoreListAttribute,
  microstoreCreateAttribute,
  microstoreEditAttribute,
  microstoreDeleteAttribute,
  microstoreListColors,
  microstoreCreateColor,
  microstoreEditColor,
  microstoreDeleteColor,
  type MicrostoreAttrType,
  type MicrostoreAttrItem,
  type MicrostoreColor,
} from "@/lib/microstore-attributes";

interface ActionResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

async function humanize(err: unknown): Promise<string> {
  if (err instanceof MicrostoreSessionExpiredError) {
    return "Session Microstore expirée. Reconnectez-vous via QR code dans Paramètres → Microstore.";
  }
  if (err instanceof Error) return err.message;
  return "Erreur Microstore inconnue.";
}

// ─── Attributs génériques (category/brand/year/season/composition) ───────

export async function listMicrostoreAttribute(
  type: MicrostoreAttrType,
): Promise<ActionResult<MicrostoreAttrItem[]>> {
  await requireAdmin();
  try {
    const list = await microstoreListAttribute(type);
    return { success: true, data: list };
  } catch (err) {
    logger.error("[Microstore attr] list failed", { error: err, type });
    return { success: false, error: await humanize(err) };
  }
}

export async function createMicrostoreAttribute(opts: {
  type: MicrostoreAttrType;
  name: string;
  order?: number;
}): Promise<ActionResult<{ id: string; name: string }>> {
  await requireAdmin();
  const name = opts.name.trim();
  if (!name) return { success: false, error: "Le nom est obligatoire." };
  try {
    const created = await microstoreCreateAttribute({
      type: opts.type,
      name,
      order: opts.order,
    });
    // Note: revalidatePath retiré — la lib fetch en client-side dans MicrostoreAttributesClient
    // via reload() après chaque mutation, donc pas besoin. Évite un warning silencieux
    // Next.js 16 quand la page n'a jamais été cachée.
    return { success: true, data: created };
  } catch (err) {
    logger.error("[Microstore attr] create failed", { error: err, type: opts.type });
    return { success: false, error: await humanize(err) };
  }
}

export async function editMicrostoreAttribute(opts: {
  type: MicrostoreAttrType;
  id: string;
  name?: string;
  order?: number;
}): Promise<ActionResult> {
  await requireAdmin();
  try {
    await microstoreEditAttribute(opts);
    return { success: true };
  } catch (err) {
    logger.error("[Microstore attr] edit failed", { error: err, type: opts.type });
    return { success: false, error: await humanize(err) };
  }
}

export async function deleteMicrostoreAttribute(opts: {
  type: MicrostoreAttrType;
  id: string;
  force?: boolean;
}): Promise<ActionResult> {
  await requireAdmin();
  try {
    await microstoreDeleteAttribute(opts);
    return { success: true };
  } catch (err) {
    logger.error("[Microstore attr] delete failed", { error: err, type: opts.type });
    return { success: false, error: await humanize(err) };
  }
}

// ─── Couleurs ────────────────────────────────────────────────────────────

export async function listMicrostoreColors(): Promise<ActionResult<MicrostoreColor[]>> {
  await requireAdmin();
  try {
    const list = await microstoreListColors();
    return { success: true, data: list };
  } catch (err) {
    logger.error("[Microstore color] list failed", { error: err });
    return { success: false, error: await humanize(err) };
  }
}

export async function createMicrostoreColor(opts: {
  name: string;
}): Promise<ActionResult<{ id: string; name: string }>> {
  await requireAdmin();
  const name = opts.name.trim();
  if (!name) return { success: false, error: "Le nom est obligatoire." };
  logger.info("[Microstore color] create attempt", { name });
  try {
    const created = await microstoreCreateColor({ name });
    logger.info("[Microstore color] create OK", { id: created.id, name: created.name });
    return { success: true, data: created };
  } catch (err) {
    logger.error("[Microstore color] create failed", { error: err, name });
    return { success: false, error: await humanize(err) };
  }
}

export async function editMicrostoreColor(opts: {
  id: string;
  name: string;
  order?: number;
}): Promise<ActionResult> {
  await requireAdmin();
  try {
    await microstoreEditColor(opts);
    return { success: true };
  } catch (err) {
    logger.error("[Microstore color] edit failed", { error: err });
    return { success: false, error: await humanize(err) };
  }
}

export async function deleteMicrostoreColor(opts: {
  id: string;
  name: string;
  order?: number;
}): Promise<ActionResult> {
  await requireAdmin();
  try {
    await microstoreDeleteColor(opts);
    return { success: true };
  } catch (err) {
    logger.error("[Microstore color] delete failed", { error: err });
    return { success: false, error: await humanize(err) };
  }
}
