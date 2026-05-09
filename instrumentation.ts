/**
 * instrumentation.ts
 *
 * Hook de démarrage Next.js 16. Délègue à un module séparé `instrumentation-node.ts`
 * chargé dynamiquement uniquement en runtime Node — sinon Next.js émet des warnings
 * Edge sur `process.on` même protégé par un guard runtime (analyse statique).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
