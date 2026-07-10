import {
  getCompanyInfo,
  type CompanyInfoData,
} from "@/app/actions/admin/company-info";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import CompanyStepForm from "@/components/admin/onboarding/CompanyStepForm";

export const dynamic = "force-dynamic";

export default async function CompanyStepPage() {
  const raw = await getCompanyInfo();
  const company: CompanyInfoData | null = raw
    ? {
        shopName: raw.shopName ?? undefined,
        name: raw.name,
        legalForm: raw.legalForm ?? undefined,
        capital: raw.capital ?? undefined,
        siret: raw.siret ?? undefined,
        rcs: raw.rcs ?? undefined,
        tvaNumber: raw.tvaNumber ?? undefined,
        address: raw.address ?? undefined,
        city: raw.city ?? undefined,
        postalCode: raw.postalCode ?? undefined,
        country: raw.country ?? undefined,
        phone: raw.phone ?? undefined,
        whatsapp: raw.whatsapp ?? undefined,
        email: raw.email ?? undefined,
        website: raw.website ?? undefined,
        director: raw.director ?? undefined,
        hostName: raw.hostName ?? undefined,
        hostAddress: raw.hostAddress ?? undefined,
        hostPhone: raw.hostPhone ?? undefined,
        hostEmail: raw.hostEmail ?? undefined,
      }
    : null;
  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <WizardStepHeader
        emoji="🏢"
        eyebrow="Étape 2 — Votre société"
        title="Qui vend sur cette boutique ?"
        description={
          <>
            Nom de la boutique, SIRET, adresse&nbsp;: on renseigne les
            informations qui apparaîtront sur vos factures, dans vos CGV et
            dans les mentions légales du site.
          </>
        }
        accent="emerald"
      />
      <CompanyStepForm initial={company} />
    </div>
  );
}
