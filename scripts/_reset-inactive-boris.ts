import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  const tenant = await p.tenant.findFirst({
    where: { slug: "beliandjolie" },
    select: { id: true },
  });
  if (!tenant) throw new Error("tenant not found");

  const user = await p.user.findFirst({
    where: { tenantId: tenant.id, email: "borischen91@gmail.com" },
    select: { id: true, lastSeenAt: true },
  });
  if (!user) throw new Error("user not found");

  // Force lastSeenAt à 1 h dans le passé pour simuler un vrai client inactif.
  // Attention : si un onglet client "boris" est ouvert quelque part, il va
  // ré-bumper lastSeenAt au prochain heartbeat (30 s max). Fermez-le d'abord.
  const oneHourAgo = new Date(Date.now() - 3600_000);
  await p.user.update({
    where: { id: user.id },
    data: { lastSeenAt: oneHourAgo },
  });
  console.log(`✓ lastSeenAt figé à ${oneHourAgo.toISOString()} (avant : ${user.lastSeenAt?.toISOString() ?? "null"})`);

  // Reset le job — repart proprement de zéro.
  await p.inactiveClientJob.deleteMany({ where: { userId: user.id } });
  console.log("✓ Job inactivité supprimé (repart de zéro)");

  // Remet des délais raisonnables : 1 / 2 / 3 minutes — assez courts pour
  // tester dans les 5 min, assez longs pour ne pas être court-circuités par
  // le heartbeat toutes les 30 s.
  const stages = await p.inactiveClientStage.findMany({
    where: { tenantId: tenant.id },
    orderBy: { stageIndex: "asc" },
  });
  const wanted = [60, 120, 180];
  for (let i = 0; i < stages.length && i < wanted.length; i++) {
    if (stages[i].delaySeconds !== wanted[i]) {
      await p.inactiveClientStage.update({
        where: { id: stages[i].id },
        data: { delaySeconds: wanted[i] },
      });
      console.log(
        `✓ Stade ${stages[i].stageIndex} : ${stages[i].delaySeconds}s → ${wanted[i]}s (${wanted[i] / 60} min)`,
      );
    }
  }

  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
