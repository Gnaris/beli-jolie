/**
 * Vide toutes les conversations SUPPORT (chat en ligne du widget) :
 *   - supprime les Conversation (cascade Prisma → Message + MessageAttachment)
 *   - supprime les fichiers physiques `uploads/{tenant}/temp/chat/*`
 *
 * Ne touche PAS aux conversations CLAIM (Service Client).
 *
 * Lancer : `npx tsx scripts/wipe-chat-support.ts`
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

async function main() {
  const total = await prisma.conversation.count({ where: { type: "SUPPORT" } });
  const totalMsg = await prisma.message.count({
    where: { conversation: { type: "SUPPORT" } },
  });
  const totalAtt = await prisma.messageAttachment.count({
    where: { message: { conversation: { type: "SUPPORT" } } },
  });

  console.log(`[wipe-chat-support] Avant : ${total} conversation(s), ${totalMsg} message(s), ${totalAtt} pièce(s) jointe(s).`);

  if (total === 0) {
    console.log("[wipe-chat-support] Rien à supprimer.");
    return;
  }

  const deleted = await prisma.conversation.deleteMany({ where: { type: "SUPPORT" } });
  console.log(`[wipe-chat-support] Supprimé : ${deleted.count} conversation(s). Les messages + pièces jointes partent en cascade.`);

  // Nettoyage des fichiers physiques — on vide le contenu de uploads/*/temp/chat
  // pour tous les tenants (le dir lui-même reste pour que les prochains uploads
  // ne plantent pas sur mkdir race).
  const tenants = await prisma.tenant.findMany({ select: { slug: true } });
  const publicRoot = path.resolve(process.cwd(), "public");
  let filesRemoved = 0;
  for (const t of tenants) {
    const dir = path.join(publicRoot, "uploads", t.slug, "temp", "chat");
    try {
      const entries = await fs.readdir(dir);
      for (const name of entries) {
        await fs.rm(path.join(dir, name), { recursive: true, force: true });
        filesRemoved++;
      }
      console.log(`[wipe-chat-support] Dossier ${dir} vidé (${entries.length} entrée(s)).`);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        console.warn(`[wipe-chat-support] Impossible de vider ${dir} :`, e.message);
      }
    }
  }
  console.log(`[wipe-chat-support] Terminé. ${filesRemoved} fichier(s)/dossier(s) sur disque supprimé(s).`);
}

main()
  .catch((err) => {
    console.error("[wipe-chat-support] Erreur :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
