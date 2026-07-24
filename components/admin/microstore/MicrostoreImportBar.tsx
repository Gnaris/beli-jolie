"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { importMicrostoreOrders } from "@/app/actions/admin/microstore-orders";
import { useToast } from "@/components/ui/Toast";

interface Props {
  defaultFromDate: string; // YYYY-MM-DD
  defaultToDate: string;
}

function todayYmd(): string {
  return new Date().toISOString().substring(0, 10);
}

export default function MicrostoreImportBar({ defaultFromDate, defaultToDate }: Props) {
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const [lastResult, setLastResult] = useState<{
    scanned: number;
    created: number;
    updated: number;
    errors: number;
  } | null>(null);

  const handleImport = () => {
    startTransition(async () => {
      const res = await importMicrostoreOrders({ fromDate, toDate });
      if (res.sessionExpired) {
        toast.error(
          "Session Microstore expirée",
          "Reconnectez-vous via QR code dans Paramètres > Microstore.",
        );
        return;
      }
      if (!res.success) {
        toast.error("Erreur import Microstore", res.error);
        return;
      }
      const r = res.result!;
      setLastResult({
        scanned: r.scanned,
        created: r.created,
        updated: r.updated,
        errors: r.errors.length,
      });
      const msg =
        r.created === 0 && r.updated === 0
          ? "Aucune commande nouvelle."
          : `${r.created} nouvelle${r.created > 1 ? "s" : ""} · ${r.updated} mise${r.updated > 1 ? "s" : ""} à jour`;
      if (r.errors.length > 0) {
        toast.warning(
          `Import terminé : ${msg}`,
          `${r.errors.length} erreur${r.errors.length > 1 ? "s" : ""} — voir les logs.`,
        );
      } else {
        toast.success("Import Microstore terminé", msg);
      }
    });
  };

  const quickRanges = [
    { label: "7 derniers jours", from: daysAgo(7), to: todayYmd() },
    { label: "30 derniers jours", from: daysAgo(30), to: todayYmd() },
    { label: "90 derniers jours", from: daysAgo(90), to: todayYmd() },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-bg-primary shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Importer les commandes Microstore
            </h2>
            <p className="text-xs text-text-muted mt-0.5 font-body">
              Récupère la liste et les détails complets (client + articles) sur la plage choisie.
            </p>
          </div>
          <Link
            href="/admin/parametres/microstore"
            className="text-xs text-text-muted hover:text-text-primary font-body"
          >
            Paramètres →
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
          <label className="block">
            <span className="text-[11px] font-body font-semibold uppercase tracking-wider text-text-muted">
              Du
            </span>
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 w-full h-11 px-3 rounded-xl border border-border bg-bg-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-body font-semibold uppercase tracking-wider text-text-muted">
              Au
            </span>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              max={todayYmd()}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1 w-full h-11 px-3 rounded-xl border border-border bg-bg-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15"
            />
          </label>
          <button
            type="button"
            onClick={handleImport}
            disabled={pending}
            className="sm:self-end h-11 px-6 rounded-xl bg-text-primary text-text-inverse text-sm font-heading font-bold hover:bg-text-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
          >
            {pending ? (
              <>
                <span className="inline-block w-4 h-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                Import…
              </>
            ) : (
              "Importer"
            )}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {quickRanges.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => {
                setFromDate(r.from);
                setToDate(r.to);
              }}
              disabled={pending}
              className="h-8 px-3 rounded-lg border border-border bg-bg-secondary text-text-secondary text-xs font-body hover:bg-bg-tertiary transition-colors disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
        </div>

        {lastResult && (
          <div className="mt-4 grid grid-cols-4 gap-3 p-4 rounded-xl bg-bg-secondary/50 border border-border-light">
            <Stat label="Scannées" value={lastResult.scanned} />
            <Stat label="Nouvelles" value={lastResult.created} tone="ok" />
            <Stat label="Mises à jour" value={lastResult.updated} />
            <Stat
              label="Erreurs"
              value={lastResult.errors}
              tone={lastResult.errors > 0 ? "warn" : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-text-primary";
  return (
    <div>
      <div className={`font-heading text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-body">{label}</div>
    </div>
  );
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().substring(0, 10);
}
