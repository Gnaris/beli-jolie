import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getCachedProductCount, getCachedShopName, getCachedBusinessHours } from "@/lib/cached-data";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/business-hours";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import RegisterForm from "@/components/auth/RegisterForm";
import { getRegistrationRules } from "@/app/actions/admin/registration-rules";
import { DEFAULT_RULES } from "@/lib/registration-rules";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
  ]);
  return {
    title: tMeta("registerTitle"),
    description: tMeta("registerDescription", { shopName }),
  };
}

/**
 * Page d'inscription BtoB
 */
export default async function InscriptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [productCount, businessHours, registrationRules] = await Promise.all([
    getCachedProductCount(),
    getCachedBusinessHours(),
    getRegistrationRules().catch(() => DEFAULT_RULES),
  ]);
  const schedule: BusinessHoursSchedule = businessHours ?? DEFAULT_BUSINESS_HOURS;

  return (
    <RegisterForm
      productCount={productCount}
      schedule={schedule}
      registrationRules={registrationRules}
    />
  );
}
