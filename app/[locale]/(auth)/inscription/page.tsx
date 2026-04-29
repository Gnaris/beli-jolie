import type { Metadata } from "next";
import { getCachedProductCount, getCachedShopName, getCachedBusinessHours } from "@/lib/cached-data";
import { DEFAULT_BUSINESS_HOURS, getTodayHoursLabel } from "@/lib/business-hours";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import RegisterForm from "@/components/auth/RegisterForm";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: "Inscription — Demande d'accès Pro",
    description:
      `Créez votre compte professionnel ${shopName} pour accéder à nos tarifs grossiste.`,
  };
}

/**
 * Page d'inscription BtoB
 */
export default async function InscriptionPage() {
  const [productCount, businessHours] = await Promise.all([
    getCachedProductCount(),
    getCachedBusinessHours(),
  ]);
  const schedule: BusinessHoursSchedule = businessHours ?? DEFAULT_BUSINESS_HOURS;
  const todayHoursLabel = getTodayHoursLabel(schedule);

  return <RegisterForm productCount={productCount} todayHoursLabel={todayHoursLabel} schedule={schedule} />;
}
