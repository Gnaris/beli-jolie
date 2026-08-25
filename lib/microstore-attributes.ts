/**
 * Microstore (Dokkr) — CRUD sur les attributs bibliothèque et les couleurs.
 *
 * L'appli mobile MC Gérant expose 2 endpoints génériques :
 *
 *   • POST /user/set_attr  — pour category, brand, year, season, composition.
 *     Format bulk : `data=[{op:"add|edit|del", ...}]`. **`cat_order` est
 *     obligatoire** : c'est la liste complète des IDs dans l'ordre d'affichage
 *     souhaité. Pour un `add`, on inclut aussi le nouveau `order_alias` (ex "new51")
 *     à la position voulue — Microstore assigne un id définitif à l'alias.
 *
 *   • POST /user/set_color — spécifique aux couleurs (unit_number + total_quantity).
 *     Format bulk `data=[{op, id, name, ...}]`. L'`id` pour `add` semble être
 *     un compteur local côté client — on utilise max+1 par défaut.
 *
 * Wrappers exposés (add / edit / del) pour usage server actions et scripts.
 *
 * ⚠ Auth : identique à goods-crud.ts (token QR compagnon 5_XXX).
 */

import {
  getMicrostoreSessionKey,
  isMicrostoreSessionExpiredError,
} from "@/lib/microstore-auth";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import { logger } from "@/lib/logger";

const MC_API_BASE = "https://api2.dokkr.net/index.php";

// ─── Types ───────────────────────────────────────────────────────────────

/** Types d'attributs Microstore gérés par /user/set_attr. */
export type MicrostoreAttrType =
  | "category"
  | "brand"
  | "year"
  | "season"
  | "composition";

export interface MicrostoreAttrItem {
  id: string;
  name: string;
}

interface McErrorPayload {
  err?: number;
  msg?: string;
  debug_msg?: string;
}

// ─── HTTP low-level ──────────────────────────────────────────────────────

