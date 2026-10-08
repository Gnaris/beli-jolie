"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { GTM_CONTAINER_ID_KEY, gtmContainerIdSchema } from "@/lib/analytics";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export async function updateGtmContainerId(
  rawId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const parsed = gtmContainerIdSchema.safeParse(rawId ?? "");
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "ID invalide" };
    }
    const value = parsed.data;
    if (value === "") {
      await unsetSiteConfig(GTM_CONTAINER_ID_KEY);
    } else {
      await setSiteConfig(GTM_CONTAINER_ID_KEY, value);
    }
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
