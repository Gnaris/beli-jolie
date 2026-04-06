import type { Metadata } from "next";
import { getCachedShopName, getCachedCompanyInfo, getCachedBusinessHours } from "@/lib/cached-data";
import { isWithinBusinessHours, getNextOpenSlot, formatScheduleForDisplay } from "@/lib/business-hours";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/business-hours";
import ContactPageClient from "./ContactPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Nous contacter — ${shopName}`,
    description: `Contactez ${shopName} par téléphone, WhatsApp ou messagerie.`,
  };
}

export default async function NousContacterPage() {
  const [companyInfo, businessHoursRaw, shopName] = await Promise.all([
    getCachedCompanyInfo(),
    getCachedBusinessHours(),
    getCachedShopName(),
  ]);

  const schedule: BusinessHoursSchedule = businessHoursRaw ?? DEFAULT_BUSINESS_HOURS;
  const isOpen = isWithinBusinessHours(schedule);
  const nextSlot = !isOpen ? getNextOpenSlot(schedule) : null;
  const displaySchedule = formatScheduleForDisplay(schedule);

  return (
    <ContactPageClient
      shopName={shopName}
      phone={companyInfo?.phone ?? null}
      whatsapp={companyInfo?.whatsapp ?? null}
      email={companyInfo?.email ?? null}
      address={companyInfo?.address ?? null}
      city={companyInfo?.city ?? null}
      postalCode={companyInfo?.postalCode ?? null}
      isOpen={isOpen}
      nextSlot={nextSlot}
      schedule={displaySchedule}
    />
  );
}
