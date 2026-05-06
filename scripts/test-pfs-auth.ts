/**
 * Diagnostic script — vérifie que l'authentification PFS fonctionne en prod.
 * Lit directement les identifiants depuis la BDD (sans Next.js cache),
 * les déchiffre, et tente une authentification PFS.
 *
 * Utilisation : npx tsx scripts/test-pfs-auth.ts
 */
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const PFS_BASE_URL = "https://wholesaler-api.parisfashionshops.com/api/v1";

async function main() {
  console.log("=== 1. Lecture des identifiants PFS (BDD directe) ===");
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["pfs_email", "pfs_password"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  const email = map.get("pfs_email");
  const password = map.get("pfs_password");
  console.log("email :", email ? `${email.substring(0, 4)}***@***` : "(absent)");
  console.log("password présent :", !!password, password ? `(${password.length} chars)` : "");

  if (!email || !password) {
    console.error("❌ Identifiants manquants dans la BDD.");
    process.exit(1);
  }

  console.log("\n=== 2. Appel direct PFS oauth/token ===");
  const res = await fetch(`${PFS_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  console.log("HTTP status :", res.status);
  const text = await res.text();
  if (!res.ok) {
    console.error("❌ Auth PFS échouée :", text.substring(0, 500));
    process.exit(1);
  }

  try {
    const data = JSON.parse(text);
    console.log("✅ Réponse OK");
    console.log("access_token :", data.access_token ? `${data.access_token.substring(0, 20)}...` : "(absent)");
    console.log("expires_at :", data.expires_at);
  } catch {
    console.error("Réponse non-JSON :", text.substring(0, 500));
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("Erreur inattendue :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
