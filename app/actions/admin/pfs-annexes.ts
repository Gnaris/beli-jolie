"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPfsAnnexes } from "@/lib/pfs-annexes";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export interface PfsMappingOptions {
  genders: { value: string; label: string }[];
  families: { gender: string; family: string }[];
  categories: { gender: string; family: string; category: string }[];
  compositions: { value: string; label: string }[];
  countries: { value: string; label: string }[];
  seasons: { value: string; label: string }[];
}

const GENDER_FR_TO_CODE: Record<string, string> = {
  Femme: "WOMAN",
  Homme: "MAN",
  Enfant: "KID",
  Lifestyle_et_Plus: "SUPPLIES",
};

export async function fetchPfsMappingOptions(): Promise<PfsMappingOptions> {
  await requireAdmin();
  const annexes = await getPfsAnnexes();

  return {
    genders: Object.entries(GENDER_FR_TO_CODE).map(([fr, code]) => ({
      value: code,
      label: fr.replace(/_/g, " "),
    })),
    families: annexes.families.map((f) => ({
      gender: GENDER_FR_TO_CODE[f.gender] ?? f.gender,
      family: f.family,
    })),
    categories: annexes.categories.map((c) => ({
      gender: GENDER_FR_TO_CODE[c.gender] ?? c.gender,
      family: c.family,
      category: c.category,
    })),
    compositions: annexes.compositions.map((c) => ({ value: c, label: c })),
    countries: annexes.countries.map((c) => ({ value: c, label: c })),
    seasons: annexes.seasons.map((s) => ({ value: s.reference, label: s.label })),
  };
}
