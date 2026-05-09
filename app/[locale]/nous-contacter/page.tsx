import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCachedShopName, getCachedCompanyInfo, getCachedBusinessHours } from "@/lib/cached-data";
import { isWithinBusinessHours, getNextOpenSlot, formatScheduleForDisplay } from "@/lib/business-hours";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/business-hours";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import ContactPageClient from "./ContactPageClient";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
  ]);
  return {
    title: tMeta("contactTitle", { shopName }),
    description: tMeta("contactDescription", { shopName }),
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
    <>
      <PublicSidebar shopName={shopName} />
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
      <Footer shopName={shopName} />
    </>
  );
}
