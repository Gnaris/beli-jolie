import "server-only";
import { translateTextStrict } from "@/lib/translate";
import { logger } from "@/lib/logger";

/**
 * Traduction FR → EN d'un corps de modèle WhatsApp, en préservant les
 * variables `{token}` (firstName, shopName, adminFirstName…).
 *
 * Pourquoi une protection : PFS traduit du texte naturel. Si on lui envoie
 * "Bonjour {firstName}, c'est {adminFirstName}." il peut :
 *   - traduire le token (→ `{prénom}`) — casse l'interpolation ;
 *   - insérer des espaces (→ `{ firstName }`) — casse la regex ;
 *   - fusionner deux tokens en un ;
 *   - décorer les accolades (→ `« firstName »`, `[firstName]`).
 *
 * On remplace donc chaque `{token}` par une sentinelle numérotée
 * `⟦N⟧` (guillemets mathématiques U+27E6/U+27E7) — hyper improbable qu'un
 * moteur de traduction les modifie car ce ne sont ni des lettres, ni de la
 * ponctuation courante, ni des symboles familiers.
 *
 * Post-traitement : on remplace `⟦N⟧` par le `{token}` d'origine. Si une
 * sentinelle est manquante ou en double, on considère la trad comme
 * défaillante et on retourne `null` (l'appelant décide : garder le FR seul,
 * afficher un warning, etc.).
 */

const SENTINEL_OPEN = "⟦"; // ⟦
const SENTINEL_CLOSE = "⟧"; // ⟧
const TOKEN_REGEX = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

interface ProtectedText {
  masked: string;
  tokens: string[]; // tokens[N] = nom brut du token pour la sentinelle N
}

export function protectVariables(source: string): ProtectedText {
  const tokens: string[] = [];
  const masked = source.replace(TOKEN_REGEX, (_match, name: string) => {
    const idx = tokens.length;
    tokens.push(name);
    return `${SENTINEL_OPEN}${idx}${SENTINEL_CLOSE}`;
  });
  return { masked, tokens };
}

export function restoreVariables(translated: string, tokens: string[]): string | null {
  if (tokens.length === 0) return translated;

  const seen = new Set<number>();
  const sentinelRegex = new RegExp(`${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`, "g");

  let ok = true;
  const restored = translated.replace(sentinelRegex, (_match, idxStr: string) => {
    const idx = Number.parseInt(idxStr, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= tokens.length) {
      ok = false;
      return _match;
    }
    if (seen.has(idx)) {
      // Sentinelle dupliquée par le moteur — restauration ambiguë.
      ok = false;
      return _match;
    }
    seen.add(idx);
    return `{${tokens[idx]}}`;
  });

  // Toutes les sentinelles doivent être présentes (traduction incomplète sinon).
  if (!ok || seen.size !== tokens.length) return null;

  // Aucune sentinelle résiduelle non consommée (regex globale a matché tout).
  if (restored.includes(SENTINEL_OPEN) || restored.includes(SENTINEL_CLOSE)) return null;

  return restored;
}

/**
 * Traduit un corps de modèle WhatsApp français vers l'anglais, en préservant
 * les variables `{token}`.
 *
 * Retourne `null` si :
 *   - l'API PFS échoue après retry ;
 *   - la traduction a corrompu les sentinelles (perdu / dupliqué / renommé).
 *
 * L'appelant décide alors : ne pas persister `bodyEn` (le send tombera sur
 * FR par fallback), afficher un toast, etc.
 */
export async function translateWhatsAppBodyToEnglish(sourceFr: string): Promise<string | null> {
  const trimmed = sourceFr.trim();
  if (trimmed.length === 0) return null;

  const { masked, tokens } = protectVariables(trimmed);

  try {
    const translated = await translateTextStrict(masked, "fr", "en");
    if (translated === null) return null;

    const restored = restoreVariables(translated, tokens);
    if (restored === null) {
      logger.warn("[whatsapp-translate] sentinelles corrompues après traduction", {
        source: trimmed.slice(0, 120),
        translated: translated.slice(0, 120),
        tokenCount: tokens.length,
      });
      return null;
    }
    return restored;
  } catch (e) {
    logger.warn("[whatsapp-translate] échec traduction", { error: e as Error });
    return null;
  }
}
