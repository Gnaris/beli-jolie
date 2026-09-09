import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOnline, getOnlineThreshold } from "@/lib/online-status";
import { initialsOf, avatarGradientFor } from "@/lib/user-avatar";
import AutoRefresh from "@/components/admin/users/AutoRefresh";
import UsersTabs from "@/components/admin/users/UsersTabs";
import AdminCardsPane from "@/components/admin/users/AdminCardsPane";
import UsersSortControl from "@/components/admin/users/UsersSortControl";
import UsersSearchBar from "@/components/admin/users/UsersSearchBar";
import UserRowActionsMenu from "@/components/admin/users/UserRowActionsMenu";
import SendMailButton from "@/components/admin/users/SendMailButton";
import EmailJournalButton from "@/components/admin/users/EmailJournalButton";
import MailRowCheckbox from "@/components/admin/users/MailRowCheckbox";
import { listNewsletterTemplates } from "@/app/actions/admin/newsletter-templates";
import Pagination from "@/components/ui/Pagination";
import PerPageSelect from "@/components/ui/PerPageSelect";
import {
  parseClientSort,
  parseSortDir,
  isStatsSort,
  buildUserOrderBy,
  sortClientIdsByStats,
  defaultDirFor,
  formatSpent,
  EMPTY_CLIENT_STATS,
  type ClientSortKey,
  type SortDir,
  type ClientOrderStats,
} from "@/lib/admin-client-sort";
import type { UserStatus, Prisma } from "@prisma/client";

// Bypass cache : on veut le lastSeenAt frais à chaque rafraîchissement
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gestion des clients — Admin",
};

const PER_PAGE_CHOICES = [20, 50, 100, 200, 500];
const DEFAULT_PER_PAGE = 20;

function formatTimeAgo(date: Date | null): string {
  if (!date) return "Jamais";
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `Il y a ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Il y a ${days}j`;
  const months = Math.floor(days / 30);
  return `Il y a ${months} mois`;
}

