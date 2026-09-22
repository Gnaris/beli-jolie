/**
 * scripts/relance-clients-inactifs.ts
 *
 * Envoie un mail de suivi personnalisé aux clients APPROVED du tenant
 * `beliandjolie` qui n'ont jamais passé de commande.
 *
 * Modes :
 *   npx tsx scripts/relance-clients-inactifs.ts             # DRY-RUN (défaut)
 *     → écrit /var/www/beliandjolie/relances/relance-clients-inactifs-YYYY-MM-DD.xlsx
 *     → 0 mail envoyé, 0 modification BDD
 *
 *   npx tsx scripts/relance-clients-inactifs.ts --send      # ENVOI RÉEL
 *     → envoie chaque mail via sendMail (scenarioKey=INACTIVE_CLIENT)
 *     → append User.adminNote (préserve l'existant, tronque si >2000 chars)
 *     → délai ~3 s entre chaque envoi
 *     → demande "OUI" au STDIN avant le premier envoi
 *
 * Options :
 *   --limit N          → limite le lot à N clients (test)
 *   --only-email X     → cible uniquement ce mail (test)
 *
 * Idempotence : les clients ayant déjà reçu un mail INACTIVE_CLIENT SENT sont
 * automatiquement exclus. Le script peut être relancé sans re-mailer.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { tenantALS } from "@/lib/tenant-als";
import { EMAIL_SCENARIOS } from "@/lib/email-scenarios";
import {
  INTROS,
  QUESTION_ORDERS,
  CLOSERS,
  SUBJECTS,
  buildEmailForClient,
  appendAdminNote,
} from "./relance-clients-inactifs-lib";

const TENANT_SLUG = "beliandjolie";
const SEND_DELAY_MS = 3000;
const OUTPUT_DIR_LINUX = "/var/www/beliandjolie/relances";
const OUTPUT_DIR_WIN = path.join(process.cwd(), "relances");

interface CliArgs {
  send: boolean;
  yes: boolean;
  limit: number | null;
  onlyEmail: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { send: false, yes: false, limit: null, onlyEmail: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send") args.send = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--limit") {
      const n = parseInt(argv[++i] ?? "", 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (a === "--only-email") {
      const v = (argv[++i] ?? "").trim().toLowerCase();
      if (v) args.onlyEmail = v;
    }
  }
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function confirmOnStdin(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(question)).trim().toUpperCase();
  rl.close();
  return ans === "OUI";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const tenant = await prisma.tenant.findFirst({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    console.error(`Tenant "${TENANT_SLUG}" introuvable.`);
    process.exit(1);
  }

  await tenantALS.run(tenant.id, async () => {
    console.log(`Tenant : ${tenant.name} (${tenant.slug})`);
    console.log(`Mode   : ${args.send ? "ENVOI RÉEL" : "DRY-RUN (aucun mail envoyé)"}`);
    if (args.limit) console.log(`Limite : ${args.limit} client(s)`);
    if (args.onlyEmail) console.log(`Seul email : ${args.onlyEmail}`);
    console.log("");

    // 1) Sélectionner les clients APPROVED sans aucune commande.
    const baseWhere = {
      tenantId: tenant.id,
      role: "CLIENT" as const,
      status: "APPROVED" as const,
      orders: { none: {} },
    };
    const emailFilter = args.onlyEmail
      ? { email: { equals: args.onlyEmail } }
      : {};

    const clientsAll = await prisma.user.findMany({
      where: { ...baseWhere, ...emailFilter },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
        adminNote: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // 2) Exclure ceux ayant déjà reçu un mail INACTIVE_CLIENT SENT.
    const alreadyMailed = await prisma.emailSend.findMany({
      where: {
        tenantId: tenant.id,
        scenarioKey: EMAIL_SCENARIOS.INACTIVE_CLIENT.key,
        status: "SENT",
        userId: { in: clientsAll.map((c) => c.id) },
      },
      select: { userId: true },
    });
    const alreadyMailedIds = new Set(
      alreadyMailed.map((r) => r.userId).filter(Boolean) as string[],
    );

    let recipients = clientsAll.filter((c) => !alreadyMailedIds.has(c.id));
    if (args.limit) recipients = recipients.slice(0, args.limit);

    console.log(`Clients APPROVED sans commande     : ${clientsAll.length}`);
    console.log(`Déjà relancés (exclus)             : ${alreadyMailedIds.size}`);
    console.log(`À traiter dans ce lot              : ${recipients.length}`);
    console.log("");

    if (recipients.length === 0) {
      console.log("Aucun destinataire — rien à faire.");
      return;
    }

    // 3) Générer un mail par client (variante déterministe par userId).
    const generated = recipients.map((c) => {
      const seedBytes = crypto.createHash("sha256").update(c.id).digest();
      const introIdx = seedBytes[0] % INTROS.length;
      const orderIdx = seedBytes[1] % QUESTION_ORDERS.length;
      const closerIdx = seedBytes[2] % CLOSERS.length;
      const subjectIdx = seedBytes[3] % SUBJECTS.length;
      const built = buildEmailForClient({
        company: c.company,
        firstName: c.firstName,
        introIdx,
        orderIdx,
        closerIdx,
        subjectIdx,
      });
      return {
        user: c,
        subject: built.subject,
        text: built.text,
        html: built.html,
        variantTag: `${introIdx}-${orderIdx}-${closerIdx}-${subjectIdx}`,
      };
    });

    // 4) DRY-RUN → Excel.
    if (!args.send) {
      const outputDir = process.platform === "linux" ? OUTPUT_DIR_LINUX : OUTPUT_DIR_WIN;
      await fs.mkdir(outputDir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const filePath = path.join(outputDir, `relance-clients-inactifs-${today}.xlsx`);

      const wb = new ExcelJS.Workbook();
      wb.creator = "Beli & Jolie — script relance";
      wb.created = new Date();

      // Feuille 1 : Résumé
      const wsSummary = wb.addWorksheet("Résumé");
      wsSummary.columns = [
        { header: "Indicateur", key: "k", width: 40 },
        { header: "Valeur", key: "v", width: 20 },
      ];
      wsSummary.addRow({ k: "Date de génération", v: new Date().toLocaleString("fr-FR") });
      wsSummary.addRow({ k: "Tenant", v: `${tenant.name} (${tenant.slug})` });
      wsSummary.addRow({ k: "Clients APPROVED sans commande", v: clientsAll.length });
      wsSummary.addRow({ k: "Déjà relancés (exclus)", v: alreadyMailedIds.size });
      wsSummary.addRow({ k: "Mails à envoyer dans ce lot", v: recipients.length });
      wsSummary.getRow(1).font = { bold: true };

      // Feuille 2 : Destinataires
      const wsRcpt = wb.addWorksheet("Destinataires");
      wsRcpt.columns = [
        { header: "N°", key: "num", width: 5 },
        { header: "Email", key: "email", width: 35 },
        { header: "Société", key: "company", width: 32 },
        { header: "Contact", key: "contact", width: 26 },
        { header: "Inscrit le", key: "createdAt", width: 12 },
        { header: "Variante", key: "variant", width: 10 },
        { header: "Objet du mail", key: "subject", width: 48 },
        { header: "Corps du mail (texte)", key: "text", width: 90 },
        { header: "Note client actuelle", key: "adminNote", width: 40 },
      ];
      wsRcpt.getRow(1).font = { bold: true };
      generated.forEach((g, i) => {
        wsRcpt.addRow({
          num: i + 1,
          email: g.user.email,
          company: g.user.company,
          contact: `${g.user.firstName} ${g.user.lastName}`.trim(),
          createdAt: g.user.createdAt.toLocaleDateString("fr-FR"),
          variant: g.variantTag,
          subject: g.subject,
          text: g.text,
          adminNote: g.user.adminNote ?? "",
        });
      });
      // Wrap text sur les grosses colonnes.
      wsRcpt.getColumn("text").alignment = { wrapText: true, vertical: "top" };
      wsRcpt.getColumn("adminNote").alignment = { wrapText: true, vertical: "top" };
      wsRcpt.getColumn("subject").alignment = { wrapText: true, vertical: "top" };

      await wb.xlsx.writeFile(filePath);
      console.log(`Fichier Excel écrit : ${filePath}`);
      console.log("Ouvre-le pour valider le contenu. Aucun mail envoyé.");
      return;
    }

    // 5) ENVOI RÉEL — confirmation STDIN (sauf --yes) puis boucle.
    if (!args.yes) {
      const ok = await confirmOnStdin(
        `\n⚠️  Envoi réel à ${recipients.length} client(s). Taper OUI pour lancer : `,
      );
      if (!ok) {
        console.log("Annulé.");
        return;
      }
    } else {
      console.log(`\n[--yes] Confirmation skippée, envoi à ${recipients.length} client(s).`);
    }

    let sent = 0;
    let failed = 0;
    for (const g of generated) {
      const res = await sendMail({
        to: g.user.email,
        subject: g.subject,
        html: g.html,
        fromName: "L'équipe Beli & Jolie",
        tracking: {
          scenarioKey: EMAIL_SCENARIOS.INACTIVE_CLIENT.key,
          userId: g.user.id,
          metadata: {
            source: "scripts/relance-clients-inactifs.ts",
            variant: g.variantTag,
          },
        },
      });
      if (res.sent) {
        sent++;
        // Append à la note admin (préserve l'existant).
        const newNote = appendAdminNote(
          g.user.adminNote,
          new Date(),
          "mail de suivi envoyé (relance client inactif)",
        );
        try {
          await prisma.user.update({
            where: { id: g.user.id },
            data: { adminNote: newNote },
          });
        } catch (err) {
          console.error(`  ⚠️  Note non mise à jour pour ${g.user.email} :`, err);
        }
        console.log(`✅ ${g.user.email}  [${g.variantTag}]`);
      } else {
        failed++;
        console.error(`❌ ${g.user.email} — ${res.reason}${"error" in res && res.error ? " : " + res.error : ""}`);
      }
      // Délai anti-spam entre chaque envoi (sauf après le dernier).
      if (g !== generated[generated.length - 1]) {
        await sleep(SEND_DELAY_MS);
      }
    }

    console.log("");
    console.log(`Terminé. Envoyés : ${sent} · Échecs : ${failed}`);
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
