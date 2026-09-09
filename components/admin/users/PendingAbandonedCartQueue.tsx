"use client";

/**
 * Panneau « Prochaines relances programmées » de la page panier abandonné.
 *
 * Liste live de qui va recevoir quel mail et dans combien de temps. Chaque
 * ligne affiche : client, entreprise, stade à envoyer, date/heure exacte,
 * countdown live (tick 1s), aperçu panier (nb articles + total).
 *
 * Poll automatique toutes les 30 s pour capter les nouveaux jobs (paniers
 * modifiés depuis) sans nécessiter de refresh manuel.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  listPendingAbandonedCartJobs,
  type PendingAbandonedCartJobDTO,
} from "@/app/actions/admin/abandoned-cart";
import { formatCountdownDetailed } from "@/lib/abandoned-cart-config";

const PAGE_SIZE = 20;

interface Props {
  initialJobs: PendingAbandonedCartJobDTO[];
}

export default function PendingAbandonedCartQueue({ initialJobs }: Props) {
  const [jobs, setJobs] = useState(initialJobs);
  const [page, setPage] = useState(1);
  // Un seul tick à 1 s pour recalculer TOUS les countdowns visibles en même
  // temps — évite N setInterval indépendants (économie CPU + tous les timers
  // restent synchro).
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Rafraîchit la liste toutes les 30 s (nouveaux clients ajoutés, jobs
  // annulés par commande / opt-out, etc.).
  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        try {
          const fresh = await listPendingAbandonedCartJobs();
          setJobs(fresh);
        } catch {
          /* silent : on ré-essaye au prochain tick */
        }
      })();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Recale la page si la liste rétrécit (client termine, opt-out, etc.).
  const totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const visibleJobs = jobs.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-heading text-sm font-bold text-text-primary">
            Prochaines relances programmées
          </h2>
          <p className="text-xs font-body text-text-muted mt-0.5">
            {jobs.length === 0
              ? "Aucune relance en attente — les compteurs se lancent dès qu'un client approuvé ajoute un article au panier."
              : `${jobs.length} client${jobs.length > 1 ? "s" : ""} en attente${totalPages > 1 ? ` · page ${page}/${totalPages}` : ""}. Actualisation toutes les 30 s.`}
          </p>
        </div>
        {jobs.length > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-body font-bold uppercase tracking-[0.14em] bg-amber-100 text-amber-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            live
          </span>
        )}
      </div>

      {jobs.length === 0 ? null : (
        <>
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-bg-secondary">
                <tr className="border-b border-border">
                  <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">
                    Client
                  </th>
                  <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">
                    Stade à envoyer
                  </th>
                  <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">
                    Dans
                  </th>
                  <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">
                    Date d&apos;envoi
                  </th>
                  <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">
                    Panier
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((j) => (
                  <JobRow key={j.jobId} job={j} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-border">
            {visibleJobs.map((j) => (
              <JobCard key={j.jobId} job={j} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-border flex items-center justify-between text-[12px] font-body">
              <span className="text-text-muted">
                Affichage {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, jobs.length)} sur {jobs.length}
              </span>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-border bg-bg-primary text-text-primary text-[11px] font-semibold hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Précédent
                </button>
                <span className="px-3 py-1.5 text-[11px] font-body font-semibold text-text-primary tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-border bg-bg-primary text-text-primary text-[11px] font-semibold hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Suivant →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function JobRow({ job }: { job: PendingAbandonedCartJobDTO }) {
  // Le tick 1s vit dans le parent (ré-évaluation collective). Ici on relit
  // juste Date.now() à chaque render.
  const target = new Date(job.nextStageAt).getTime();
  const seconds = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const sendDate = new Date(job.nextStageAt);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-bg-secondary/60 transition-colors">
      <td className="px-5 py-3.5 min-w-0">
        <Link
          href={`/admin/clients/${job.userId}`}
          className="block group"
        >
          <p className="text-sm font-body font-semibold text-text-primary group-hover:text-amber-800 truncate">
            {job.userLabel}
          </p>
          {job.userCompany && (
            <p className="text-[11px] font-body text-text-muted truncate">
              {job.userCompany}
            </p>
          )}
          <p className="text-[11px] font-body text-text-muted truncate">
            {job.userEmail}
          </p>
        </Link>
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap">
        <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-[11px] font-body font-bold bg-gradient-to-br from-amber-100 to-amber-200 text-amber-800 border border-amber-300">
          Stade {job.nextStageIndex}
        </span>
        {job.currentStage > 0 && (
          <p className="text-[10.5px] font-body text-text-muted mt-1">
            (Stade {job.currentStage} déjà envoyé)
          </p>
        )}
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap">
        <p className="text-[13px] font-body font-semibold text-amber-800 tabular-nums leading-none">
          {seconds === 0 ? "envoi imminent…" : formatCountdownDetailed(seconds)}
        </p>
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap">
        <p className="text-[12px] font-body text-text-primary tabular-nums leading-none">
          {sendDate.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
        <p className="text-[11px] font-body text-text-muted mt-1 tabular-nums">
          {sendDate.toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap">
        <p className="text-[13px] font-heading font-bold text-text-primary tabular-nums leading-none">
          {job.cartItemCount} <span className="text-[10.5px] font-body font-medium text-text-muted uppercase tracking-[0.08em]">art.</span>
        </p>
        <p className="text-[11px] font-body text-text-muted mt-1 tabular-nums">
          {(job.cartTotalCents / 100).toLocaleString("fr-FR", {
            style: "currency",
            currency: "EUR",
          })}
        </p>
      </td>
    </tr>
  );
}

function JobCard({ job }: { job: PendingAbandonedCartJobDTO }) {
  const target = new Date(job.nextStageAt).getTime();
  const seconds = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const sendDate = new Date(job.nextStageAt);

  return (
    <Link
      href={`/admin/clients/${job.userId}`}
      className="block p-4 hover:bg-bg-secondary/60 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-body font-semibold text-text-primary truncate">
            {job.userLabel}
          </p>
          {job.userCompany && (
            <p className="text-[11.5px] font-body text-text-muted truncate">
              {job.userCompany}
            </p>
          )}
          <p className="text-[11.5px] font-body text-text-muted truncate">
            {job.userEmail}
          </p>
        </div>
        <span className="shrink-0 inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-[10.5px] font-body font-bold bg-gradient-to-br from-amber-100 to-amber-200 text-amber-800 border border-amber-300">
          Stade {job.nextStageIndex}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <p className="text-[10px] font-body font-bold text-amber-800 uppercase tracking-[0.1em]">
            Dans
          </p>
          <p className="text-[13px] font-body font-semibold text-amber-900 mt-0.5 tabular-nums">
            {seconds === 0 ? "imminent" : formatCountdownDetailed(seconds)}
          </p>
        </div>
        <div className="rounded-lg bg-bg-secondary border border-border px-3 py-2">
          <p className="text-[10px] font-body font-bold text-text-muted uppercase tracking-[0.1em]">
            Panier
          </p>
          <p className="text-[13px] font-heading font-bold text-text-primary mt-0.5 tabular-nums">
            {job.cartItemCount} art. ·{" "}
            {(job.cartTotalCents / 100).toLocaleString("fr-FR", {
              style: "currency",
              currency: "EUR",
            })}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[10.5px] font-body text-text-muted">
        Envoi prévu le{" "}
        {sendDate.toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
        })}{" "}
        à{" "}
        {sendDate.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        {job.currentStage > 0 && ` — Stade ${job.currentStage} déjà envoyé`}
      </p>
    </Link>
  );
}