function formatShortDate(date: Date): { date: string; time: string } {
  return {
    date: new Date(date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
    time: new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function parsePerPage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PER_PAGE;
  return PER_PAGE_CHOICES.includes(n) ? n : DEFAULT_PER_PAGE;
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

// ─── Tuile KPI ─────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, icon, accent, pulse = false,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ReactNode;
  accent: "neutral" | "emerald" | "amber" | "sky" | "violet";
  pulse?: boolean;
}) {
  const accentMap = {
    neutral: {
      cardBg: "bg-bg-primary",
      iconBg: "bg-bg-secondary border border-border", iconText: "text-text-primary",
      border: "border-border", valueText: "text-text-primary",
      glow: "before:bg-slate-300/25",
      labelText: "text-text-muted",
    },
    emerald: {
      cardBg: "bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary",
      iconBg: "bg-emerald-100 border border-emerald-200", iconText: "text-emerald-700",
      border: "border-emerald-200/70", valueText: "text-emerald-700",
      glow: "before:bg-emerald-300/40",
      labelText: "text-emerald-700",
    },
    amber: {
      cardBg: "bg-gradient-to-br from-amber-50 via-bg-primary to-bg-primary",
      iconBg: "bg-amber-100 border border-amber-200", iconText: "text-amber-700",
      border: "border-amber-200/70", valueText: "text-amber-700",
      glow: "before:bg-amber-300/40",
      labelText: "text-amber-700",
    },
    sky: {
      cardBg: "bg-gradient-to-br from-sky-50 via-bg-primary to-bg-primary",
      iconBg: "bg-sky-100 border border-sky-200", iconText: "text-sky-700",
      border: "border-sky-200/70", valueText: "text-sky-700",
      glow: "before:bg-sky-300/40",
      labelText: "text-sky-700",
    },
    violet: {
      cardBg: "bg-gradient-to-br from-violet-50 via-bg-primary to-bg-primary",
      iconBg: "bg-violet-100 border border-violet-200", iconText: "text-violet-700",
      border: "border-violet-200/70", valueText: "text-violet-700",
      glow: "before:bg-violet-300/40",
      labelText: "text-violet-700",
    },
  }[accent];

  return (
    <div className={`relative overflow-hidden border ${accentMap.border} ${accentMap.cardBg} rounded-2xl p-4 sm:p-5 shadow-sm before:content-[''] before:absolute before:-top-10 before:-right-10 before:w-28 before:h-28 before:rounded-full before:blur-3xl ${accentMap.glow}`}>
      <div className="relative flex items-start justify-between mb-3">
        <p className={`text-[10px] sm:text-[11px] font-body font-bold uppercase tracking-[0.14em] ${accentMap.labelText}`}>{label}</p>
        <span className={`inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${accentMap.iconBg} ${accentMap.iconText}`}>
          {icon}
        </span>
      </div>
      <p className={`relative font-heading text-2xl sm:text-3xl font-bold tabular-nums leading-none flex items-center gap-2 ${accentMap.valueText}`}>
        {pulse && value > 0 && (
          <span className="relative inline-flex w-2.5 h-2.5">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
            <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500" />
          </span>
        )}
        {value}
      </p>
      <p className="relative text-[11px] sm:text-xs font-body text-text-muted mt-1.5">{sub}</p>
    </div>
  );
}

const FILTERS: { value: string; label: string }[] = [
  { value: "ALL",      label: "Tous" },
  { value: "PENDING",  label: "En attente" },
  { value: "APPROVED", label: "Approuvés" },
  { value: "REJECTED", label: "Rejetés" },
];

export default async function UtilisateursPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    tab?: string;
    page?: string;
    per?: string;
    mp?: string;
    q?: string;
    sort?: string;
    dir?: string;
    view?: string;
  }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const params = await searchParams;
  const currentTab: "inscrits" | "fiches" = params.tab === "fiches" ? "fiches" : "inscrits";
  // Ne garder que les valeurs UserStatus valides — un param `status`
  // hérité d'une autre page (ex. filtres marketing `HAS_PENDING_CART`)
  // doit être traité comme « ALL » sinon Prisma refuse le cast.
  const VALID_STATUS_FILTERS = new Set(["ALL", "PENDING", "APPROVED", "REJECTED"]);
  const filterStatus = VALID_STATUS_FILTERS.has(params.status ?? "")
    ? (params.status as string)
    : "ALL";
  const perPage = parsePerPage(params.per);
  const page = parsePage(params.page);
  const sort = parseClientSort(params.sort);
  const dir = parseSortDir(params.dir, sort);
  const registeredSearch = (params.q ?? "").trim();
  // Page clients : uniquement la vue « Infos ». La vue « Mails » vit
  // désormais sur /admin/marketing (page dédiée dans la sidebar). L'annotation
  // large `as ...` garde les blocs de rendu de secours pour le jour où on
  // remettra la vue mails ici — sinon TypeScript narrow à la valeur littérale
  // et refuse toute comparaison `view === "mails"` en aval.
  const view = "infos" as "infos" | "mails";

  const onlineThreshold = getOnlineThreshold();

  // Common counters (KPI + tab badges)
  const [pendingCount, approvedCount, rejectedCount, totalCount, onlineCount, cardsTotalCount] =
    await Promise.all([
      prisma.user.count({ where: { role: "CLIENT", status: "PENDING" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "APPROVED" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "REJECTED" } }),
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.user.count({ where: { role: "CLIENT", lastSeenAt: { gte: onlineThreshold } } }),
      prisma.adminClientCard.count({}),
    ]);

  const searchFilter: Prisma.UserWhereInput = registeredSearch
    ? {
        OR: [
          { firstName: { contains: registeredSearch } },
          { lastName: { contains: registeredSearch } },
          { company: { contains: registeredSearch } },
          { email: { contains: registeredSearch } },
          { phone: { contains: registeredSearch } },
          { siret: { contains: registeredSearch } },
          { businessRegistrationNumber: { contains: registeredSearch } },
          { vatNumber: { contains: registeredSearch } },
        ],
      }
    : {};

  const registeredWhere: Prisma.UserWhereInput =
    filterStatus === "ALL"
      ? { role: "CLIENT", ...searchFilter }
      : { role: "CLIENT", status: filterStatus as UserStatus, ...searchFilter };

  // Count filtré = respecte AUSSI la recherche (les compteurs KPI restent globaux
  // pour donner une vue d'ensemble ; seul le total de la liste change).
  const filteredRegisteredCount = registeredSearch
    ? await prisma.user.count({ where: registeredWhere })
    : filterStatus === "ALL"
      ? totalCount
      : filterStatus === "PENDING"
        ? pendingCount
        : filterStatus === "APPROVED"
          ? approvedCount
          : rejectedCount;

  const counts: Record<string, number> = {
    ALL:      totalCount,
    PENDING:  pendingCount,
    APPROVED: approvedCount,
    REJECTED: rejectedCount,
  };

  // Data loading depends on active tab
  const [registeredData, cardsData] = await Promise.all([
    currentTab === "inscrits"
      ? loadRegisteredClients(registeredWhere, sort, dir, page, perPage)
      : Promise.resolve({ clients: [], stats: new Map<string, ClientOrderStats>() }),
    currentTab === "fiches" ? loadAdminCards(params, page, perPage) : Promise.resolve(null),
  ]);

  // Vue Mails : charger le dernier envoi de chaque scénario pour les clients
  // affichés + les modèles de newsletter disponibles pour l'envoi groupé.
  const [mailsData, newsletterTemplates] =
    view === "mails" && currentTab === "inscrits"
      ? await Promise.all([
          loadLastMailSendsFor(registeredData.clients.map((c) => c.id)),
          listNewsletterTemplates(),
        ])
      : [new Map<string, MailLastSends>(), []];

  // Vue Infos : charger le panier en cours de chaque client affiché.
  const cartsData: Map<string, CartSummary> =
    view === "infos" && currentTab === "inscrits"
      ? await loadCartsFor(registeredData.clients.map((c) => c.id))
      : new Map();

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={10_000} />

      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm bg-slate-100">
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-text-primary shadow-[0_0_0_3px_rgba(24,24,27,0.14)]" />
                Clients pro
              </span>
              <h1 className="page-title mt-4">Gestion des clients</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Comptes professionnels inscrits sur le site + votre répertoire personnel de fiches clients.
              </p>
            </div>
          </div>

          <div className="relative mt-6 sm:mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              label="Total clients"
              value={totalCount}
              sub="Comptes enregistrés"
              accent="neutral"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              }
            />
            <KpiTile
              label="En ligne maintenant"
              value={onlineCount}
              sub="Actifs dans la dernière minute"
              accent="neutral"
              pulse
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>
                </svg>
              }
            />
            <KpiTile
              label="À valider"
              value={pendingCount}
              sub="Nouvelles inscriptions"
              accent="neutral"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
                </svg>
              }
            />
            <KpiTile
              label="Mes fiches"
              value={cardsTotalCount}
              sub="Répertoire personnel admin"
              accent="neutral"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              }
            />
          </div>
        </div>
      </section>

      <UsersTabs currentTab={currentTab} registeredCount={totalCount} cardsCount={cardsTotalCount} />

      {currentTab === "inscrits" ? (
        <>
          <RegisteredPane
            clients={registeredData.clients}
            stats={registeredData.stats}
            filterStatus={filterStatus}
            counts={counts}
            totalFiltered={filteredRegisteredCount}
            page={page}
            perPage={perPage}
            sort={sort}
            dir={dir}
            search={registeredSearch}
            view={view}
            mails={mailsData}
            carts={cartsData}
          />
        </>
      ) : (
        cardsData && (
          <AdminCardsPane
            cards={cardsData.cards}
            totalCount={cardsData.filteredCount}
            filterCounts={cardsData.filterCounts}
            currentFilter={cardsData.filter}
            currentPage={page}
            perPage={perPage}
            search={cardsData.search}
          />
        )
      )}

      <p className="text-center text-[11px] text-text-muted font-body pt-2">
        Actualisation automatique toutes les 10 secondes
      </p>
    </div>
  );
}

