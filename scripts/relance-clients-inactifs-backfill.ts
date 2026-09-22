/**
 * scripts/relance-clients-inactifs-backfill.ts
 *
 * Backfill des lignes EmailSend manquantes suite au bug ALS du 21/09/2026 :
 * lors de l'envoi via scripts/relance-clients-inactifs.ts --send, sendMail()
 * n'a pas réussi à résoudre le tenantId hors requête HTTP, et n'a donc pas
 * écrit les EmailSend correspondantes. Les mails sont bien partis et les
 * notes admin ont bien été mises à jour, seul le journal admin est vide.
 *
 * Ce script relit /tmp/relance-clients-inactifs.log, extrait les lignes
 * "✅ email  [variant]", retrouve le User par email et insère l'EmailSend
 * qui manquait — idempotent : skip si déjà présent.
 *
 * Usage : npx tsx scripts/relance-clients-inactifs-backfill.ts
 */

import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { EMAIL_SCENARIOS } from "@/lib/email-scenarios";
import { buildEmailForClient } from "./relance-clients-inactifs-lib";

const LOG_FILE = "/tmp/relance-clients-inactifs.log";
const TENANT_SLUG = "beliandjolie";

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    console.error(`Tenant "${TENANT_SLUG}" introuvable.`);
    process.exit(1);
  }

  await tenantALS.run(tenant.id, async () => {
    const log = fs.readFileSync(LOG_FILE, "utf8");
    const entries: { email: string; variant: string }[] = [];
    for (const rawLine of log.split("\n")) {
      const m = rawLine.match(/^✅ (\S+)\s+\[([\d-]+)\]/);
      if (m) entries.push({ email: m[1].toLowerCase(), variant: m[2] });
    }
    console.log(`Envois trouvés dans le log : ${entries.length}`);

    if (entries.length === 0) {
      console.log("Rien à faire.");
      return;
    }

    const users = await prisma.user.findMany({
      where: { tenantId: tenant.id, email: { in: entries.map((e) => e.email) } },
      select: { id: true, email: true, company: true },
    });
    const usersByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

    let created = 0;
    let alreadyLogged = 0;
    let userMissing = 0;
    for (const e of entries) {
      const u = usersByEmail.get(e.email);
      if (!u) {
        console.warn(`  ⚠️  User introuvable pour ${e.email}`);
        userMissing++;
        continue;
      }
      const existing = await prisma.emailSend.findFirst({
        where: {
          tenantId: tenant.id,
          userId: u.id,
          scenarioKey: EMAIL_SCENARIOS.INACTIVE_CLIENT.key,
          status: "SENT",
        },
        select: { id: true },
      });
      if (existing) {
        alreadyLogged++;
        continue;
      }
      const [intro, order, closer, subj] = e.variant.split("-").map(Number);
      const built = buildEmailForClient({
        company: u.company,
        introIdx: intro,
        orderIdx: order,
        closerIdx: closer,
        subjectIdx: subj,
      });
      await prisma.emailSend.create({
        data: {
          tenantId: tenant.id,
          userId: u.id,
          recipientEmail: u.email.slice(0, 320),
          fromEmail: "contact@beliandjolie.com",
          fromName: "L'équipe Beli & Jolie",
          scenarioKey: EMAIL_SCENARIOS.INACTIVE_CLIENT.key,
          subject: built.subject.slice(0, 500),
          htmlBody: null,
          status: "SENT",
          metadata: {
            source: "scripts/relance-clients-inactifs.ts",
            variant: e.variant,
            backfill: true,
            backfillReason: "ALS bug 21/09/2026 : tenantId non résolu hors HTTP",
          },
        },
      });
      created++;
    }
    console.log("");
    console.log(`Backfill terminé.`);
    console.log(`  Insérés         : ${created}`);
    console.log(`  Déjà présents   : ${alreadyLogged}`);
    console.log(`  User introuvable: ${userMissing}`);
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
