/**
 * scripts/generate-translations.ts
 *
 * Génère automatiquement les fichiers de traduction pour toutes les langues
 * à partir de messages/fr.json en utilisant MyMemory API (100% gratuit, sans clé).
 *
 * Usage :
 *   npx tsx scripts/generate-translations.ts
 *
 * Langues générées : en, ar, zh, de, es, it
 */

import fs from "fs";
import path from "path";

// ── Configuration ─────────────────────────────────────────────────────────────

const SOURCE_LOCALE = "fr";
const TARGET_LOCALES = [
  { code: "en", myMemory: "en-US" },
  { code: "ar", myMemory: "ar-SA" },
  { code: "zh", myMemory: "zh-CN" },
  { code: "de", myMemory: "de-DE" },
  { code: "es", myMemory: "es-ES" },
  { code: "it", myMemory: "it-IT" },
];

const MESSAGES_DIR = path.join(process.cwd(), "messages");
const DELAY_MS = 200; // Délai entre les appels API pour éviter le rate limiting

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Traduit un texte avec MyMemory API (gratuit, sans clé) */
async function translateMyMemory(
  text: string,
  from: string,
  to: string
): Promise<string> {
  if (!text.trim()) return text;

  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      return data.responseData.translatedText;
    }
    console.warn(`  ⚠ MyMemory returned status ${data.responseStatus} for: "${text.slice(0, 40)}"`);
    return text;
  } catch (err) {
    console.warn(`  ⚠ Translation failed for: "${text.slice(0, 40)}" — ${err}`);
    return text;
  }
}

/** Aplatit un objet JSON imbriqué en { "a.b.c": "value" } */
function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      Object.assign(result, flatten(val as Record<string, unknown>, fullKey));
    } else if (typeof val === "string") {
      result[fullKey] = val;
    }
  }
  return result;
}

/** Reconstruit un objet JSON imbriqué depuis { "a.b.c": "value" } */
function unflatten(flat: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [fullKey, value] of Object.entries(flat)) {
    const keys = fullKey.split(".");
    let current = result;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]] as Record<string, unknown>;
    }
    current[keys[keys.length - 1]] = value;
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Charger le fichier source
  const sourcePath = path.join(MESSAGES_DIR, `${SOURCE_LOCALE}.json`);
  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  const source = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
  const flatSource = flatten(source);
  const keys = Object.keys(flatSource);
  const values = Object.values(flatSource);

  console.log(`📖 Loaded ${keys.length} strings from messages/fr.json\n`);

  // Traduire vers chaque langue cible
  for (const { code, myMemory } of TARGET_LOCALES) {
    const outputPath = path.join(MESSAGES_DIR, `${code}.json`);
    const flatTranslated: Record<string, string> = {};

    console.log(`🌐 Translating to ${code} (${myMemory})...`);

    let translated = 0;
    let skipped = 0;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = values[i];

      // Ne pas traduire les clés qui contiennent des variables ({xxx})
      // ou des valeurs vides
      if (!value.trim()) {
        flatTranslated[key] = value;
        skipped++;
        continue;
      }

      // Préserver les variables dans la traduction (ex: {remaining})
      const variables: string[] = [];
      const valueWithPlaceholders = value.replace(/\{[^}]+\}/g, (match) => {
        const index = variables.length;
        variables.push(match);
        return `__VAR${index}__`;
      });

      const result = await translateMyMemory(
        valueWithPlaceholders,
        SOURCE_LOCALE,
        myMemory
      );

      // Restaurer les variables
      let finalResult = result;
      variables.forEach((v, idx) => {
        finalResult = finalResult.replace(`__VAR${idx}__`, v);
      });

      flatTranslated[key] = finalResult;
      translated++;

      // Afficher la progression
      if ((i + 1) % 10 === 0 || i + 1 === keys.length) {
        process.stdout.write(`\r  Progress: ${i + 1}/${keys.length} strings`);
      }

      await sleep(DELAY_MS);
    }

    console.log(`\n  ✅ ${translated} translated, ${skipped} skipped`);

    // Sauvegarder
    const output = unflatten(flatTranslated);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
    console.log(`  💾 Saved to messages/${code}.json\n`);
  }

  console.log("✨ All translations generated successfully!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
