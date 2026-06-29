import React from "react";
import { formatRelativeDate } from "@/lib/format-date";

interface Props {
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
}

function wasMeaningfullyUpdated(createdAt: string, updatedAt: string): boolean {
  const c = new Date(createdAt).getTime();
  const u = new Date(updatedAt).getTime();
  return u - c > 60_000; // > 1 min
}

const longFmt = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function DateCell({ createdAt, updatedAt, lastRefreshedAt }: Props) {
  const showUpdated = wasMeaningfullyUpdated(createdAt, updatedAt);
  return (
    <div className="flex flex-col gap-0.5 text-[11px] leading-tight">
      <span className="inline-flex items-center gap-1.5 text-text-secondary font-medium" title={`Créé le ${longFmt(createdAt)}`}>
        <span aria-label="Créé" className="w-3.5 h-3.5 text-[10px] flex items-center justify-center text-[#71717a] opacity-75">＋</span>
        <span className="tabular-nums">{formatRelativeDate(createdAt)}</span>
      </span>
      {showUpdated && (
        <span className="inline-flex items-center gap-1.5 text-text-secondary font-medium" title={`Modifié le ${longFmt(updatedAt)}`}>
          <span aria-label="Modifié" className="w-3.5 h-3.5 text-[10px] flex items-center justify-center text-[#2563eb] opacity-75">✎</span>
          <span className="tabular-nums">{formatRelativeDate(updatedAt)}</span>
        </span>
      )}
      {lastRefreshedAt && (
        <span className="inline-flex items-center gap-1.5 text-text-secondary font-medium" title={`Rafraîchi le ${longFmt(lastRefreshedAt)}`}>
          <span aria-label="Rafraîchi" className="w-3.5 h-3.5 text-[10px] flex items-center justify-center text-[#16a34a] opacity-75">↻</span>
          <span className="tabular-nums">{formatRelativeDate(lastRefreshedAt)}</span>
        </span>
      )}
    </div>
  );
}