// ─── Registered users pane (existing behaviour + pagination) ────────────────

type RegisteredClient = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string | null;
  businessRegistrationNumber: string | null;
  vatNumber: string | null;
  addressCountry: string | null;
  status: UserStatus;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  acceptsNewsletter: boolean;
};

const REGISTERED_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  company: true,
  email: true,
  phone: true,
  siret: true,
  businessRegistrationNumber: true,
  vatNumber: true,
  addressCountry: true,
  status: true,
  lastLoginAt: true,
  lastSeenAt: true,
  createdAt: true,
  acceptsNewsletter: true,
} as const;

// ─── Panier en cours : nb d'articles + total HT par client ───────────────────

type CartSummary = { itemCount: number; total: number };

async function loadCartsFor(userIds: string[]): Promise<Map<string, CartSummary>> {
  if (userIds.length === 0) return new Map();
  const carts = await prisma.cart.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      items: {
        select: {
          quantity: true,
          variant: { select: { unitPrice: true } },
        },
      },
    },
  });
  const map = new Map<string, CartSummary>();
  for (const c of carts) {
    let itemCount = 0;
    let total = 0;
    for (const it of c.items) {
      itemCount += it.quantity;
      total += it.quantity * Number(it.variant.unitPrice);
    }
    if (itemCount > 0) map.set(c.userId, { itemCount, total });
  }
  return map;
}

// SIRET (FR) vs numéro d'enregistrement d'entreprise (autres pays)
function businessNumberLabel(client: {
  siret: string | null;
  businessRegistrationNumber: string | null;
}): { label: string; value: string } | null {
  if (client.siret) return { label: "SIRET", value: client.siret };
  if (client.businessRegistrationNumber) {
    return { label: "N° entreprise", value: client.businessRegistrationNumber };
  }
  return null;
}

type GroupedOrderStats = {
  userId: string;
  _count: { _all: number };
  _sum: { totalTTC: Prisma.Decimal | null };
}[];

function toStatsMap(grouped: GroupedOrderStats): Map<string, ClientOrderStats> {
  const map = new Map<string, ClientOrderStats>();
  for (const row of grouped) {
    map.set(row.userId, {
      count: row._count._all,
      spent: row._sum.totalTTC ? Number(row._sum.totalTTC) : 0,
    });
  }
  return map;
}

/** Commandes annulées exclues : elles ne représentent ni un volume ni un CA réel. */
const COUNTED_ORDERS: Prisma.OrderWhereInput = { status: { not: "CANCELLED" } };

// ─── Vue Mails : dernier envoi de chaque scénario par client ────────────────

type MailScenario = "ABANDONED_CART" | "INACTIVE_CLIENT" | "NEWSLETTER" | "RESTOCK";

export type MailLastSends = Partial<Record<MailScenario, Date>>;

const MAIL_SCENARIOS: MailScenario[] = ["ABANDONED_CART", "INACTIVE_CLIENT", "NEWSLETTER", "RESTOCK"];

/**
 * Charge, pour chaque userId passé, la date la plus récente d'envoi de chacun
 * des 4 scénarios de mail. Une seule requête groupBy — pas de N+1.
 */
async function loadLastMailSendsFor(userIds: string[]): Promise<Map<string, MailLastSends>> {
  const map = new Map<string, MailLastSends>();
  if (userIds.length === 0) return map;

  const grouped = await prisma.emailSend.groupBy({
    by: ["userId", "scenarioKey"],
    where: {
      userId: { in: userIds },
      scenarioKey: { in: MAIL_SCENARIOS },
    },
    _max: { sentAt: true },
  });

  for (const row of grouped) {
    if (!row.userId) continue;
    const existing = map.get(row.userId) ?? {};
    existing[row.scenarioKey as MailScenario] = row._max.sentAt ?? undefined;
    map.set(row.userId, existing);
  }
  return map;
}

