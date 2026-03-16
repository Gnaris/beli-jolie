"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { VALID_LOCALES, type Locale } from "@/i18n/request";

export async function setLocale(locale: Locale) {
  if (!VALID_LOCALES.includes(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set("bj_locale", locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });

  revalidatePath("/", "layout");
}
