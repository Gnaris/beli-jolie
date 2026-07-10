"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfSensitive } from "@/lib/encryption";
import { validateSmtpConfig } from "@/lib/email";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export type SmtpConfigInput = {
  host?: string;
  port?: string;
  secure?: string;
  user?: string;
  password?: string;
  fromEmail?: string;
  fromName?: string;
};

const KEYS: Array<[keyof SmtpConfigInput, string]> = [
  ["host", "smtp_host"],
  ["port", "smtp_port"],
  ["secure", "smtp_secure"],
  ["user", "smtp_user"],
  ["password", "smtp_password"],
  ["fromEmail", "smtp_from_email"],
  ["fromName", "smtp_from_name"],
];

/**
 * Persiste la config SMTP dans SiteConfig. Le mot de passe (`smtp_password`)
 * est chiffré via `encryptIfSensitive` — les autres champs restent en clair.
 * Une chaîne vide supprime la ligne (retour au fallback env).
 */
export async function updateSmtpConfig(
  input: SmtpConfigInput,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    for (const [prop, dbKey] of KEYS) {
      const raw = input[prop];
      if (raw === undefined) continue;
      const value = raw.trim();
      if (!value) {
        await prisma.siteConfig.deleteMany({ where: { key: dbKey } });
        continue;
      }
      const stored = encryptIfSensitive(dbKey, value);
      await prisma.siteConfig.upsert({
        where: { key: dbKey },
        update: { value: stored },
        create: { key: dbKey, value: stored },
      });
    }

    revalidateTag("site-config", "default");
    revalidatePath("/admin/bienvenue/email");
    revalidatePath("/admin/parametres");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Teste une config SMTP proposée (sans la sauvegarder). Optionnellement
 * envoie un email de test à `testTo`.
 */
export async function testSmtpConfig(input: {
  host: string;
  port: string;
  secure?: boolean;
  user: string;
  password: string;
  fromEmail?: string;
  fromName?: string;
  testTo?: string;
}): Promise<{ valid: boolean; error?: string; testMessageId?: string }> {
  try {
    await requireAdmin();
    return await validateSmtpConfig({
      host: input.host,
      port: input.port,
      secure: input.secure ?? input.port === "465",
      user: input.user,
      password: input.password,
      fromEmail: input.fromEmail || input.user,
      fromName: input.fromName,
      testTo: input.testTo,
    });
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
