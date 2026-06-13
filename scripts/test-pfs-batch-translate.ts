/**
 * Test : mesurer ce que l'API PFS de traduction accepte comme batch.
 *
 * On compare 3 stratégies avec 100 produits réels (200 textes : nom + description) :
 *   A) "Actuel"      : 2 appels par produit, lots de 5 en parallèle (= comportement existant)
 *   B) "Mégaclés"    : 1 SEUL appel avec phrases: { name_1, desc_1, ..., name_100, desc_100 }
 *   C) "Chunks 50"   : 4 appels de 50 phrases chacun (compromis)
 *
 * NB : on NE teste PAS l'idée du séparateur ("texte1 ||| texte2") parce que :
 *   - l'API accepte déjà un objet de phrases multiples nativement,
 *   - un séparateur peut apparaître dans une description et tout casser,
 *   - une IA peut reformater/fusionner les segments.
 *
 * Usage : npx tsx scripts/test-pfs-batch-translate.ts
 */

import { translatePhrases } from "@/lib/pfs-translate";

const SAMPLE_SIZE = 100;

type Phrase = { key: string; text: string };

// Échantillons réalistes : bijoux en acier inoxydable (segment Beli & Jolie).
const NAME_TEMPLATES = [
  "Collier maille gourmette en acier inoxydable doré",
  "Bracelet jonc fin tressé argenté",
  "Boucles d'oreilles créoles ovales dorées 30mm",
  "Bague chevalière géométrique inox plaqué or",
  "Pendentif cœur ajouré chaîne fine",
  "Bracelet pampilles étoile et lune doré",
  "Collier ras-de-cou perle d'eau douce",
  "Boucles d'oreilles pendantes goutte zircon",
  "Bague solitaire pierre noire onyx",
  "Bracelet manchette martelée argent vieilli",
];
const DESC_TEMPLATES = [
  "Élégant et intemporel, ce bijou en acier inoxydable hypoallergénique résiste à l'eau et au temps. Idéal pour un usage quotidien, il ne ternit pas et garde son éclat des années. Finitions soignées, fermoir solide.",
  "Pièce délicate au design moderne, parfaite pour superposer ou porter seule. Acier 316L de qualité chirurgicale, sans nickel. Convient aux peaux sensibles. Livré dans une pochette cadeau.",
  "Bijou tendance inspiré des podiums parisiens. Sa finition mate et son volume sculptural en font une pièce statement. Acier inoxydable plaqué or 18 carats, garantie anti-allergique.",
  "Délicat et raffiné, ce modèle s'adapte à toutes les tenues. La finition brossée capte joliment la lumière. Réglable, taille universelle. Coffret écrin offert pour vos cadeaux.",
];

function buildPhrases(n: number): Phrase[] {
  const phrases: Phrase[] = [];
  for (let i = 0; i < n; i++) {
    const name = NAME_TEMPLATES[i % NAME_TEMPLATES.length] + ` réf. ${1000 + i}`;
    const desc = DESC_TEMPLATES[i % DESC_TEMPLATES.length];
    phrases.push({ key: `n_${i}`, text: name });
    phrases.push({ key: `d_${i}`, text: desc });
  }
  return phrases;
}

function makePayload(phrases: Phrase[]): Record<string, string> {
  return Object.fromEntries(phrases.map((p) => [p.key, p.text]));
}

function payloadSizeKB(obj: unknown): string {
  return (Buffer.byteLength(JSON.stringify(obj), "utf8") / 1024).toFixed(1);
}

async function strategyA_OneByOne(phrases: Phrase[]) {
  // Simule le comportement actuel : 2 appels (n + d) par produit en parallèle
  // par lots de 5 produits. On le fait juste sur les 10 premiers produits pour
  // ne pas spammer PFS — puis on extrapole.
  const prodIds = Array.from(new Set(phrases.map((p) => p.key.slice(2))));
  const SUBSET = 10;
  const subsetIds = prodIds.slice(0, SUBSET);
  const PARALLEL = 5;

  const t0 = Date.now();
  for (let i = 0; i < subsetIds.length; i += PARALLEL) {
    const chunk = subsetIds.slice(i, i + PARALLEL);
    await Promise.all(
      chunk.flatMap((id) => {
        const n = phrases.find((p) => p.key === `n_${id}`)?.text;
        const d = phrases.find((p) => p.key === `d_${id}`)?.text;
        return [
          n ? translatePhrases({ value: n }, { maxRetries: 1 }) : Promise.resolve(null),
          d ? translatePhrases({ value: d }, { maxRetries: 1 }) : Promise.resolve(null),
        ];
      })
    );
  }
  const elapsed = Date.now() - t0;
  const extrapolated = Math.round((elapsed / SUBSET) * prodIds.length);
  console.log(
    `[A] Stratégie actuelle (1 produit = 2 appels, lots de 5)\n` +
      `    Mesuré sur ${SUBSET} produits : ${elapsed} ms\n` +
      `    Extrapolation pour ${prodIds.length} produits : ~${extrapolated} ms (~${(
        extrapolated / 1000
      ).toFixed(1)}s)\n`
  );
  return { ms: extrapolated, calls: prodIds.length * 2 };
}

