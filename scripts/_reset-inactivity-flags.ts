/**
 * Reset propre des flags d'inactivité d'un user pour pouvoir re-tester.
 * Usage: NODE_OPTIONS="--conditions=react-server" npx tsx scripts/_reset-inactivity-flags.ts <email>
 */
import { prisma } from "@/lib/prisma";

const email = process.argv[2]?.toLowerCase().trim();
if (!email) {
  console.error("Usage: tsx scripts/_reset-inactivity-flags.ts <email>");
  process.exit(1);
}

(async () => {
  const user = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true, status: true },
  });
  if (!user) {
    console.error("Introuvable");
    process.exit(1);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: "APPROVED",
      inactivityWarningAt: null,
      deactivatedForInactivityAt: null,
      probationUntil: null,
      inactiveClientOptOut: false,
    },
  });
  console.log(`✓ Reset de ${user.email} — flags cleared, status APPROVED`);
  await prisma.$disconnect();
})();
