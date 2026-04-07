"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { getAdminClaims } from "@/app/actions/admin/claims";

type Claim = Awaited<ReturnType<typeof getAdminClaims>>[number];

const STATUS_BADGES: Record<string, { className: string; label: string }> = {
  OPEN: { className: "badge badge-info", label: "Ouverte" },
  IN_REVIEW: { className: "badge badge-warning", label: "En examen" },
  ACCEPTED: { className: "badge badge-success", label: "Acceptée" },
  REJECTED: { className: "badge badge-error", label: "Refusée" },
  RETURN_PENDING: { className: "badge badge-warning", label: "Retour" },
  RETURN_SHIPPED: { className: "badge badge-info", label: "Expédié" },
  RETURN_RECEIVED: { className: "badge badge-success", label: "Reçu" },
  RESOLUTION_PENDING: { className: "badge badge-warning", label: "Résolution" },
  RESOLVED: { className: "badge badge-success", label: "Résolue" },
  CLOSED: { className: "badge badge-neutral", label: "Fermée" },
};

const FILTERS = [
  { key: "all", label: "Toutes" },
  { key: "OPEN", label: "Ouvertes" },
  { key: "IN_REVIEW", label: "En examen" },
  { key: "ACCEPTED", label: "Acceptées" },
  { key: "RESOLVED", label: "Résolues" },
  { key: "CLOSED", label: "Fermées" },
];

export default function AdminClaimsList({ initialClaims }: { initialClaims: Claim[] }) {
  const [claims, setClaims] = useState(initialClaims);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleFilter(f: string) {
    setFilter(f);
    startTransition(async () => {
      const data = await getAdminClaims(f);
      setClaims(data);
    });
  }

  const filtered = search
    ? claims.filter((c) => {
        const s = search.toLowerCase();
        return (
          c.reference.toLowerCase().includes(s) ||
          c.user.firstName.toLowerCase().includes(s) ||
          c.user.lastName.toLowerCase().includes(s) ||
          (c.user.company || "").toLowerCase().includes(s)
        );
      })
    : claims;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-bg-secondary rounded-lg p-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => handleFilter(f.key)}
              className={`px-3 py-1.5 text-sm font-body rounded-md transition-colors whitespace-nowrap ${
                filter === f.key
                  ? "bg-bg-primary text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher..."
          className="border border-border bg-bg-primary px-3 py-1.5 text-sm rounded-lg focus:outline-none focus:border-[#1A1A1A] text-text-primary font-body w-64"
        />
      </div>

      {isPending ? (
        <p className="text-sm text-text-muted font-body py-8 text-center">Chargement...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center">
          <p className="text-text-muted font-body">Aucune reclamation.</p>
        </div>
      ) : (
        <div className="border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Référence</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Client</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Commande</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Statut</th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((claim) => {
                  const badge = STATUS_BADGES[claim.status] || { className: "badge badge-neutral", label: claim.status };
                  return (
                    <tr key={claim.id} className="hover:bg-bg-secondary/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/admin/reclamations/${claim.id}`} className="font-heading font-semibold text-text-primary hover:underline">
                          {claim.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-text-primary">
                          {claim.user.firstName} {claim.user.lastName}
                        </span>
                        {claim.user.company && (
                          <span className="text-xs text-text-muted ml-1">({claim.user.company})</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {claim.order ? claim.order.orderNumber : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={badge.className}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-text-muted whitespace-nowrap">
                        {new Date(claim.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
