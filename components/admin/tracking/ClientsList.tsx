"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ClientData {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  email: string;
  siret: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  lastSeenAt: string | null;
}

const STATUS_CONFIG = {
  PENDING:  { label: "En attente", className: "badge badge-warning" },
  APPROVED: { label: "Approuvé",   className: "badge badge-success" },
  REJECTED: { label: "Rejeté",     className: "badge badge-error" },
} as const;

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

function formatLastSeen(lastSeenAt: string | null, onlineIds: Set<string>, clientId: string): string | null {
  if (onlineIds.has(clientId)) return "En ligne";
  if (!lastSeenAt) return null;
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  if (diff < ONLINE_THRESHOLD_MS) return "En ligne";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

export default function ClientsList({ clients }: { clients: ClientData[] }) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/admin/live-clients");
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "update" && Array.isArray(data.clients)) {
          setOnlineIds(new Set(data.clients.map((c: { id: string }) => c.id)));
        }
      } catch { /* skip */ }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  if (clients.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="w-14 h-14 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        </div>
        <p className="font-heading text-sm font-semibold text-text-primary mb-1">Aucun client</p>
        <p className="text-sm text-text-muted font-body">
          Aucun client dans cette categorie.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {clients.map((client) => {
        const statusCfg = STATUS_CONFIG[client.status];
        const date = new Date(client.createdAt).toLocaleDateString("fr-FR", {
          day: "2-digit", month: "short", year: "numeric",
        });
        const initials = `${client.firstName[0] ?? ""}${client.lastName[0] ?? ""}`.toUpperCase();
        const isOnline = onlineIds.has(client.id);
        const lastSeenLabel = formatLastSeen(client.lastSeenAt, onlineIds, client.id);

        return (
          <Link
            key={client.id}
            href={`/admin/utilisateurs/${client.id}`}
            className="card card-hover block p-4 sm:p-5 group"
          >
            <div className="flex items-center gap-4">
              {/* Avatar with online indicator */}
              <div className="relative shrink-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  client.status === "PENDING"
                    ? "bg-[#FEF3C7]"
                    : client.status === "REJECTED"
                      ? "bg-[#FEE2E2]"
                      : "bg-bg-tertiary"
                }`}>
                  <span className={`text-xs font-bold font-body ${
                    client.status === "PENDING"
                      ? "text-[#92400E]"
                      : client.status === "REJECTED"
                        ? "text-[#991B1B]"
                        : "text-text-secondary"
                  }`}>
                    {initials}
                  </span>
                </div>
                {isOnline && (
                  <span className="absolute -bottom-0.5 -right-0.5 block h-3 w-3 rounded-full bg-[#22C55E] ring-2 ring-white" />
                )}
              </div>

              {/* Infos principales */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-body font-semibold text-text-primary text-sm group-hover:text-text-secondary transition-colors">
                    {client.firstName} {client.lastName}
                  </p>
                  <span className={statusCfg.className}>
                    {statusCfg.label}
                  </span>
                </div>
                <p className="text-sm text-text-secondary font-body truncate mt-0.5">
                  {client.company}
                </p>
              </div>

              {/* Details desktop */}
              <div className="hidden md:flex items-center gap-6 shrink-0">
                {lastSeenLabel && (
                  <div className="text-right">
                    <p className="text-xs text-text-muted font-body uppercase tracking-wider">Activite</p>
                    <p className={`text-sm font-body ${isOnline ? "text-[#22C55E] font-medium" : "text-text-secondary"}`}>
                      {lastSeenLabel}
                    </p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-xs text-text-muted font-body uppercase tracking-wider">Email</p>
                  <p className="text-sm text-text-secondary font-body truncate max-w-[200px]">{client.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-text-muted font-body uppercase tracking-wider">SIRET</p>
                  <p className="text-sm text-text-secondary font-mono">{client.siret}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-text-muted font-body uppercase tracking-wider">Inscrit le</p>
                  <p className="text-sm text-text-secondary font-body">{date}</p>
                </div>
              </div>

              {/* Arrow */}
              <svg className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>

            {/* Mobile details */}
            <div className="md:hidden flex flex-wrap gap-x-4 gap-y-1 mt-3 pl-14 text-xs text-text-muted font-body">
              <span>{client.email}</span>
              <span>{date}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
