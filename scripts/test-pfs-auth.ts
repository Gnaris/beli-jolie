/**
 * Diagnostic script — vérifie que l'authentification PFS fonctionne en prod.
 * Utilisation : npx tsx scripts/test-pfs-auth.ts
 */
import { getPfsToken } from "@/lib/pfs-auth";
import { getCachedPfsCredentials } from "@/lib/cached-data";

async function main() {
  console.log("=== Lecture des identifiants PFS ===");
  const creds = await getCachedPfsCredentials();
  console.log("email présent :", !!creds.email, creds.email ? `(${creds.email.length} chars)` : "");
  console.log("password présent :", !!creds.password, creds.password ? `(${creds.password.length} chars)` : "");

  console.log("\n=== Tentative de récupération du token PFS ===");
  try {
    const token = await getPfsToken();
    console.log("✅ Token obtenu :", token.substring(0, 20) + "...");
    console.log("Longueur :", token.length);
  } catch (err) {
    console.error("❌ Échec :", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Erreur inattendue :", e);
  process.exit(1);
});
