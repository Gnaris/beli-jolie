import { getServerSession } from "next-auth";
import { redirect, Link } from "@/i18n/navigation";
import { authOptions } from "@/lib/auth";
import { getClientClaims } from "@/app/actions/client/claims";
import { getCachedShopName } from "@/lib/cached-data";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tClaims] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "claims" }),
  ]);
  return { title: tClaims("metaTitle", { shopName }) };
}

const STATUS_BADGE: Record<string, { badge: string; key: string; borderColor: string }> = {
  OPEN: { badge: "badge badge-info", key: "statusOpen", borderColor: "border-l-gray-500" },
  IN_REVIEW: { badge: "badge badge-warning", key: "statusInReview", borderColor: "border-l-amber-400" },
  ACCEPTED: { badge: "badge badge-success", key: "statusAccepted", borderColor: "border-l-green-500" },
  REJECTED: { badge: "badge badge-error", key: "statusRejected", borderColor: "border-l-red-500" },
  RETURN_PENDING: { badge: "badge badge-warning", key: "statusReturnPending", borderColor: "border-l-amber-400" },
  RETURN_SHIPPED: { badge: "badge badge-info", key: "statusReturnShipped", borderColor: "border-l-gray-500" },
  RETURN_RECEIVED: { badge: "badge badge-success", key: "statusReturnReceived", borderColor: "border-l-green-500" },
  RESOLUTION_PENDING: { badge: "badge badge-warning", key: "statusResolutionPending", borderColor: "border-l-amber-400" },
  RESOLVED: { badge: "badge badge-success", key: "statusResolved", borderColor: "border-l-green-500" },
  CLOSED: { badge: "badge badge-neutral", key: "statusClosed", borderColor: "border-l-gray-300" },
};

export default async function ClientClaimsPage() {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session) return redirect({href: "/connexion", locale});
  if (session.user.status !== "APPROVED") return redirect({href: "/espace-pro", locale});

  const t = await getTranslations({ locale, namespace: "claims" });
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";
  const claims = await getClientClaims();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs font-body text-text-muted">
        <Link href="/espace-pro" className="hover:text-text-primary transition-colors">
          {t("breadcrumbProSpace")}
        </Link>
        <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-text-primary font-medium">{t("breadcrumb")}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">{t("title")}</h1>
          <p className="text-sm text-text-muted font-body mt-1">
            {claims.length === 0
              ? t("emptyDesc")
              : t("countDesc", { count: claims.length })}
          </p>
        </div>
        <Link
          href="/espace-pro/reclamations/nouveau"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-bg-dark text-text-inverse rounded-xl hover:bg-primary-hover transition-colors shadow-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t("newClaim")}
        </Link>
      </div>

      {claims.length === 0 ? (
        /* Empty state */
        <div className="bg-bg-primary border border-border rounded-2xl p-16 text-center shadow-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-bg-secondary flex items-center justify-center">
            <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="font-heading text-lg font-semibold text-text-primary mb-2">{t("empty")}</h2>
          <p className="text-text-muted font-body text-sm max-w-sm mx-auto mb-6">
            {t("emptyHint")}
          </p>
          <Link
            href="/espace-pro/reclamations/nouveau"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-bg-dark text-text-inverse rounded-xl hover:bg-primary-hover transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("createClaim")}
          </Link>
        </div>
      ) : (
        <>
          {/* Desktop table (hidden on mobile) */}
          <div className="hidden md:block bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">{t("thReference")}</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">{t("thType")}</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">{t("thOrder")}</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">{t("thItems")}</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">{t("thStatus")}</th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">{t("thDate")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claims.map((claim) => {
                  const cfg = STATUS_BADGE[claim.status] || { badge: "badge badge-neutral", key: "statusClosed", borderColor: "border-l-gray-300" };
                  return (
                    <tr key={claim.id} className="group relative hover:bg-bg-secondary/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/espace-pro/reclamations/${claim.id}`}
                          className="font-heading font-bold text-text-primary hover:underline after:absolute after:inset-0 after:content-['']"
                        >
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle ${cfg.borderColor.replace("border-l-", "bg-")}`} />
                          {claim.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {claim.type === "ORDER_CLAIM" ? (
                          <span className="badge badge-purple">{t("typeOrder")}</span>
                        ) : (
                          <span className="badge badge-neutral">{t("typeGeneral")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {claim.order ? claim.order.orderNumber : "—"}
                      </td>
                      <td className="px-4 py-3 text-center text-text-muted">
                        {claim._count.items > 0 ? t("itemsCount", { count: claim._count.items }) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cfg.badge}>{t(cfg.key)}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-text-muted whitespace-nowrap">
                        {new Date(claim.createdAt).toLocaleDateString(dateLocale, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (hidden on desktop) */}
          <div className="md:hidden space-y-3">
            {claims.map((claim) => {
              const cfg = STATUS_BADGE[claim.status] || { badge: "badge badge-neutral", key: "statusClosed", borderColor: "border-l-gray-300" };
              return (
                <Link
                  key={claim.id}
                  href={`/espace-pro/reclamations/${claim.id}`}
                  className={`block bg-bg-primary border border-border rounded-2xl shadow-sm p-4 border-l-4 ${cfg.borderColor} hover:shadow-md transition-shadow`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="font-heading font-bold text-text-primary text-sm truncate">
                        {claim.reference}
                      </p>
                      <p className="text-xs text-text-muted font-body mt-0.5">
                        {new Date(claim.createdAt).toLocaleDateString(dateLocale, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <span className={cfg.badge}>{t(cfg.key)}</span>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    {claim.type === "ORDER_CLAIM" ? (
                      <span className="badge badge-purple">{t("typeOrder")}</span>
                    ) : (
                      <span className="badge badge-neutral">{t("typeGeneral")}</span>
                    )}
                    {claim.order && (
                      <span className="text-xs text-text-muted font-body">
                        {claim.order.orderNumber}
                      </span>
                    )}
                    {claim._count.items > 0 && (
                      <span className="text-xs text-text-muted font-body">
                        {t("itemsCount", { count: claim._count.items })}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-end mt-2">
                    <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
