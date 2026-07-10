"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import path from "path";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfSensitive } from "@/lib/encryption";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);
const VPS_IP = "72.61.106.128";
const MAIL_HOSTNAME = "mail.beliandjolie.com";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

/**
 * Extrait le domaine du site à partir de NEXTAUTH_URL.
 * Ex: https://chez-sophie.fr → "chez-sophie.fr"
 *     https://www.chez-sophie.fr → "chez-sophie.fr"
 */
function extractShopDomain(): string | null {
  const url = process.env.NEXTAUTH_URL?.trim();
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    // Retire www. si présent
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Génère le récap DNS complet à afficher à la cliente. Contient les 2 records
 * de « site web » (A + CNAME) qui font pointer le domaine vers le VPS, plus
 * les 4 records « mail » (MX + SPF + DKIM + DMARC) posés par le serveur mail.
 * La clé DKIM est lue depuis /etc/opendkim/keys/{domain}/default.txt.
 */
async function buildDnsRecap(domain: string, forwardTo: string): Promise<string> {
  let dkimValue = "(clé DKIM générée — indisponible à la lecture)";
  try {
    const dkimFile = `/etc/opendkim/keys/${domain}/default.txt`;
    const raw = await readFile(dkimFile, "utf8");
    const chunks = raw.match(/"([^"]*)"/g);
    if (chunks && chunks.length > 0) {
      dkimValue = chunks.map((c) => c.slice(1, -1)).join("").replace(/\s+/g, " ").trim();
    }
  } catch {
    // fichier absent ou droits insuffisants : on affiche un texte de secours.
  }

  return [
    "Records à ajouter chez le registrar de " + domain + " :",
    "",
    "─── SITE WEB (visiteurs) ───",
    "1) Type: A       Nom: @        Valeur: " + VPS_IP,
    "2) Type: CNAME   Nom: www      Valeur: " + domain,
    "",
    "─── EMAIL (contact@" + domain + ") ───",
    "3) Type: MX      Nom: @        Priorité: 10   Valeur: " + MAIL_HOSTNAME,
    "4) Type: TXT     Nom: @        Valeur: \"v=spf1 ip4:" + VPS_IP + " ~all\"",
    "5) Type: TXT     Nom: default._domainkey",
    "   Valeur: \"" + dkimValue + "\"",
    "6) Type: TXT     Nom: _dmarc   Valeur: \"v=DMARC1; p=none; rua=mailto:" + forwardTo + "\"",
    "",
    "Comptez 1 à 24 h après avoir ajouté ces lignes pour que tout soit actif.",
  ].join("\n");
}

export type MailboxProvisionResult = {
  success: boolean;
  error?: string;
  email?: string;
  domain?: string;
  /** Bloc DNS à ajouter chez le registrar du domaine cliente. */
  dnsRecap?: string;
};

/**
 * Provisionne une boîte mail `contact@{domaine}` sur le serveur mail du VPS
 * et pose un forward automatique vers l'email principal fourni.
 *
 * Nécessite :
 * - Environnement Linux (VPS) avec le script add-mail-domain.sh en place
 * - App tournant en root (pm2 default)
 * - NEXTAUTH_URL correctement configuré
 *
 * Persiste automatiquement la config SMTP en BDD chiffrée (host, port,
 * user, password, from_email).
 */
export async function provisionShopMailbox(
  forwardTo: string,
): Promise<MailboxProvisionResult> {
  try {
    await requireAdmin();

    const forward = forwardTo?.trim();
    if (!forward || !EMAIL_REGEX.test(forward)) {
      return { success: false, error: "Adresse email principale invalide." };
    }

    const domain = extractShopDomain();
    if (!domain || !DOMAIN_REGEX.test(domain)) {
      return {
        success: false,
        error:
          "Impossible de déterminer le domaine de la boutique (NEXTAUTH_URL manquant ou invalide).",
      };
    }

    // Environnement OK ?
    if (process.platform !== "linux") {
      return {
        success: false,
        error:
          "Cette fonctionnalité n'est disponible qu'en production (serveur mail requis).",
      };
    }

    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "deploy",
      "add-mail-domain.sh",
    );

    const email = `contact@${domain}`;
    let stdout = "";
    try {
      const result = await execFileAsync(
        "/bin/bash",
        [scriptPath, domain, "contact", forward],
        { timeout: 90_000, maxBuffer: 1024 * 1024 },
      );
      stdout = result.stdout + "\n" + result.stderr;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const combined =
        (e.stdout ?? "") + "\n" + (e.stderr ?? "") + "\n" + (e.message ?? "");
      logger.error("[Mailbox] Échec add-mail-domain.sh", {
        domain,
        forward,
        output: combined.slice(0, 2000),
      });
      // Cas fréquent : compte déjà existant → renvoyer message clair.
      if (/deja dans le registre|existe deja/i.test(combined)) {
        return {
          success: false,
          error: `La boîte ${email} existe déjà. Contactez le support pour la reconfigurer.`,
        };
      }
      return {
        success: false,
        error: "Le script de création de boîte mail a échoué. Réessayez ou contactez le support.",
      };
    }

    // Extraire le mot de passe généré (format : "Mot de passe : XYZ")
    const pwdMatch = stdout.match(/Mot de passe\s*:\s*(\S+)/);
    const password = pwdMatch?.[1];
    if (!password) {
      logger.error("[Mailbox] Impossible d'extraire le mot de passe", {
        domain,
        outputTail: stdout.slice(-800),
      });
      return {
        success: false,
        error: "Boîte créée mais impossible de récupérer le mot de passe. Contactez le support.",
      };
    }

    // Persister la config SMTP dans SiteConfig (chiffrée pour le password).
    const smtpHost = "mail.beliandjolie.com";
    const smtpEntries: Array<[string, string]> = [
      ["smtp_host", smtpHost],
      ["smtp_port", "587"],
      ["smtp_secure", "false"],
      ["smtp_user", email],
      ["smtp_password", password],
      ["smtp_from_email", email],
    ];
    for (const [key, value] of smtpEntries) {
      const stored = encryptIfSensitive(key, value);
      await prisma.siteConfig.upsert({
        where: { key },
        update: { value: stored },
        create: { key, value: stored },
      });
    }

    revalidateTag("site-config", "default");
    revalidatePath("/admin/bienvenue/email");
    revalidatePath("/admin/parametres");

    // Générer un récap DNS complet (6 lignes) que la cliente devra copier
    // dans la page DNS de son domaine chez son registrar. On y met à la
    // fois les records "site" (A + CNAME www) pour que le domaine dirige
    // vers le VPS, et les records "mail" (MX + SPF + DKIM + DMARC).
    const dnsRecap = await buildDnsRecap(domain, forward);

    return { success: true, email, domain, dnsRecap };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
