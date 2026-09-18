import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Produit supprimé — Admin" };

/**
 * Route intermédiaire depuis une page commande admin : résout un produit
 * par sa référence.
 *
 *  - Produit trouvé → redirect vers `/admin/produits/{id}/modifier` (fiche
 *    d'édition standard).
 *  - Produit introuvable MAIS présent dans l'historique OrderItem (le produit
 *    a été supprimé après vente) → render layout dédié « Produit supprimé »
 *    avec les infos snapshot (nom, image de la 1ʳᵉ ligne trouvée).
 *  - Introuvable ET aucun historique → 404 (URL forgée à la main).
 */
export default async function AdminProductByRefPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);

  const product = await prisma.product.findFirst({
    where: { reference: ref },
    select: { id: true },
  });

  if (product) {
    redirect(`/admin/produits/${product.id}/modifier`);
  }

  // Cherche la ligne de commande la plus récente pour retrouver le nom du
  // produit tel qu'il était au moment de la vente + une image d'illustration.
  const orderItem = await prisma.orderItem.findFirst({
    where: { productRef: ref },
    orderBy: { createdAt: "desc" },
    select: {
      productName: true,
      imagePath: true,
      colorName: true,
      order: { select: { orderNumber: true, id: true } },
    },
  });

  if (!orderItem) notFound();

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <Link
        href="/admin/commandes"
        className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 transition-colors w-fit"
      >
        ← Toutes les commandes
      </Link>

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3 bg-gradient-to-r from-rose-50/70 to-transparent">
          <div className="w-1 h-8 bg-rose-500 rounded-full" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-600">
              Fiche introuvable
            </p>
            <h1 className="font-heading text-xl font-semibold text-slate-900">
              Produit supprimé du catalogue
            </h1>
          </div>
        </div>

        <div className="px-6 py-6 space-y-5">
          <div className="flex items-start gap-5">
            {orderItem.imagePath ? (
              // Snapshot image copié dans le dossier de la commande depuis
              // 2026-09-18 — survit à la suppression du produit d'origine.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={orderItem.imagePath}
                alt={orderItem.productName}
                className="w-32 h-32 rounded-xl object-cover border border-slate-200"
              />
            ) : (
              <div className="w-32 h-32 rounded-xl bg-slate-100 flex items-center justify-center text-slate-300 text-xs">
                Pas d'image
              </div>
            )}

            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-xs font-mono text-slate-500 uppercase tracking-wide">
                Référence : {ref}
              </p>
              <h2 className="font-heading text-lg font-semibold text-slate-900">
                {orderItem.productName}
              </h2>
              {orderItem.colorName && (
                <p className="text-sm text-slate-600">Couleur : {orderItem.colorName}</p>
              )}
            </div>
          </div>

          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-900">
            Ce produit n'existe plus dans le catalogue et n'est plus disponible
            à la vente. La commande garde toutefois toutes ses informations
            légales (nom, référence, couleur, prix, quantités, image).
          </div>

          {orderItem.order && (
            <div className="pt-2">
              <Link
                href={`/admin/commandes/${orderItem.order.id}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
              >
                Retour à la commande {orderItem.order.orderNumber}
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
