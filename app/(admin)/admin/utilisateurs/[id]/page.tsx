import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateUserStatus } from "@/app/actions/admin/updateUserStatus";
import DeleteUserButton from "@/components/admin/users/DeleteUserButton";
import ClientDiscountForm from "@/components/admin/users/ClientDiscountForm";
import type { UserStatus } from "@prisma/client";

/** Correspondance statut → styles */
const STATUS_CONFIG: Record<UserStatus, { label: string; className: string }> = {
  PENDING:  { label: "En attente de validation", className: "badge badge-warning" },
  APPROVED: { label: "Compte approuvé",          className: "badge badge-success" },
  REJECTED: { label: "Compte rejeté",            className: "badge badge-error" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { firstName: true, lastName: true },
  });
  return {
    title: user
      ? `Dossier ${user.firstName} ${user.lastName} — Admin`
      : "Dossier client — Admin",
  };
}

/**
 * Page détail client — /admin/utilisateurs/[id]
 *
 * Affiche toutes les informations du client + le Kbis
 * Boutons Approuver / Rejeter via Server Actions
 */
export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;

  const [user, cart] = await Promise.all([
    prisma.user.findUnique({ where: { id } }),
    prisma.cart.findUnique({
      where: { userId: id },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: { select: { name: true, reference: true } },
                color:   { select: { name: true, hex: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
  ]);

  // Fetch first image for cart items (by productId + colorId)
  const cartImagePairs = cart?.items.map((item) => ({
    productId: item.variant.productId,
    colorId:   item.variant.colorId,
  })) ?? [];
  const cartColorImages = cartImagePairs.length > 0
    ? await prisma.productColorImage.findMany({
        where: {
          OR: cartImagePairs.map(({ productId, colorId }) => ({ productId, colorId })),
        },
        orderBy: { order: "asc" },
      })
    : [];
  const cartImageMap = new Map<string, string>();
  for (const img of cartColorImages) {
    const key = `${img.productId}::${img.colorId}`;
    if (!cartImageMap.has(key)) cartImageMap.set(key, img.path);
  }

  if (!user || user.role === "ADMIN") notFound();

  const statusCfg = STATUS_CONFIG[user.status];

  // Extraction du nom de fichier depuis le chemin stocké en base (optionnel)
  const kbisFilename = user.kbisPath?.split("/").pop() ?? "";
  const kbisApiUrl  = `/api/admin/kbis/${kbisFilename}`;
  const kbisExt     = kbisFilename.split(".").pop()?.toLowerCase() ?? "";
  const isPdf       = kbisExt === "pdf";

  const formattedDate = new Date(user.createdAt).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-muted" aria-label="Fil d'Ariane">
        <Link href="/admin" className="hover:text-text-primary transition-colors">Dashboard</Link>
        <span>/</span>
        <Link href="/admin/utilisateurs" className="hover:text-text-primary transition-colors">Clients</Link>
        <span>/</span>
        <span className="text-text-primary font-medium">{user.firstName} {user.lastName}</span>
      </nav>

      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">
            {user.firstName} {user.lastName}
          </h1>
          <p className="page-subtitle font-[family-name:var(--font-roboto)]">
            {user.company} — Inscrit le {formattedDate}
          </p>
        </div>

        {/* Badge statut */}
        <span className={`${statusCfg.className} w-fit`}>
          {statusCfg.label}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* -- Informations du client -- */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-border table-header">
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
              Informations personnelles &amp; professionnelles
            </h2>
          </div>
          <div className="p-5 space-y-4">
            {[
              { label: "Prénom",    value: user.firstName },
              { label: "Nom",       value: user.lastName },
              { label: "Société",   value: user.company },
              { label: "Email",     value: user.email },
              { label: "Téléphone", value: user.phone },
              { label: "SIRET",     value: user.siret, mono: true },
              { label: "Rôle",      value: user.role },
            ].map(({ label, value, mono }) => (
              <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <span className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-muted uppercase tracking-wider w-28 shrink-0">
                  {label}
                </span>
                <span className={`text-sm text-text-primary ${mono ? "font-mono" : "font-[family-name:var(--font-roboto)]"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* -- Kbis -- */}
        <div className="card overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-border table-header flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
              Extrait Kbis
            </h2>
            {user.kbisPath && (
              <a
                href={kbisApiUrl}
                download={kbisFilename}
                className="text-xs font-[family-name:var(--font-roboto)] font-medium text-text-secondary hover:text-text-primary flex items-center gap-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Télécharger
              </a>
            )}
          </div>

          {/* Aperçu du document */}
          <div className="flex-1 p-4 min-h-64">
            {user.kbisPath ? (
              isPdf ? (
                <iframe
                  src={kbisApiUrl}
                  title="Extrait Kbis"
                  className="w-full h-80 border-0"
                  aria-label="Aperçu du Kbis au format PDF"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={kbisApiUrl}
                  alt={`Kbis de ${user.company}`}
                  className="w-full h-auto max-h-80 object-contain"
                />
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <svg className="w-10 h-10 text-text-muted mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">
                  Aucun Kbis fourni
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* -- Message d'inscription -- */}
      {user.registrationMessage && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-border table-header">
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
              Message de l&apos;inscrit
            </h2>
          </div>
          <div className="p-5">
            <p className="text-sm text-text-primary font-[family-name:var(--font-roboto)] whitespace-pre-wrap leading-relaxed">
              {user.registrationMessage}
            </p>
          </div>
        </div>
      )}

      {/* -- Panier du client -- */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border table-header flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
            Panier du client
          </h2>
          {cart && cart.items.length > 0 && (
            <span className="badge badge-neutral font-[family-name:var(--font-roboto)]">
              {cart.items.length} article{cart.items.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {!cart || cart.items.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
            </div>
            <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">
              Le panier de ce client est vide.
            </p>
          </div>
        ) : (
          <div>
            {cart.items.map((item) => {
              const v = item.variant;
              const img = cartImageMap.get(`${v.productId}::${v.colorId}`);
              const isPack = v.saleType === "PACK";
              const linePrice = isPack
                ? v.unitPrice * (v.packQuantity ?? 1) * item.quantity
                : v.unitPrice * item.quantity;

              return (
                <div key={item.id} className="flex items-center gap-4 px-5 py-3 border-b border-border-light last:border-b-0">
                  {/* Image */}
                  <div className="w-12 h-12 bg-bg-tertiary rounded-lg overflow-hidden shrink-0">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={v.product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Product info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)] truncate">
                      {v.product.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                      <span>{v.product.reference}</span>
                      <span className="text-border">|</span>
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full border border-border-dark inline-block" style={{ backgroundColor: v.color.hex ?? "#9CA3AF" }} />
                        {v.color.name}
                      </span>
                      {isPack && <span className="text-border">|</span>}
                      {isPack && <span>Pack x{v.packQuantity}</span>}
                      {v.size && <><span className="text-border">|</span><span>Taille {v.size}</span></>}
                    </div>
                  </div>

                  {/* Qty + price */}
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-text-primary font-[family-name:var(--font-poppins)]">
                      {linePrice.toFixed(2)} &euro;
                    </p>
                    <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                      Qte : {item.quantity} &times; {v.unitPrice.toFixed(2)} &euro;
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Total */}
            <div className="px-5 py-3 bg-bg-secondary flex items-center justify-between">
              <span className="text-sm font-medium text-text-secondary font-[family-name:var(--font-roboto)]">
                Total panier
              </span>
              <span className="text-base font-bold text-text-primary font-[family-name:var(--font-poppins)]">
                {cart.items.reduce((sum, item) => {
                  const v = item.variant;
                  const isPk = v.saleType === "PACK";
                  return sum + (isPk
                    ? v.unitPrice * (v.packQuantity ?? 1) * item.quantity
                    : v.unitPrice * item.quantity);
                }, 0).toFixed(2)} &euro;
              </span>
            </div>
          </div>
        )}
      </div>

      {/* -- Actions Approuver / Rejeter -- */}
      {user.status === "PENDING" && (
        <div className="card p-5 border-warning/30 bg-[#FFFBEB]">
          <p className="text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary mb-4">
            Ce dossier est en attente de validation. Après vérification des informations et du Kbis, vous pouvez approuver ou rejeter cette demande.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">

            {/* Approuver */}
            <form action={updateUserStatus.bind(null, user.id, "APPROVED")}>
              <button
                type="submit"
                className="flex items-center gap-2 bg-accent text-white text-sm font-[family-name:var(--font-roboto)] font-medium px-6 py-2.5 rounded-lg hover:bg-accent-dark transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approuver le compte
              </button>
            </form>

            {/* Rejeter */}
            <form action={updateUserStatus.bind(null, user.id, "REJECTED")}>
              <button
                type="submit"
                className="btn-danger"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Rejeter la demande
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Si déjà traité — possibilité de changer d'avis */}
      {user.status !== "PENDING" && (
        <div className="card p-5">
          <p className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary mb-4">
            Ce dossier a déjà été traité. Vous pouvez modifier la décision si nécessaire.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            {user.status === "REJECTED" && (
              <form action={updateUserStatus.bind(null, user.id, "APPROVED")}>
                <button type="submit" className="flex items-center gap-2 bg-accent text-white text-sm font-[family-name:var(--font-roboto)] font-medium px-5 py-2 rounded-lg hover:bg-accent-dark transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Approuver quand même
                </button>
              </form>
            )}
            {user.status === "APPROVED" && (
              <form action={updateUserStatus.bind(null, user.id, "REJECTED")}>
                <button type="submit" className="btn-danger">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Révoquer l&apos;accès
                </button>
              </form>
            )}
            <Link
              href="/admin/utilisateurs"
              className="flex items-center gap-1 text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary transition-colors px-5 py-2"
            >
              ← Retour à la liste
            </Link>
          </div>
        </div>
      )}

      {/* -- Remise commerciale -- */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border table-header flex items-center justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
              Remise commerciale permanente
            </h2>
            <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
              Appliquée automatiquement sur toutes les prochaines commandes de ce client.
            </p>
          </div>
          {(user.discountType || user.freeShipping) && (
            <div className="flex items-center gap-2 shrink-0">
              {user.discountType === "PERCENT" && user.discountValue && (
                <span className="badge badge-info font-[family-name:var(--font-roboto)]">
                  -{user.discountValue}%
                </span>
              )}
              {user.discountType === "AMOUNT" && user.discountValue && (
                <span className="badge badge-info font-[family-name:var(--font-roboto)]">
                  -{user.discountValue.toFixed(2)} €
                </span>
              )}
              {user.freeShipping && (
                <span className="badge badge-success font-[family-name:var(--font-roboto)]">
                  Livraison offerte
                </span>
              )}
            </div>
          )}
        </div>
        <ClientDiscountForm
          userId={user.id}
          initialDiscountType={user.discountType ?? null}
          initialDiscountValue={user.discountValue ?? null}
          initialFreeShipping={user.freeShipping}
        />
      </div>

      {/* -- Supprimer le client -- */}
      <div className="card p-5 border-red-200">
        <p className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary mb-4">
          Zone dangereuse — cette action est irreversible et supprimera toutes les donnees du client.
        </p>
        <DeleteUserButton userId={user.id} userName={`${user.firstName} ${user.lastName}`} />
      </div>

    </div>
  );
}