async function loadOrderStatsFor(userIds: string[]): Promise<Map<string, ClientOrderStats>> {
  if (userIds.length === 0) return new Map();
  const grouped = await prisma.order.groupBy({
    by: ["userId"],
    where: { ...COUNTED_ORDERS, userId: { in: userIds } },
    _count: { _all: true },
    _sum: { totalTTC: true },
  });
  return toStatsMap(grouped);
}

/**
 * Charge la page courante de clients inscrits + leurs stats de commandes.
 *
 * Tri « colonne » → MySQL trie et pagine. Tri « statistiques » (nb de commandes
 * ou montant dépensé) → la donnée vit dans Order, on agrège puis on ordonne les
 * ids en mémoire avant de ne charger que les clients de la page.
 */
async function loadRegisteredClients(
  where: Prisma.UserWhereInput,
  sort: ClientSortKey,
  dir: SortDir,
  page: number,
  perPage: number,
): Promise<{ clients: RegisteredClient[]; stats: Map<string, ClientOrderStats> }> {
  if (!isStatsSort(sort)) {
    const clients = await prisma.user.findMany({
      where,
      orderBy: buildUserOrderBy(sort, dir),
      skip: (page - 1) * perPage,
      take: perPage,
      select: REGISTERED_SELECT,
    });
    const stats = await loadOrderStatsFor(clients.map((c) => c.id));
    return { clients, stats };
  }

  const [allIds, grouped] = await Promise.all([
    // Ordre secondaire (inscription récente) conservé pour les ex æquo : le tri
    // JS de sortClientIdsByStats est stable.
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.order.groupBy({
      by: ["userId"],
      where: COUNTED_ORDERS,
      _count: { _all: true },
      _sum: { totalTTC: true },
    }),
  ]);

  const stats = toStatsMap(grouped);
  const orderedIds = sortClientIdsByStats(allIds.map((u) => u.id), stats, sort, dir);
  const pageIds = orderedIds.slice((page - 1) * perPage, page * perPage);

  const rows = await prisma.user.findMany({
    where: { id: { in: pageIds } },
    select: REGISTERED_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const clients = pageIds
    .map((id) => byId.get(id))
    .filter((c): c is RegisteredClient => Boolean(c));

  return { clients, stats };
}

/** Construit une URL de la liste en conservant les autres réglages en cours. */
function buildListHref(opts: {
  status: string;
  perPage: number;
  sort: ClientSortKey;
  dir: SortDir;
  view?: "infos" | "mails";
}): string {
  const params = new URLSearchParams();
  if (opts.status !== "ALL") params.set("status", opts.status);
  if (opts.perPage !== DEFAULT_PER_PAGE) params.set("per", String(opts.perPage));
  if (opts.sort !== "created" || opts.dir !== defaultDirFor(opts.sort)) {
    params.set("sort", opts.sort);
    params.set("dir", opts.dir);
  }
  if (opts.view === "mails") params.set("view", "mails");
  const qs = params.toString();
  return qs ? `/admin/clients?${qs}` : "/admin/clients";
}

/** En-tête de colonne cliquable : re-trie sur ce critère, ou inverse le sens. */
function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  filterStatus,
  perPage,
  align = "left",
  alsoActiveFor,
  view,
}: {
  label: string;
  sortKey: ClientSortKey;
  currentSort: ClientSortKey;
  currentDir: SortDir;
  filterStatus: string;
  perPage: number;
  align?: "left" | "right";
  /** Autres critères qui portent sur cette colonne (ex. montant dépensé ↔ Commandes) */
  alsoActiveFor?: ClientSortKey[];
  view?: "infos" | "mails";
}) {
  const isCurrent = currentSort === sortKey;
  const isActive = isCurrent || (alsoActiveFor?.includes(currentSort) ?? false);
  // Un clic sur une colonne non triée applique le sens naturel de son critère.
  const nextDir: SortDir = isCurrent
    ? currentDir === "desc"
      ? "asc"
      : "desc"
    : defaultDirFor(sortKey);

  return (
    <Link
      href={buildListHref({ status: filterStatus, perPage, sort: sortKey, dir: nextDir, view })}
      prefetch={false}
      scroll={false}
      title={`Trier par ${label.toLowerCase()}`}
      className={`inline-flex items-center gap-1.5 transition-colors ${
        align === "right" ? "justify-end" : ""
      } ${isActive ? "text-text-primary" : "hover:text-text-secondary"}`}
    >
      {label}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isActive ? "" : "opacity-30"}
        aria-hidden="true"
      >
        {!isActive ? (
          <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
        ) : currentDir === "desc" ? (
          <path d="M6 10l6 6 6-6" />
        ) : (
          <path d="M6 14l6-6 6 6" />
        )}
      </svg>
    </Link>
  );
}

