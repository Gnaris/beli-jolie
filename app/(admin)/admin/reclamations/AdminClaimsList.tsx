"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { getAdminClaims } from "@/app/actions/admin/claims";

type Claim = Awaited<ReturnType<typeof getAdminClaims>>[number];

const STATUS_BADGES: Record<string, { className: string; label: string }> = {
  OPEN: { className: "badge badge-info", label: "Ouverte" },
  IN_REVIEW: { className: "badge badge-warning", label: "En examen" },
  ACCEPTED: { className: "badge badge-success", label: "Acceptee" },
  REJECTED: { className: "badge badge-error", label: "Refusee" },
  RETURN_PENDING: { className: "badge badge-warning", label: "Retour" },
  RETURN_SHIPPED: { className: "badge badge-info", label: "Expedie" },
  RETURN_RECEIVED: { className: "badge badge-success", label: "Recu" },
  RESOLUTION_PENDING: { className: "badge badge-warning", label: "Resolution" },
  RESOLVED: { className: "badge badge-success", label: "Resolue" },
  CLOSED: { className: "badge badge-neutral", label: "Fermee" },
};

const FILTERS = [
  { key: "all", label: "Toutes" },
  { key: "OPEN", label: "Ouvertes" },
  { key: "IN_REVIEW", label: "En examen" },
  { key: "ACCEPTED", label: "Acceptees" },
  { key: "RESOLVED", label: "Resolues" },
  { key: "CLOSED", label: "Fermees" },
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
        <div className="space-y-2">
          {filtered.map((claim) => {
            const badge = STATUS_BADGES[claim.status] || { className: "badge badge-neutral", label: claim.status };
            return (
              <Link
                key={claim.id}
                href={`/admin/reclamations/${claim.id}`}
                className="block bg-bg-primary border border-border rounded-2xl p-4 hover:border-[#1A1A1A]/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-heading font-semibold text-text-primary">{claim.reference}</span>
                      <span className={badge.className}>{badge.label}</span>
                    </div>
                    <p className="text-sm text-text-muted font-body mt-1">
                      {claim.user.firstName} {claim.user.lastName}
                      {claim.user.company && ` (${claim.user.company})`}
                    </p>
                    {claim.order && (
                      <p className="text-xs text-text-muted font-body">Cmd {claim.order.orderNumber}</p>
                    )}
                  </div>
                  <span className="text-xs text-text-muted font-body whitespace-nowrap">
                    {new Date(claim.createdAt).toLocaleDateString("fr-FR")}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