async function callMicrostorePost<T>(
  path: string,
  body: URLSearchParams,
): Promise<T & McErrorPayload> {
  let res: Response;
  try {
    res = await fetch(`${MC_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "app-pid": "91",
        "app-version": "2.76.21",
        "api-version": "1.0",
        lang: "en",
        "user-agent": "Dart/3.11 (dart:io)",
      },
      body: body.toString(),
      cache: "no-store",
    });
  } catch (err) {
    logger.error("[Microstore attr] network error", { error: err, path });
    throw new Error("Impossible de contacter Microstore.");
  }
  if (!res.ok) {
    throw new Error(`Microstore a répondu HTTP ${res.status} sur ${path}.`);
  }
  const data = (await res.json().catch(() => null)) as
    | (T & McErrorPayload)
    | null;
  if (!data) throw new Error("Réponse Microstore invalide.");
  if (isMicrostoreSessionExpiredError(data.err)) {
    throw new MicrostoreSessionExpiredError();
  }
  return data;
}

// ─── Liste courante d'un type d'attribut ─────────────────────────────────

/**
 * Récupère la liste ordonnée des attributs d'un type donné (nécessaire pour
 * construire `cat_order` avant un add/del/edit). Passe par le data_center qui
 * retourne l'objet `list` dans le bon ordre.
 */
export async function microstoreListAttribute(
  type: MicrostoreAttrType,
): Promise<MicrostoreAttrItem[]> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = new URLSearchParams({
    key,
    data_code: `get_attribute_config`,
    set_from: "all",
    lang: "en",
    app_pid: "91",
    app_version: "2.76.21",
    api_version: "1.0",
    version: "0",
  });
  const res = await callMicrostorePost<{
    list?: Record<string, Array<MicrostoreAttrItem>>;
    ret?: Record<string, Array<MicrostoreAttrItem>>;
  }>("/data_center/get_data", body);
  const bucket = res.list?.[type] || res.ret?.[type] || [];
  return bucket.map((x) => ({ id: String(x.id), name: String(x.name) }));
}

// ─── /user/set_attr ──────────────────────────────────────────────────────

interface AttrOp {
  op: "add" | "edit" | "del";
  id?: string;
  name?: string;
  order?: string;
  order_alias?: string;
  force_del?: string;
}

/**
 * Génère un `cat_order` valide en insérant un `order_alias` "newXX" à la position
 * `insertAtIndex` (1-indexé pour matcher `order` observé dans les HAR).
 * Pour un del, on retire simplement l'id.
 */
export function buildCatOrder(opts: {
  currentIds: string[];
  insertAlias?: { alias: string; atIndex: number };
  removeId?: string;
}): string[] {
  let out = [...opts.currentIds];
  if (opts.removeId) {
    out = out.filter((id) => id !== opts.removeId);
  }
  if (opts.insertAlias) {
    const { alias, atIndex } = opts.insertAlias;
    const clamped = Math.max(0, Math.min(atIndex, out.length));
    out.splice(clamped, 0, alias);
  }
  return out;
}

/**
 * Appel bas niveau — expose le format exact du HAR. Préfère les wrappers
 * `microstoreCreateAttribute`, `microstoreEditAttribute`, `microstoreDeleteAttribute`.
 */
export async function microstoreSetAttribute(opts: {
  type: MicrostoreAttrType;
  catOrder: string[];
  data: AttrOp[];
}): Promise<{ list?: MicrostoreAttrItem[] }> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = new URLSearchParams();
  body.set("key", key);
  body.set("type", opts.type);
  body.set("cat_order", JSON.stringify(opts.catOrder));
  body.set("data", JSON.stringify(opts.data));
  body.set("app_version", "2.76.21");
  body.set("app_pid", "91");
  body.set("api_version", "1.0");
  body.set("lang", "en");

  const res = await callMicrostorePost<{ list?: MicrostoreAttrItem[] }>(
    "/user/set_attr",
    body,
  );
  if (res.err !== 0) {
    throw new Error(
      `Microstore /user/set_attr (${opts.type}) a refusé : ${res.msg || res.debug_msg || `err=${res.err}`}`,
    );
  }
  return { list: res.list };
}

/**
 * Crée un nouvel attribut (catégorie, marque, année, saison, composition).
 * Fetch d'abord la liste courante pour construire un `cat_order` valide.
 * Retourne l'id définitif attribué par Microstore.
 */
export async function microstoreCreateAttribute(opts: {
  type: MicrostoreAttrType;
  name: string;
  /** Position 1-indexée où insérer (défaut : à la fin). */
  order?: number;
}): Promise<{ id: string; name: string }> {
  const current = await microstoreListAttribute(opts.type);
  const currentIds = current.map((x) => x.id);
  const alias = `new${opts.order ?? current.length + 1}`;
  const catOrder = buildCatOrder({
    currentIds,
    insertAlias: {
      alias,
      atIndex: (opts.order ?? current.length + 1) - 1,
    },
  });
  const res = await microstoreSetAttribute({
    type: opts.type,
    catOrder,
    data: [
      {
        op: "add",
        order: String(opts.order ?? current.length + 1),
        name: opts.name,
        order_alias: alias,
      },
    ],
  });
  const created = res.list?.[0];
  if (!created) throw new Error("Microstore n'a pas retourné l'id du nouvel attribut.");
  return created;
}

/**
 * Modifie le nom (ou l'ordre) d'un attribut existant.
 */
export async function microstoreEditAttribute(opts: {
  type: MicrostoreAttrType;
  id: string;
  name?: string;
  order?: number;
}): Promise<void> {
  const current = await microstoreListAttribute(opts.type);
  const currentIds = current.map((x) => x.id);
  await microstoreSetAttribute({
    type: opts.type,
    catOrder: currentIds,
    data: [
      {
        op: "edit",
        id: opts.id,
        ...(opts.name != null ? { name: opts.name } : {}),
        ...(opts.order != null ? { order: String(opts.order) } : {}),
      },
    ],
  });
}

/**
 * Supprime un attribut. `force=true` supprime même si des produits l'utilisent
 * (à ses risques et périls) ; `force=false` (défaut) laisse Microstore refuser
 * si l'attribut est utilisé quelque part.
 */
export async function microstoreDeleteAttribute(opts: {
  type: MicrostoreAttrType;
  id: string;
  force?: boolean;
}): Promise<void> {
  const current = await microstoreListAttribute(opts.type);
  const currentIds = current.map((x) => x.id);
  const catOrder = buildCatOrder({ currentIds, removeId: opts.id });
  await microstoreSetAttribute({
    type: opts.type,
    catOrder,
    data: [
      {
        op: "del",
        id: opts.id,
        force_del: opts.force ? "1" : "0",
      },
    ],
  });
}

// ─── /user/set_attr_alias — libellés multilangue ─────────────────────────

/**
 * Modifie l'alias (= libellé affiché) d'un attribut système Microstore.
 * Ex : `{ alias: "Marque", attr: "goods.brand" }` renomme l'étiquette "Brand"
 * en "Marque" dans l'UI Microstore de la boutique.
 *
 * Attributs connus : `goods.brand`, `goods.year`, `goods.season`, `goods.category`,
 * `goods.remark_material` (composition), `goods.color` (couleur).
 */
export async function microstoreSetAttributeAlias(opts: {
  attr: string;
  alias: string;
}): Promise<void> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = new URLSearchParams();
  body.set("key", key);
  body.set("list", JSON.stringify([{ alias: opts.alias, attr: opts.attr }]));
  body.set("app_version", "2.76.21");
  body.set("app_pid", "91");
  body.set("api_version", "1.0");
  body.set("lang", "en");

  const res = await callMicrostorePost<Record<string, unknown>>(
    "/user/set_attr_alias",
    body,
  );
  if (res.err !== 0) {
    throw new Error(
      `Microstore /user/set_attr_alias a refusé : ${res.msg || res.debug_msg || `err=${res.err}`}`,
    );
  }
}

// ─── /user/set_color ─────────────────────────────────────────────────────

export interface MicrostoreColor {
  id: string;
  name: string;
  total_quantity?: string;
  unit_number?: string;
  order?: string;
}

interface ColorOp extends Partial<MicrostoreColor> {
  op: "add" | "edit" | "del";
}

/**
 * Liste toutes les couleurs de la bibliothèque Microstore (utilisée pour dériver
 * `max(id)+1` avant un add). Utilise l'endpoint dédié `POST /user/get_color`.
 */
export async function microstoreListColors(): Promise<MicrostoreColor[]> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = new URLSearchParams({
    key,
    app_pid: "91",
    app_version: "2.76.21",
    api_version: "1.0",
    lang: "en",
  });
  const res = await callMicrostorePost<{ list?: MicrostoreColor[] }>(
    "/user/get_color",
    body,
  );
  return res.list ?? [];
}

/**
 * Appel bas niveau — préfère les wrappers create/edit/delete.
 */
export async function microstoreSetColor(opts: {
  data: ColorOp[];
}): Promise<void> {
  const key = await getMicrostoreSessionKey();
  if (!key) throw new MicrostoreSessionExpiredError();

  const body = new URLSearchParams();
  body.set("key", key);
  body.set("data", JSON.stringify(opts.data));
  body.set("app_version", "2.76.21");
  body.set("app_pid", "91");
  body.set("api_version", "1.0");
  body.set("lang", "en");

  const res = await callMicrostorePost<Record<string, unknown>>(
    "/user/set_color",
    body,
  );
  if (res.err !== 0) {
    throw new Error(
      `Microstore /user/set_color a refusé : ${res.msg || res.debug_msg || `err=${res.err}`}`,
    );
  }
}

/**
 * Crée une nouvelle couleur. `id` optionnel — sinon calcule max(existing)+1.
 * `unit_number` = pièces par unité (typiquement 1).
 */
export async function microstoreCreateColor(opts: {
  name: string;
  id?: string;
  unitNumber?: number;
}): Promise<{ id: string; name: string }> {
  let id = opts.id;
  if (!id) {
    const existing = await microstoreListColors();
    const maxId = existing.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
    id = String(maxId + 1);
  }
  await microstoreSetColor({
    data: [
      {
        op: "add",
        id,
        name: opts.name,
        total_quantity: "0",
        unit_number: String(opts.unitNumber ?? 1),
      },
    ],
  });
  return { id, name: opts.name };
}

export async function microstoreEditColor(opts: {
  id: string;
  name: string;
  order?: number;
  unitNumber?: number;
}): Promise<void> {
  await microstoreSetColor({
    data: [
      {
        op: "edit",
        id: opts.id,
        name: opts.name,
        total_quantity: "0",
        order: String(opts.order ?? 0),
        unit_number: String(opts.unitNumber ?? 1),
      },
    ],
  });
}

export async function microstoreDeleteColor(opts: {
  id: string;
  name: string;
  order?: number;
  unitNumber?: number;
}): Promise<void> {
  // Microstore veut le payload complet (name, total_quantity, order, unit_number)
  // même pour un del — on lui repasse tel qu'attendu.
  await microstoreSetColor({
    data: [
      {
        op: "del",
        id: opts.id,
        name: opts.name,
        total_quantity: "0",
        order: String(opts.order ?? 0),
        unit_number: String(opts.unitNumber ?? 1),
      },
    ],
  });
}
