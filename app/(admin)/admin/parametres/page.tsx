import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import SettingsMinOrderForm from "@/components/admin/settings/SettingsMinOrderForm";
import AdminPasswordResetButton from "@/components/admin/settings/AdminPasswordResetButton";

export const metadata: Metadata = { title: "Paramètres — Beli & Jolie Admin" };

export default async function ParametresPage() {
  const minConfig = await prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } });
  const currentMinHT = minConfig ? parseFloat(minConfig.value) : 0;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="page-title">Paramètres</h1>
        <p className="page-subtitle">Configuration générale du site.</p>
      </div>

      {/* Bloc 1 — Commande minimale */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
          Montant minimum de commande
        </h2>
        <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-5">
          Les clients ne pourront pas valider leur commande si le total HT des articles est inférieur à ce montant.
          Mettez <strong>0</strong> pour désactiver.
        </p>
        <SettingsMinOrderForm currentValue={currentMinHT} />
      </div>

      {/* Bloc 2 — Sécurité compte admin */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
          Mot de passe administrateur
        </h2>
        <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-5">
          Pour des raisons de sécurité, la modification du mot de passe se fait uniquement par email.
          Un lien valable 1 heure vous sera envoyé sur votre adresse email administrateur.
        </p>
        <AdminPasswordResetButton />
      </div>
    </div>
  );
}
