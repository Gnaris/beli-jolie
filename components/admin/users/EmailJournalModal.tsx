"use client";

/**
 * Modale « Journal des emails » d'un client.
 * Ouverte depuis <EmailJournalButton> dans /admin/utilisateurs?view=mails.
 *
 * Affiche la liste paginée + filtres (type / statut / période).
 * Clic sur une ligne → ouvre <EmailDetailModal> avec le contenu HTML.
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  listUserEmailJournal,
  type EmailJournalRow,
  type EmailJournalFilters,
} from "@/app/actions/admin/email-journal";
import {
  EMAIL_SCENARIOS_LIST,
  getScenarioLabel,
} from "@/lib/email-scenarios";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";

const EmailDetailModal = lazy(() => import("./EmailDetailModal"));

interface Props {
  userId: string;
  userLabel: string;
  userEmail: string;
  onClose: () => void;
}

interface Stats {
  total: number;
  sent: number;
  failed: number;
  lastSentAt: string | null;
}

const PAGE_SIZE = 25;

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "il y a quelques secondes";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const j = Math.floor(h / 24);
  return `il y a ${j}j`;
}

export default function EmailJournalModal({
  userId,
  userLabel,
  userEmail,
  onClose,
}: Props) {
  const [rows, setRows] = useState<EmailJournalRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [scenarioKey, setScenarioKey] = useState<string | null>(null);
  const [status, setStatus] = useState<"SENT" | "FAILED" | null>(null);
  const [windowDays, setWindowDays] = useState<number | null>(30);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => {
    startLoading(async () => {
      const filters: EmailJournalFilters = {
        scenarioKey,
        status,
        windowDays,
        page,
        pageSize: PAGE_SIZE,
      };
      const res = await listUserEmailJournal(userId, filters);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setError(null);
      setRows(res.rows);
      setStats(res.stats);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    });
  }, [userId, scenarioKey, status, windowDays, page]);

  useEffect(() => { load(); }, [load]);

  // ESC pour fermer + verrou scroll body
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailId) setDetailId(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [detailId, onClose]);

  const scenarioOptions: SelectOption[] = useMemo(
    () => [
      { value: "", label: "Tous les types" },
      ...EMAIL_SCENARIOS_LIST.map((s) => ({ value: s.key, label: s.label })),
    ],
    []
  );
  const statusOptions: SelectOption[] = [
    { value: "", label: "Tous les statuts" },
    { value: "SENT", label: "Envoyés" },
    { value: "FAILED", label: "Échecs" },
  ];
  const windowOptions: SelectOption[] = [
    { value: "7", label: "7 derniers jours" },
    { value: "30", label: "30 derniers jours" },
    { value: "90", label: "90 derniers jours" },
    { value: "", label: "Tout l'historique" },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="bg-bg-primary rounded-2xl shadow-2xl w-full max-w-6xl max-h-[95vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <header className="flex items-start justify-between px-8 py-6 border-b border-border">
            <div className="min-w-0">
              <h2 className="text-xl font-heading font-bold text-text-primary">
                Journal des emails
              </h2>
              <p className="text-sm text-text-muted truncate mt-1">
                {userLabel} · {userEmail}
                {stats && ` · ${stats.total} mail${stats.total > 1 ? "s" : ""}`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-text-muted hover:text-text-primary text-3xl leading-none w-10 h-10 flex items-center justify-center shrink-0"
              aria-label="Fermer"
            >
              ×
            </button>
          </header>

          {/* Récap chiffres */}
          {stats && (
            <div className="grid grid-cols-4 gap-4 px-8 pt-6">
              <div className="rounded-xl border border-border bg-bg-secondary px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted">Total</p>
                <p className="text-2xl font-heading font-bold text-text-primary mt-1">{stats.total}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">Envoyés</p>
                <p className="text-2xl font-heading font-bold text-emerald-700 mt-1">{stats.sent}</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-rose-700">Échecs</p>
                <p className="text-2xl font-heading font-bold text-rose-700 mt-1">{stats.failed}</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-secondary px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted">Dernier envoi</p>
                <p className="text-base font-heading font-semibold text-text-primary mt-1">
                  {formatRelative(stats.lastSentAt)}
                </p>
              </div>
            </div>
          )}

          {/* Filtres */}
          <div className="flex flex-wrap gap-3 px-8 py-5 border-b border-border">
            <div className="min-w-[180px]">
              <CustomSelect
                value={scenarioKey ?? ""}
                onChange={(v) => {
                  setScenarioKey(v || null);
                  setPage(1);
                }}
                options={scenarioOptions}
                aria-label="Filtrer par type"
              />
            </div>
            <div className="min-w-[160px]">
              <CustomSelect
                value={status ?? ""}
                onChange={(v) => {
                  setStatus((v as "SENT" | "FAILED") || null);
                  setPage(1);
                }}
                options={statusOptions}
                aria-label="Filtrer par statut"
              />
            </div>
            <div className="min-w-[180px]">
              <CustomSelect
                value={windowDays === null ? "" : String(windowDays)}
                onChange={(v) => {
                  setWindowDays(v === "" ? null : Number(v));
                  setPage(1);
                }}
                options={windowOptions}
                aria-label="Filtrer par période"
              />
            </div>
          </div>

          {/* Tableau */}
          <div className="flex-1 overflow-auto">
            {error && (
              <div className="px-8 py-5 text-sm text-rose-700 bg-rose-50 border-b border-rose-200">
                {error}
              </div>
            )}

            {loading && rows.length === 0 && (
              <div className="px-8 py-12 text-center text-text-muted text-sm">Chargement…</div>
            )}

            {!loading && rows.length === 0 && !error && (
              <div className="px-8 py-12 text-center text-text-muted text-sm">
                Aucun email trouvé pour ces filtres.
              </div>
            )}

            {rows.length > 0 && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-primary border-b border-border">
                  <tr className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    <th className="text-left px-8 py-3.5 font-semibold">Date &amp; heure</th>
                    <th className="text-left px-8 py-3.5 font-semibold">Type</th>
                    <th className="text-left px-8 py-3.5 font-semibold">Sujet</th>
                    <th className="text-left px-8 py-3.5 font-semibold">Statut</th>
                    <th className="text-right px-8 py-3.5 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const dt = formatDateTime(row.sentAt);
                    const isFail = row.status === "FAILED";
                    return (
                      <tr
                        key={row.id}
                        className={isFail ? "bg-rose-50/40" : ""}
                      >
                        <td className="px-8 py-4 whitespace-nowrap text-text-secondary">
                          <div className="font-medium text-text-primary">{dt.date}</div>
                          <div className="text-xs text-text-muted">{dt.time}</div>
                        </td>
                        <td className="px-8 py-4 text-left">
                          <span className="inline-flex items-center text-xs px-2.5 py-1 rounded bg-bg-secondary text-text-primary border border-border">
                            {getScenarioLabel(row.scenarioKey)}
                          </span>
                          {row.isResend && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600" title="Renvoi manuel">
                              renvoi
                            </span>
                          )}
                        </td>
                        <td className="px-8 py-4 text-left text-text-primary max-w-md truncate" title={row.subject}>
                          {row.subject}
                        </td>
                        <td className="px-8 py-4 text-left whitespace-nowrap">
                          {isFail ? (
                            <span className="inline-flex items-center text-xs px-3 py-1 rounded-full bg-rose-100 text-rose-700 font-medium">
                              ❌ Échec
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-xs px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                              ✅ Envoyé
                            </span>
                          )}
                        </td>
                        <td className="px-8 py-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDetailId(row.id)}
                            className="text-xs px-2.5 h-7 rounded bg-bg-primary border border-border text-text-primary hover:bg-bg-secondary transition-colors"
                          >
                            Voir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer + pagination */}
          {totalPages > 1 && (
            <footer className="flex items-center justify-between px-8 py-5 border-t border-border text-sm text-text-muted">
              <div>
                Page {page} sur {totalPages} · {total} mail{total > 1 ? "s" : ""}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                  className="text-xs px-2.5 h-7 rounded bg-bg-primary border border-border text-text-primary hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ‹ Précédent
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || loading}
                  className="text-xs px-2.5 h-7 rounded bg-bg-primary border border-border text-text-primary hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Suivant ›
                </button>
              </div>
            </footer>
          )}
        </div>
      </div>

      {detailId && (
        <Suspense fallback={null}>
          <EmailDetailModal
            emailSendId={detailId}
            onClose={() => setDetailId(null)}
            onResent={() => {
              setDetailId(null);
              load();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
