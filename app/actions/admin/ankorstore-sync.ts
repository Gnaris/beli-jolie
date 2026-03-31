"use server";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { encryptIfSensitive } from "@/lib/encryption";

export async function saveAnkorstoreMapping(data: {
  akValue: string;
  akName: string;
  bjEntityId: string;
  bjName: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.ankorstoreMapping.upsert({
      where: { type_akValue: { type: "productType", akValue: data.akValue } },
      create: {
        type: "productType",
        akValue: data.akValue,
        akName: data.akName,
        bjEntityId: data.bjEntityId,
        bjName: data.bjName,
      },
      update: {
        bjEntityId: data.bjEntityId,
        bjName: data.bjName,
      },
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur interne" };
  }
}

export async function deleteAnkorstoreMapping(
  akValue: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.ankorstoreMapping.delete({
      where: { type_akValue: { type: "productType", akValue } },
    });
    return { success: true };
  } catch {
    return { success: false, error: "Mapping introuvable" };
  }
}

export async function validateAnkorstoreCredentials(data: {
  clientId: string;
  clientSecret: string;
}): Promise<{ valid: boolean; error?: string }> {
  await requireAdmin();

  try {
    const res = await fetch("https://www.ankorstore.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: data.clientId,
        client_secret: data.clientSecret,
        scope: "*",
      }),
    });

    if (res.ok) {
      return { valid: true };
    }

    const text = await res.text().catch(() => "");
    return { valid: false, error: `Erreur ${res.status}: ${text}` };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Erreur réseau" };
  }
}

export async function updateAnkorstoreCredentials(data: {
  clientId: string;
  clientSecret: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.$transaction([
      prisma.siteConfig.upsert({
        where: { key: "ankorstore_client_id" },
        create: { key: "ankorstore_client_id", value: data.clientId },
        update: { value: data.clientId },
      }),
      prisma.siteConfig.upsert({
        where: { key: "ankorstore_client_secret" },
        create: {
          key: "ankorstore_client_secret",
          value: encryptIfSensitive("ankorstore_client_secret", data.clientSecret),
        },
        update: {
          value: encryptIfSensitive("ankorstore_client_secret", data.clientSecret),
        },
      }),
    ]);

    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur interne" };
  }
}

export async function toggleAnkorstoreEnabled(
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.siteConfig.upsert({
      where: { key: "ankorstore_enabled" },
      create: { key: "ankorstore_enabled", value: enabled ? "true" : "false" },
      update: { value: enabled ? "true" : "false" },
    });

    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur interne" };
  }
}