async function strategyB_Mega(phrases: Phrase[]) {
  const payload = makePayload(phrases);
  console.log(
    `[B] Méga-batch — 1 SEUL appel avec ${phrases.length} phrases (${payloadSizeKB(
      payload
    )} KB envoyés)`
  );
  const t0 = Date.now();
  const res = await translatePhrases(payload, { maxRetries: 1 });
  const elapsed = Date.now() - t0;

  if (!res) {
    console.log(`    [B] ÉCHEC : l'API a refusé ou erreur (voir logs warn).\n`);
    return { ms: elapsed, calls: 1, ok: false, missingKeys: phrases.length };
  }

  const returnedKeys = Object.keys(res);
  const missingKeys = phrases.filter((p) => !res[p.key]).length;
  const emptyTranslations = phrases.filter((p) => res[p.key] && !res[p.key]?.en).length;

  console.log(
    `    [B] Réponse en ${elapsed} ms (${(elapsed / 1000).toFixed(1)}s)\n` +
      `        Clés renvoyées : ${returnedKeys.length} / ${phrases.length}\n` +
      `        Clés manquantes : ${missingKeys}\n` +
      `        Traductions EN vides : ${emptyTranslations}\n` +
      `        Taille réponse : ${payloadSizeKB(res)} KB\n`
  );

  // Échantillon qualité
  const sample = phrases.slice(0, 3);
  for (const p of sample) {
    const tr = res[p.key];
    console.log(
      `        ex: "${p.text.slice(0, 50)}..." → EN: "${(tr?.en ?? "—").slice(0, 50)}..."`
    );
  }
  console.log("");

  return { ms: elapsed, calls: 1, ok: true, missingKeys };
}

async function strategyC_Chunks(phrases: Phrase[], chunkSize: number) {
  console.log(`[C] Chunks de ${chunkSize} phrases`);
  const t0 = Date.now();
  let totalMissing = 0;
  let ok = true;
  for (let i = 0; i < phrases.length; i += chunkSize) {
    const chunk = phrases.slice(i, i + chunkSize);
    const res = await translatePhrases(makePayload(chunk), { maxRetries: 1 });
    if (!res) {
      ok = false;
      totalMissing += chunk.length;
      continue;
    }
    totalMissing += chunk.filter((p) => !res[p.key]?.en).length;
  }
  const elapsed = Date.now() - t0;
  const calls = Math.ceil(phrases.length / chunkSize);
  console.log(
    `    [C] ${calls} appels en ${elapsed} ms (${(elapsed / 1000).toFixed(1)}s) — ok=${ok}, missing=${totalMissing}\n`
  );
  return { ms: elapsed, calls, ok, missingKeys: totalMissing };
}

async function main() {
  console.log(`\n=== TEST PFS BATCH TRANSLATE — ${new Date().toISOString()} ===\n`);

  const phrases = buildPhrases(SAMPLE_SIZE);
  if (phrases.length === 0) {
    console.error("Aucun produit trouvé.");
    process.exit(1);
  }
  console.log(
    `Échantillon : ${phrases.length} phrases (issues de ~${phrases.length / 2} produits)\n` +
      `Payload total : ${payloadSizeKB(makePayload(phrases))} KB\n`
  );

  const a = await strategyA_OneByOne(phrases);
  const b = await strategyB_Mega(phrases);
  const c50 = await strategyC_Chunks(phrases, 50);
  const c25 = await strategyC_Chunks(phrases, 25);

  console.log("=== RÉSUMÉ ===");
  console.log(`A) Actuel    : ${a.calls} appels  • extrapolé ${(a.ms / 1000).toFixed(1)}s`);
  console.log(
    `B) Méga      : ${b.calls} appel${b.calls > 1 ? "s" : ""}  • ${(b.ms / 1000).toFixed(1)}s • ok=${b.ok} • missing=${b.missingKeys}`
  );
  console.log(
    `C) Chunks 50 : ${c50.calls} appels  • ${(c50.ms / 1000).toFixed(1)}s • ok=${c50.ok} • missing=${c50.missingKeys}`
  );
  console.log(
    `C) Chunks 25 : ${c25.calls} appels  • ${(c25.ms / 1000).toFixed(1)}s • ok=${c25.ok} • missing=${c25.missingKeys}`
  );

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
