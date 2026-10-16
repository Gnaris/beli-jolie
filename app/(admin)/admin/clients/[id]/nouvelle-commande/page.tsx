import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import NouvelleCommandeAdmin from "@/components/admin/users/NouvelleCommandeAdmin";

export const metadata: Metadata = {
  title: "Créer une commande — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminNouvelleCommandePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;
  const client = await prisma.user.findUnique({ where: { id } });
  if (!client) notFound();

  // On informe l'admin de la remise permanente % en vigueur sur la fiche
  // cliente — elle est pré-appliquée au prix catalogue dans le picker, mais
  // modifiable à la main.
  const discountPct =
    client.discountType === "PERCENT" && client.discountMode === "PERMANENT" && client.discountValue != null
      ? Number(client.discountValue)
      : 0;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      <Link
        href={`/admin/clients/${client.id}`}
        className="text-xs text-text-muted hover:text-text-primary inline-flex items-center gap-1 transition-colors w-fit"
      >
        ← Retour à la fiche de {client.firstName} {client.lastName}
      </Link>

      <section className="card p-6 md:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted mb-2">
          Création de commande admin
        </p>
        <h1 className="font-heading text-2xl md:text-3xl font-bold text-text-primary">
          Créer une commande pour {client.firstName} {client.lastName}
        </h1>
        <p className="text-sm text-text-secondary mt-2 font-body">
          Ajoutez les articles et ajustez les prix librement. La commande sera envoyée à {client.email} ;
          la cliente choisira elle-même adresse de livraison, mode de livraison et mode de paiement
          (virement ou carte bancaire) depuis son espace pro.
        </p>
      </section>

      <NouvelleCommandeAdmin
        clientId={client.id}
        clientLabel={`${client.firstName} ${client.lastName}`}
        clientDiscountPercent={discountPct}
      />
    </div>
  );
}
