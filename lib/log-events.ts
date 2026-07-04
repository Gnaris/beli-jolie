/**
 * lib/log-events.ts
 *
 * Helpers de formatage pour les logs production multi-ligne.
 * Voir docs/superpowers/specs/2026-05-09-logs-pm2-lisibles-design.md.
 */

export const PREFIX_TO_EVENT: Record<string, string> = {
  "PFS Images": "Image PFS",
  "PFS": "Synchronisation PFS",
  "Storage": "Stockage de fichier",
  "Email": "Envoi d'email",
  "Stripe": "Paiement Stripe",
  "Easy-Express": "Calcul de transport",
  "Auth": "Connexion / inscription",
  "Order": "Commande",
  "Cart": "Panier",
  "Import": "Importation produit",
  "VIES": "Vérification TVA européenne",
  "DnD": "Réorganisation images",
  "IMG_SYNC": "Synchro image PFS",
  "Webhook": "Webhook entrant",
};

const PREFIX_REGEX = /^\[([^\]]+)\]\s*(.*)$/;

export function deduceEvent(message: string): { event: string; cleanMessage: string } {
  const match = message.match(PREFIX_REGEX);
  if (!match) {
    return { event: "Erreur non catégorisée", cleanMessage: message.trim() };
  }
  const [, prefix, rest] = match;
  const event = PREFIX_TO_EVENT[prefix] ?? "Erreur non catégorisée";
  return { event, cleanMessage: rest.trim() };
}

type CauseRule = { test: (msg: string, name: string) => boolean; cause: string };

export const ERROR_CAUSE_RULES: CauseRule[] = [
  { test: (m) => m.includes("ECONNREFUSED"), cause: "Le service distant refuse la connexion" },
  { test: (m) => m.includes("ETIMEDOUT") || /timeout/i.test(m), cause: "Délai d'attente dépassé" },
  { test: (m) => m.includes("ENOTFOUND") || m.includes("EAI_AGAIN"), cause: "Adresse introuvable (DNS)" },
  { test: (m) => m.includes("ENOENT"), cause: "Fichier ou dossier introuvable" },
  { test: (m) => m.includes("EACCES") || m.includes("EPERM"), cause: "Permission refusée" },
  { test: (m) => m.includes("ENOSPC"), cause: "Plus d'espace disque" },
  { test: (m) => m.includes("Unique constraint failed"), cause: "Cette valeur existe déjà en base" },
  { test: (m) => m.includes("Foreign key constraint failed"), cause: "Lien vers une donnée qui n'existe pas" },
  { test: (m) => m.includes("Record to update not found"), cause: "L'enregistrement à modifier n'existe plus" },
  { test: (_m, name) => name === "JsonWebTokenError", cause: "Jeton de session invalide" },
  { test: (_m, name) => name === "TokenExpiredError", cause: "Jeton de session expiré" },
  { test: (m) => /\b429\b/.test(m), cause: "Trop de requêtes, le service distant nous limite" },
  { test: (m) => /\b(401|403)\b/.test(m), cause: "Non autorisé par le service distant" },
  { test: (m) => /\b(500|502|503|504)\b/.test(m), cause: "Le service distant est en panne ou surchargé" },
];

export function deduceCause(error: unknown): string | null {
  let msg = "";
  let name = "";
  if (error instanceof Error) {
    msg = error.message ?? "";
    name = error.name ?? "";
  } else if (typeof error === "string") {
    msg = error;
  } else {
    return null;
  }
  for (const rule of ERROR_CAUSE_RULES) {
    if (rule.test(msg, name)) return rule.cause;
  }
  return null;
}

const APP_DIR_REGEX = /[\/\\](app|lib|components|hooks)[\/\\]/;
// Capture le dernier "chemin:line:col" (avec ou sans parenthèses fermante) à la fin de la frame.
const FRAME_REGEX = /([^\s()]+):(\d+):\d+\)?$/;

export function extractSource(stack: string | undefined): string | null {
  if (!stack) return null;
  const lines = stack.split("\n");
  for (const line of lines) {
    if (line.includes("node_modules") || line.includes(".next/") || line.includes(".next\\")) {
      continue;
    }
    if (!APP_DIR_REGEX.test(line)) continue;
    const match = line.trim().match(FRAME_REGEX);
    if (!match) continue;
    const [, fullPath, lineNo] = match;
    const normalized = fullPath.replace(/\\/g, "/");
    const appMatch = normalized.match(/(?:.*\/)?(app|lib|components|hooks)\/(.+)$/);
    if (!appMatch) continue;
    return `${appMatch[1]}/${appMatch[2]}:${lineNo}`;
  }
  return null;
}

