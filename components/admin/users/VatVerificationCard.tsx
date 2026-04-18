"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Carte de vérification VIES — chargée en parallèle lorsque l'admin
 * consulte une demande d'inscription. Purement informatif :
 * l'admin garde la main sur la décision finale.
 */

interface ViesResult {
  valid: boolean;
  countryCode: string;
  vatNumber: string;
  name: string | null;
  address: string | null;
  requestDate: string | null;
  serviceError?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "result"; data: ViesResult };

export default function VatVerificationCard({ vatNumber }: { vatNumber: string | null }) {
  const [state, setState] = useState<State>(vatNumber ? { kind: "loading" } : { kind: "idle" });

  const check = useCallback(async (vat: string) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/admin/vies-check?vat=${encodeURIComponent(vat)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setState({
          kind: "error",
          message: (json && typeof json.error === "string" ? json.error : null) ?? `Erreur ${res.status}`,
        });
        return;
      }
      setState({ kind: "result", data: json as ViesResult });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Erreur réseau",
      });
    }
  }, []);

  useEffect(() => {
    if (vatNumber) void check(vatNumber);
  }, [vatNumber, check]);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-border table-header flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold text-text-primary">
            Vérification TVA intracommunautaire (VIES)
          </h2>
          <p className="text-xs text-text-muted font-body mt-0.5">
            Information issue de la base officielle de la Commission européenne. Décision finale laissée à l&apos;admin.
          </p>
        </div>
        {vatNumber && state.kind !== "loading" && (
          <button
            type="button"
            onClick={() => void check(vatNumber)}
            className="text-xs font-body font-medium text-text-secondary hover:text-text-primary transition-colors shrink-0"
          >
            ↻ Relancer
          </button>
        )}
      </div>

      <div className="p-5">
        {state.kind === "idle" && (
          <p className="text-sm text-text-muted font-body">
            Aucun numéro de TVA fourni à l&apos;inscription.
          </p>
        )}

        {state.kind === "loading" && (
          <div className="space-y-3" aria-live="polite" aria-busy="true">
            <div className="h-4 w-1/3 bg-bg-tertiary rounded animate-pulse" />
            <div className="h-4 w-2/3 bg-bg-tertiary rounded animate-pulse" />
            <div className="h-4 w-1/2 bg-bg-tertiary rounded animate-pulse" />
            <p className="text-xs text-text-muted font-body">Interrogation de VIES…</p>
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <span className="badge badge-error font-body shrink-0">Erreur</span>
              <p className="text-sm text-text-primary font-body">{state.message}</p>
            </div>
            {vatNumber && (
              <button
                type="button"
                onClick={() => void check(vatNumber)}
                className="text-xs font-body font-medium text-text-secondary hover:text-text-primary self-start"
              >
                Réessayer
              </button>
            )}
          </div>
        )}

        {state.kind === "result" && (
          <ResultView data={state.data} />
        )}
      </div>
    </div>
  );
}

function ResultView({ data }: { data: ViesResult }) {
  const fullVat = `${data.countryCode}${data.vatNumber}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {data.serviceError ? (
          <span className="badge badge-warning font-body">Service indisponible</span>
        ) : data.valid ? (
          <span className="badge badge-success font-body">Numéro valide</span>
        ) : (
          <span className="badge badge-error font-body">Numéro invalide</span>
        )}
        <span className="text-sm font-mono text-text-primary">{fullVat}</span>
      </div>

      {data.serviceError && (
        <p className="text-sm text-text-secondary font-body">{data.serviceError}</p>
      )}

      <div className="space-y-3">
        <Field label="Raison sociale (VIES)" value={data.name} />
        <Field label="Adresse (VIES)" value={data.address} multiline />
        <Field
          label="Date de la vérification"
          value={
            data.requestDate
              ? new Date(data.requestDate).toLocaleString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null
          }
        />
      </div>

      {data.valid && !data.serviceError && (
        <p className="text-xs text-text-muted font-body italic">
          Comparez les infos ci-dessus avec celles saisies par le client et le Kbis avant d&apos;approuver.
        </p>
      )}
    </div>
  );
}

function Field({ label, value, multiline }: { label: string; value: string | null; multiline?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
      <span className="text-xs font-body font-semibold text-text-muted uppercase tracking-wider sm:w-40 shrink-0 pt-0.5">
        {label}
      </span>
      {value ? (
        <span className={`text-sm text-text-primary font-body ${multiline ? "whitespace-pre-line" : ""}`}>
          {value}
        </span>
      ) : (
        <span className="text-sm text-text-muted font-body italic">Non communiqué</span>
      )}
    </div>
  );
}
