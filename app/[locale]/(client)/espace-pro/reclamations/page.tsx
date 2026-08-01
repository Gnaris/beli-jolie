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

const SYSTEM_PREFIX = "__system__:";

function truncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

export default async function ClientClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; deleted?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session) return redirect({ href: "/connexion", locale });
  if (session.user.status !== "APPROVED") return redirect({ href: "/espace-pro", locale });

  const { page, deleted } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const showDeletedNotice = deleted === "1";

  const t = await getTranslations({ locale, namespace: "claims" });
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";
  const { rows: claims, page: activePage, pageSize, totalPages, filteredTotal } =
    await getClientClaims(currentPage);

  const openCount = claims.filter((c) => c.status === "OPEN").length;
  const closedCount = claims.length - openCount;

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

      {showDeletedNotice && (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-text-secondary">
            <p className="font-semibold text-text-primary">Conversation supprimée</p>
            <p className="mt-0.5">
              L'administrateur a supprimé la conversation que vous cherchiez. Vous retrouvez ci-dessous vos autres demandes.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-block text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted mb-2">
              {t("breadcrumb")}
            </span>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary">{t("title")}</h1>
            <p className="text-sm text-text-secondary font-body mt-1.5">
              {claims.length === 0
                ? t("emptyDesc")
                : `${openCount} conversation${openCount > 1 ? "s" : ""} ouverte${openCount > 1 ? "s" : ""}${closedCount > 0 ? ` · ${closedCount} fermée${closedCount > 1 ? "s" : ""}` : ""}`}
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
      </section>

      {claims.length === 0 ? (
        /* Empty state */
        <div className="bg-bg-primary border border-border rounded-2xl p-14 text-center shadow-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-bg-secondary flex items-center justify-center">
            <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.87 9.87 0 01-4-.8L3 20l1.3-3.9A7.97 7.97 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h2 className="font-heading text-lg font-semibold text-text-primary mb-2">{t("empty")}</h2>
          <p className="text-text-secondary font-body text-sm max-w-sm mx-auto mb-6">
            {t("emptyHint")}
          </p>
          <Link
            href="/espace-pro/reclamations/nouveau"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-bg-dark text-text-inverse rounded-xl hover:bg-primary-hover transition-colors shadow-sm"
          >
            {t("createClaim")}
          </Link>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    {t("thReference")}
                  </th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    {t("thSubject") ?? "Sujet"}
                  </th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    {t("thLastMessage") ?? "Dernier message"}
                  </th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    {t("thStatus")}
                  </th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    {t("thDate")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claims.map((claim) => {
                  const isOpen = claim.status === "OPEN";
                  const lastMsg = claim.conversation?.messages[0];
                  const lastMsgText = lastMsg?.content
                    ? lastMsg.content.startsWith(SYSTEM_PREFIX)
                      ? t("systemMessagePreview") ?? "(message système)"
                      : truncate(lastMsg.content, 60)
                    : "—";
                  const lastMsgAuthor = lastMsg?.senderRole === "ADMIN" ? t("authorAdmin") ?? "Support" : t("authorYou") ?? "Vous";

                  return (
                    <tr key={claim.id} className={`group relative hover:bg-bg-secondary/50 transition-colors ${!isOpen ? "opacity-75" : ""}`}>
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/espace-pro/reclamations/${claim.id}`}
                          className="font-heading font-bold text-text-primary hover:underline after:absolute after:inset-0 after:content-['']"
                        >
                          {claim.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-primary max-w-xs align-top">
                        <span className="line-clamp-2">{claim.subject}</span>
                      </td>
                      <td className="px-4 py-3 text-text-muted align-top max-w-xs">
                        {lastMsg ? (
                          <>
                            <span className="text-text-muted">{lastMsgAuthor} · </span>
                            <span className="text-text-secondary">« {lastMsgText} »</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-center align-top">
                        {isOpen ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-800 text-xs font-semibold border border-zinc-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                            {t("statusOpen")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-50 text-zinc-500 text-xs font-semibold border border-zinc-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                            {t("statusClosed")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-text-muted whitespace-nowrap align-top">
                        {new Date(claim.createdAt).toLocaleDateString(dateLocale, {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {claims.map((claim) => {
              const isOpen = claim.status === "OPEN";
              const lastMsg = claim.conversation?.messages[0];
              const lastMsgText = lastMsg?.content
                ? lastMsg.content.startsWith(SYSTEM_PREFIX)
                  ? t("systemMessagePreview") ?? "(message système)"
                  : truncate(lastMsg.content, 80)
                : "—";
              const lastMsgAuthor = lastMsg?.senderRole === "ADMIN" ? t("authorAdmin") ?? "Support" : t("authorYou") ?? "Vous";
              return (
                <Link
                  key={claim.id}
                  href={`/espace-pro/reclamations/${claim.id}`}
                  className={`block bg-bg-primary border border-border rounded-2xl shadow-sm p-4 hover:shadow-md transition-shadow ${!isOpen ? "opacity-75" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-heading font-bold text-text-primary text-sm truncate">
                        {claim.reference}
                      </p>
                      <p className="text-xs text-text-muted font-body mt-0.5">
                        {new Date(claim.createdAt).toLocaleDateString(dateLocale, {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </p>
                    </div>
                    {isOpen ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-800 text-xs font-semibold border border-zinc-200 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                        {t("statusOpen")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-50 text-zinc-500 text-xs font-semibold border border-zinc-200 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                        {t("statusClosed")}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-primary font-medium mb-1 line-clamp-2">{claim.subject}</p>
                  {lastMsg && (
                    <p className="text-xs text-text-muted font-body line-clamp-2">
                      {lastMsgAuthor} : « {lastMsgText} »
                    </p>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
              <span className="text-xs text-text-muted font-body">
                {(activePage - 1) * pageSize + 1}–{Math.min(activePage * pageSize, filteredTotal)} sur {filteredTotal}
              </span>
              <div className="flex items-center gap-1">
                {activePage > 1 ? (
                  <Link
                    href={{ pathname: "/espace-pro/reclamations", query: { page: String(activePage - 1) } }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-white text-sm font-medium hover:bg-bg-secondary transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                    </svg>
                    Précédent
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-bg-secondary text-sm font-medium text-text-muted opacity-40 cursor-not-allowed">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                    </svg>
                    Précédent
                  </span>
                )}
                <span className="px-3 py-1.5 text-sm text-text-muted font-body">
                  Page {activePage} / {totalPages}
                </span>
                {activePage < totalPages ? (
                  <Link
                    href={{ pathname: "/espace-pro/reclamations", query: { page: String(activePage + 1) } }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-white text-sm font-medium hover:bg-bg-secondary transition-colors"
                  >
                    Suivant
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-bg-secondary text-sm font-medium text-text-muted opacity-40 cursor-not-allowed">
                    Suivant
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