// ─── Vue Mails : tableau simplifié avec date du dernier envoi par scénario ──
// Les 4 colonnes affichent la date du dernier envoi (depuis EmailSend). Si
// aucun envoi n'a jamais été fait pour un scénario donné, la cellule affiche
// "—" au lieu d'une date.
function MailsView({
  clients,
  totalFiltered,
  page,
  perPage,
  mails,
}: {
  clients: RegisteredClient[];
  totalFiltered: number;
  page: number;
  perPage: number;
  mails: Map<string, MailLastSends>;
}) {
  const MAIL_COLUMNS: { key: MailScenario; label: string; short: string }[] = [
    { key: "ABANDONED_CART", label: "Panier abandonné", short: "Panier" },
    { key: "INACTIVE_CLIENT", label: "Inactivité", short: "Inactif" },
    { key: "NEWSLETTER", label: "Newsletter", short: "News" },
    { key: "RESTOCK", label: "Retour en stock", short: "Réassort" },
  ];

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-secondary">
              <tr className="border-b border-border">
                <th className="px-3 py-3 w-8"></th>
                <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">
                  Client
                </th>
                {MAIL_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap"
                  >
                    {col.label}
                  </th>
                ))}
                <th className="px-5 py-3 text-right text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const gradient = avatarGradientFor(c.id);
                const lastSends = mails.get(c.id) ?? {};
                return (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 transition-colors hover:bg-bg-secondary/60"
                  >
                    <td className="px-3 py-3.5">
                      <MailRowCheckbox userId={c.id} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`flex items-center justify-center w-10 h-10 rounded-xl text-white text-[13px] font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                          {initialsOf(c.firstName, c.lastName)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-body font-semibold text-text-primary truncate">
                            {c.firstName} {c.lastName}
                          </p>
                          <p className="text-xs font-body text-text-muted truncate max-w-xs">
                            {c.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    {MAIL_COLUMNS.map((col) => {
                      const date = lastSends[col.key];
                      return (
                        <td key={col.key} className="px-5 py-3.5 whitespace-nowrap">
                          {date ? (
                            <>
                              <p className="text-[13px] font-body text-text-primary tabular-nums leading-none">
                                {formatShortDate(date).date}
                              </p>
                              <p className="text-[11px] font-body text-text-muted mt-1">
                                {formatTimeAgo(date)}
                              </p>
                            </>
                          ) : (
                            <p className="text-[13px] font-body text-text-muted/50">—</p>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex gap-2">
                        <EmailJournalButton
                          userId={c.id}
                          userLabel={`${c.firstName} ${c.lastName}`.trim() || c.company || c.email}
                          userEmail={c.email}
                        />
                        <SendMailButton
                          userId={c.id}
                          userLabel={`${c.firstName} ${c.lastName}`.trim() || c.company || c.email}
                          userEmail={c.email}
                          acceptsNewsletter={c.acceptsNewsletter}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination totalItems={totalFiltered} perPage={perPage} currentPage={page} itemLabel="clients" />
      </div>

      {/* Mobile */}
      <div className="lg:hidden space-y-2.5">
        {clients.map((c) => {
          const gradient = avatarGradientFor(c.id);
          const lastSends = mails.get(c.id) ?? {};
          return (
            <div
              key={c.id}
              className="rounded-2xl border border-border bg-bg-primary p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="pt-1 shrink-0">
                  <MailRowCheckbox userId={c.id} />
                </div>
                <div className={`flex items-center justify-center w-11 h-11 rounded-xl text-white text-sm font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                  {initialsOf(c.firstName, c.lastName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-body font-semibold text-text-primary truncate">
                    {c.firstName} {c.lastName}
                  </p>
                  <p className="text-[12px] font-body text-text-muted truncate">{c.email}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {MAIL_COLUMNS.map((col) => {
                      const date = lastSends[col.key];
                      return (
                        <div
                          key={col.key}
                          className="rounded-lg bg-bg-secondary border border-border px-2.5 py-2"
                        >
                          <p className="text-[10px] font-body font-bold text-text-muted uppercase tracking-[0.1em]">
                            {col.short}
                          </p>
                          <p className={`text-[13px] font-body mt-0.5 ${date ? "text-text-primary font-semibold" : "text-text-muted/60"}`}>
                            {date ? formatTimeAgo(date) : "—"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <EmailJournalButton
                      userId={c.id}
                      userLabel={`${c.firstName} ${c.lastName}`.trim() || c.company || c.email}
                      userEmail={c.email}
                    />
                    <SendMailButton
                      userId={c.id}
                      userLabel={`${c.firstName} ${c.lastName}`.trim() || c.company || c.email}
                      userEmail={c.email}
                      acceptsNewsletter={c.acceptsNewsletter}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden">
          <Pagination totalItems={totalFiltered} perPage={perPage} currentPage={page} itemLabel="clients" />
        </div>
      </div>

      {/* Note d'aide sous le tableau — la cliente sait que c'est vide pour l'instant */}
      <div className="rounded-2xl border border-dashed border-border bg-bg-secondary/60 p-4 text-center">
        <p className="text-xs font-body text-text-secondary">
          Aucun envoi automatique pour l&apos;instant — les colonnes se rempliront quand
          la fonctionnalité d&apos;envoi manuel groupé sera activée.
        </p>
      </div>
    </>
  );
}

function RegisteredPane({
  clients,
  stats,
  filterStatus,
  counts,
  totalFiltered,
  page,
  perPage,
  sort,
  dir,
  search,
  view,
  mails,
  carts,
}: {
  clients: RegisteredClient[];
  stats: Map<string, ClientOrderStats>;
  filterStatus: string;
  counts: Record<string, number>;
  totalFiltered: number;
  page: number;
  perPage: number;
  sort: ClientSortKey;
  dir: SortDir;
  search: string;
  view: "infos" | "mails";
  mails: Map<string, MailLastSends>;
  carts: Map<string, CartSummary>;
}) {
  const ordersColumnActive = sort === "orders" || sort === "spent";

  return (
    <>
      {/* Barre de recherche */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="hidden sm:block" />
        <UsersSearchBar initialValue={search} />
      </div>

      {/* Filtres + tri + par page */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => {
            const isActive = filterStatus === filter.value;
            const count = counts[filter.value];
            const isPendingChip = filter.value === "PENDING";
            const isRejectedChip = filter.value === "REJECTED";

            let chipClass = "bg-bg-primary border-border text-text-secondary hover:border-border-strong hover:text-text-primary";
            let countClass = "bg-bg-secondary text-text-muted";

            if (isActive) {
              if (isPendingChip) {
                chipClass = "bg-gradient-to-br from-amber-600 to-amber-700 border-amber-600 text-white shadow-sm";
                countClass = "bg-white/20 text-white";
              } else if (isRejectedChip) {
                chipClass = "bg-gradient-to-br from-red-600 to-red-700 border-red-600 text-white shadow-sm";
                countClass = "bg-white/20 text-white";
              } else {
                chipClass = "bg-gradient-to-br from-text-primary to-text-secondary border-text-primary text-white shadow-sm";
                countClass = "bg-white/20 text-white";
              }
            } else if (isPendingChip && count > 0) {
              chipClass = "bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-300";
              countClass = "bg-amber-100 text-amber-800";
            }

            return (
              <Link
                key={filter.value}
                href={buildListHref({ status: filter.value, perPage, sort, dir, view })}
                prefetch={false}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-body font-medium rounded-xl border transition-all ${chipClass}`}
              >
                {filter.label}
                <span className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-semibold ${countClass}`}>
                  {count}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-2 w-full xl:w-auto">
          <UsersSortControl sort={sort} dir={dir} />
          <PerPageSelect value={perPage} />
        </div>
      </div>

      {/* Liste */}
      {clients.length === 0 ? (
        <div className="bg-bg-primary rounded-2xl border border-border shadow-sm py-16 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-5 bg-bg-secondary border border-border">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-text-muted">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>
            </svg>
          </div>
          <h3 className="font-heading text-xl font-bold text-text-primary mb-2">Aucun client trouvé</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {search
              ? `Aucun résultat pour « ${search} »${filterStatus === "ALL" ? "" : ` avec le statut « ${FILTERS.find(f => f.value === filterStatus)?.label ?? ""} »`}.`
              : filterStatus === "ALL"
                ? "Vous n'avez encore aucun client inscrit."
                : `Aucun client avec le statut « ${FILTERS.find(f => f.value === filterStatus)?.label ?? ""} » pour l'instant.`}
          </p>
          {(search || filterStatus !== "ALL") && (
            <Link href="/admin/clients" className="btn-ghost mt-6 inline-flex">
              ← Voir tous les clients
            </Link>
          )}
        </div>
      ) : view === "mails" ? (
        <MailsView
          clients={clients}
          totalFiltered={totalFiltered}
          page={page}
          perPage={perPage}
          mails={mails}
        />
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden lg:block bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-bg-secondary">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Client</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">
                      <SortableHeader label="Société · Contact" sortKey="company" currentSort={sort} currentDir={dir} filterStatus={filterStatus} perPage={perPage} />
                    </th>
                    <th className={`px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap ${ordersColumnActive ? "bg-slate-900/[0.04]" : ""}`}>
                      <SortableHeader label="Commandes" sortKey="orders" currentSort={sort} currentDir={dir} filterStatus={filterStatus} perPage={perPage} alsoActiveFor={["spent"]} />
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Statut</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">
                      <SortableHeader label="Activité" sortKey="login" currentSort={sort} currentDir={dir} filterStatus={filterStatus} perPage={perPage} />
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Panier</th>
                    <th className="px-5 py-3 text-right text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => {
                    const online = isOnline(c.lastSeenAt);
                    const isPending = c.status === "PENDING";
                    const isRejected = c.status === "REJECTED";
                    const inscription = formatShortDate(c.createdAt);
                    const gradient = avatarGradientFor(c.id);
                    const orderStats = stats.get(c.id) ?? EMPTY_CLIENT_STATS;
                    const businessNum = businessNumberLabel(c);
                    const cart = carts.get(c.id);
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-border last:border-0 transition-colors hover:bg-bg-secondary/60 ${
                          isPending ? "bg-gradient-to-r from-amber-50/70 to-transparent" : ""
                        }`}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`relative flex items-center justify-center w-10 h-10 rounded-xl text-white text-[13px] font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                              {initialsOf(c.firstName, c.lastName)}
                              {online && (
                                <span className="absolute -right-0.5 -bottom-0.5 flex w-3 h-3">
                                  <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
                                  <span className="relative w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-bg-primary" />
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-body font-semibold text-text-primary truncate">
                                {c.firstName} {c.lastName}
                              </p>
                              {isPending
                                ? <p className="text-[11.5px] font-body font-medium text-amber-700">Nouvelle demande</p>
                                : isRejected
                                  ? <p className="text-[11.5px] font-body text-text-muted">Compte refusé</p>
                                  : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 min-w-0">
                          <p className="text-[13.5px] font-body font-semibold text-text-primary truncate max-w-xs">
                            {c.company}
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="flex items-center gap-1.5 text-[11.5px] font-body text-text-muted min-w-0">
                              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted/80 shrink-0">Email :</span>
                              <span className="truncate max-w-xs text-text-secondary">{c.email}</span>
                            </p>
                            {businessNum && (
                              <p className="flex items-center gap-1.5 text-[11.5px] font-body text-text-muted">
                                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted/80 shrink-0">{businessNum.label} :</span>
                                <span className="font-mono tabular-nums text-text-secondary">{businessNum.value}</span>
                              </p>
                            )}
                            {c.vatNumber && (
                              <p className="flex items-center gap-1.5 text-[11.5px] font-body text-text-muted">
                                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted/80 shrink-0">TVA :</span>
                                <span className="font-mono tabular-nums text-text-secondary">{c.vatNumber}</span>
                              </p>
                            )}
                          </div>
                        </td>
                        <td className={`px-5 py-3.5 whitespace-nowrap ${ordersColumnActive ? "bg-slate-900/[0.02]" : ""}`}>
                          {orderStats.count === 0 ? (
                            <p className="text-[13px] font-body text-text-muted/50">—</p>
                          ) : (
                            <>
                              <p className="text-[15px] font-heading font-bold text-text-primary tabular-nums leading-none">
                                {orderStats.count}
                              </p>
                              <p className="text-[11px] font-body text-text-muted mt-1 tabular-nums">
                                {formatSpent(orderStats.spent)}
                              </p>
                            </>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`badge ${
                            c.status === "APPROVED" ? "badge-success" :
                            c.status === "PENDING" ? "badge-warning" :
                            "badge-error"
                          }`}>
                            {c.status === "APPROVED" ? "Approuvé" :
                             c.status === "PENDING" ? "En attente" :
                             "Rejeté"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {online ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-body font-medium text-emerald-700">
                              <span className="relative inline-flex w-2 h-2">
                                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
                                <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
                              </span>
                              En ligne
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-body text-text-muted">
                              <span className="w-2 h-2 rounded-full bg-text-muted/40" />
                              Hors ligne
                            </span>
                          )}
                          <p className={`text-[11px] font-body mt-0.5 ${online ? "text-text-secondary" : "text-text-muted"}`}>
                            {formatTimeAgo(c.lastSeenAt ?? c.lastLoginAt)}
                          </p>
                          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-body text-text-muted" title={`Inscrit le ${inscription.date} à ${inscription.time}`}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                            {inscription.date}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {cart ? (
                            <div className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 shrink-0">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <circle cx="9" cy="21" r="1" />
                                  <circle cx="20" cy="21" r="1" />
                                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                                </svg>
                              </span>
                              <div>
                                <p className="text-[13px] font-heading font-bold text-text-primary tabular-nums leading-none">
                                  {cart.itemCount} <span className="text-[10.5px] font-body font-medium text-text-muted uppercase tracking-[0.08em]">art.</span>
                                </p>
                                <p className="text-[11px] font-body text-text-muted mt-1 tabular-nums">
                                  {formatSpent(cart.total)}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[13px] font-body text-text-muted/50">—</p>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          {isPending ? (
                            <Link
                              href={`/admin/clients/${c.id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-text-primary to-text-secondary text-white text-xs font-body font-semibold shadow-sm hover:opacity-90 transition-opacity"
                            >
                              Examiner
                            </Link>
                          ) : (
                            <Link
                              href={`/admin/clients/${c.id}`}
                              className="inline-flex items-center gap-1 text-xs font-body font-medium text-text-secondary hover:text-text-primary transition-colors"
                            >
                              Voir
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12h14M13 5l7 7-7 7"/>
                              </svg>
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination totalItems={totalFiltered} perPage={perPage} currentPage={page} itemLabel="clients" />
          </div>

          {/* Mobile */}
          <div className="lg:hidden space-y-2.5">
            {clients.map((c) => {
              const online = isOnline(c.lastSeenAt);
              const isPending = c.status === "PENDING";
              const isRejected = c.status === "REJECTED";
              const gradient = avatarGradientFor(c.id);
              const orderStats = stats.get(c.id) ?? EMPTY_CLIENT_STATS;
              const businessNum = businessNumberLabel(c);
              const cart = carts.get(c.id);
              return (
                <Link
                  key={c.id}
                  href={`/admin/clients/${c.id}`}
                  className={`block rounded-2xl border p-4 shadow-sm transition-colors ${
                    isPending
                      ? "border-amber-200 bg-gradient-to-br from-amber-50 to-bg-primary"
                      : "border-border bg-bg-primary hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`relative flex items-center justify-center w-11 h-11 rounded-xl text-white text-sm font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                      {initialsOf(c.firstName, c.lastName)}
                      {online && (
                        <span className="absolute -right-0.5 -bottom-0.5 flex w-3 h-3">
                          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
                          <span className="relative w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-bg-primary" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[14px] font-body font-semibold text-text-primary truncate">
                            {c.firstName} {c.lastName}
                          </p>
                          <p className="text-[12px] font-body text-text-muted truncate">{c.company}</p>
                        </div>
                        <span className={`badge ${
                          c.status === "APPROVED" ? "badge-success" :
                          c.status === "PENDING" ? "badge-warning" :
                          "badge-error"
                        } shrink-0`}>
                          {c.status === "APPROVED" ? "Approuvé" :
                           c.status === "PENDING" ? "En attente" :
                           "Rejeté"}
                        </span>
                      </div>
                      <div className="mt-2 space-y-0.5 text-[11.5px] font-body text-text-muted">
                        <p className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted/80 shrink-0">Email :</span>
                          <span className="truncate text-text-secondary">{c.email}</span>
                        </p>
                        {businessNum && (
                          <p className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted/80 shrink-0">{businessNum.label} :</span>
                            <span className="font-mono tabular-nums text-text-secondary">{businessNum.value}</span>
                          </p>
                        )}
                        {c.vatNumber && (
                          <p className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted/80 shrink-0">TVA :</span>
                            <span className="font-mono tabular-nums text-text-secondary">{c.vatNumber}</span>
                          </p>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {orderStats.count > 0 && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-secondary border border-border text-[11.5px] font-body font-semibold text-text-secondary">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>
                            </svg>
                            {orderStats.count} commande{orderStats.count > 1 ? "s" : ""} · {formatSpent(orderStats.spent)}
                          </span>
                        )}
                        {cart && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11.5px] font-body font-semibold text-emerald-700">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="9" cy="21" r="1" />
                              <circle cx="20" cy="21" r="1" />
                              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                            </svg>
                            Panier : {cart.itemCount} art. · {formatSpent(cart.total)}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11.5px] font-body">
                        {online ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                            <span className="relative inline-flex w-2 h-2">
                              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
                              <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
                            </span>
                            En ligne · {formatTimeAgo(c.lastSeenAt ?? c.lastLoginAt)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-text-muted">
                            <span className="w-2 h-2 rounded-full bg-text-muted/40" />
                            {isRejected ? "Refusé" : `Hors ligne · ${formatTimeAgo(c.lastSeenAt ?? c.lastLoginAt)}`}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-text-muted">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          {new Date(c.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                      {isPending && (
                        <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-text-primary to-text-secondary text-white text-[12px] font-body font-semibold">
                          Examiner la demande
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M13 5l7 7-7 7"/>
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
            <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden">
              <Pagination totalItems={totalFiltered} perPage={perPage} currentPage={page} itemLabel="clients" />
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Admin cards data loader ────────────────────────────────────────────────

async function loadAdminCards(
  params: { mp?: string; q?: string },
  page: number,
  perPage: number,
) {
  const filter = (["PFS", "ANKORSTORE", "EFASHION", "FAIRE", "MICROSTORE", "PASSAGE"] as const).includes(params.mp as never)
    ? (params.mp as "PFS" | "ANKORSTORE" | "EFASHION" | "FAIRE" | "MICROSTORE" | "PASSAGE")
    : ("ALL" as const);
  const q = (params.q ?? "").trim();

  const marketplaceFilter: Prisma.AdminClientCardWhereInput =
    filter === "PFS"
      ? { hasPfs: true }
      : filter === "ANKORSTORE"
      ? { hasAnkorstore: true }
      : filter === "EFASHION"
      ? { hasEfashion: true }
      : filter === "FAIRE"
      ? { hasFaire: true }
      : filter === "MICROSTORE"
      ? { hasMicrostore: true }
      : filter === "PASSAGE"
      ? { hasPassage: true }
      : {};

  const searchFilter: Prisma.AdminClientCardWhereInput = q
    ? {
        OR: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { company: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
        ],
      }
    : {};

  const where: Prisma.AdminClientCardWhereInput = { AND: [marketplaceFilter, searchFilter] };

  const [
    cards,
    filteredCount,
    all,
    pfs,
    ankorstore,
    efashion,
    faire,
    microstore,
    passage,
  ] = await Promise.all([
    prisma.adminClientCard.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.adminClientCard.count({ where }),
    prisma.adminClientCard.count({ where: searchFilter }),
    prisma.adminClientCard.count({ where: { AND: [{ hasPfs: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasAnkorstore: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasEfashion: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasFaire: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasMicrostore: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasPassage: true }, searchFilter] } }),
  ]);

  return {
    cards: cards.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      company: c.company,
      siret: c.siret,
      vatNumber: c.vatNumber,
      email: c.email,
      phone: c.phone,
      website: c.website,
      addressLine: c.addressLine ?? c.address, // Fallback : legacy address si nouveau champ vide
      postalCode: c.postalCode,
      city: c.city,
      countryCode: c.countryCode,
      hasPfs: c.hasPfs,
      hasAnkorstore: c.hasAnkorstore,
      hasEfashion: c.hasEfashion,
      hasFaire: c.hasFaire,
      hasMicrostore: c.hasMicrostore,
      hasPassage: c.hasPassage,
      lastOrderAt: c.lastOrderAt?.toISOString() ?? null,
      lastMessageSentAt: c.lastMessageSentAt?.toISOString() ?? null,
      orderDiscountType: c.orderDiscountType,
      orderDiscountValue: c.orderDiscountValue ? c.orderDiscountValue.toString() : null,
      shippingFree: c.shippingFree,
      shippingDiscountType: c.shippingDiscountType,
      shippingDiscountValue: c.shippingDiscountValue ? c.shippingDiscountValue.toString() : null,
      note: c.note,
      pfsCustomerId: c.pfsCustomerId,
      importedFromMarketplace: c.importedFromMarketplace,
    })),
    filteredCount,
    filter,
    filterCounts: {
      ALL: all,
      PFS: pfs,
      ANKORSTORE: ankorstore,
      EFASHION: efashion,
      FAIRE: faire,
      MICROSTORE: microstore,
      PASSAGE: passage,
    },
    search: q,
  };
}