const SEPARATOR = "─".repeat(49);
const LABEL_WIDTH = 14;

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatDate(d: Date): string {
  // Intl renvoie "09/05/2026, 16:32:18" → on enlève la virgule
  return DATE_FMT.format(d).replace(",", "");
}

function pad(label: string): string {
  return label.padEnd(LABEL_WIDTH, " ");
}

function formatStack(stack: string | undefined): { lines: string[]; truncated: number } {
  if (!stack) return { lines: [], truncated: 0 };
  const all = stack.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  return { lines: all.slice(0, 5), truncated: Math.max(0, all.length - 5) };
}

const RESERVED_META_KEYS = new Set(["event", "error", "source"]);

function formatCustomValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function humanizeKey(s: string): string {
  // camelCase → "Camel case"
  const spaced = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export type FormatBlockArgs = {
  level: "error" | "warn";
  message: string;
  meta: Record<string, unknown>;
  now?: Date;
};

export function formatErrorBlock(args: FormatBlockArgs): string {
  const now = args.now ?? new Date();
  const head = args.level === "error" ? "❌ ERREUR" : "⚠️  AVERTISSEMENT";
  const date = formatDate(now);

  const { event: autoEvent, cleanMessage } = deduceEvent(args.message);
  const event = (args.meta.event as string | undefined) ?? autoEvent;

  const errorObj = args.meta.error instanceof Error ? args.meta.error : null;
  const errorString =
    !errorObj && typeof args.meta.error === "string" && args.meta.error.trim()
      ? args.meta.error.trim()
      : null;
  const cause = deduceCause(errorObj ?? errorString);
  const sourceFromMeta = args.meta.source as string | undefined;
  const sourceFromStack = errorObj ? extractSource(errorObj.stack) : null;
  const source = sourceFromMeta ?? sourceFromStack;

  const lines: string[] = [];
  lines.push(SEPARATOR);
  lines.push(`${head} · ${date}`);
  lines.push(`   ${pad("Événement")}: ${event}`);
  if (cleanMessage) lines.push(`   ${pad("Détail")}: ${cleanMessage}`);

  for (const [k, v] of Object.entries(args.meta)) {
    if (RESERVED_META_KEYS.has(k)) continue;
    const formatted = formatCustomValue(v);
    if (formatted === "") continue;
    lines.push(`   ${pad(humanizeKey(k))}: ${formatted}`);
  }

  if (errorObj) {
    lines.push(`   ${pad("Type erreur")}: ${errorObj.name || "Error"}`);
    lines.push(`   ${pad("Message brut")}: ${errorObj.message}`);
  } else if (errorString) {
    lines.push(`   ${pad("Message brut")}: ${errorString}`);
  }
  if (cause) lines.push(`   ${pad("Cause probable")}: ${cause}`);
  if (source) lines.push(`   ${pad("Source")}: ${source}`);

  if (errorObj?.stack) {
    const { lines: stackLines, truncated } = formatStack(errorObj.stack);
    if (stackLines.length > 0) {
      lines.push(`   ${pad("Stack")}:`);
      for (const sl of stackLines) lines.push(`     ${sl}`);
      if (truncated > 0) lines.push(`     ... (${truncated} autres lignes)`);
    }
  }

  lines.push(SEPARATOR);
  return lines.join("\n");
}

const SHORT_DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatShortDate(d: Date): string {
  // "09/05, 16:32:18" → "09/05 16:32:18"
  return SHORT_DATE_FMT.format(d).replace(",", "");
}

export type FormatInfoArgs = {
  message: string;
  meta: Record<string, unknown>;
  now?: Date;
};

export function formatInfoLine(args: FormatInfoArgs): string {
  const date = formatShortDate(args.now ?? new Date());
  const metaStr = Object.keys(args.meta).length > 0 ? ` ${JSON.stringify(args.meta)}` : "";
  return `[${date}] ℹ️  ${args.message}${metaStr}`;
}
