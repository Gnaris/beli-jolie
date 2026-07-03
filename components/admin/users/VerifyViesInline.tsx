"use client";

import { useState } from "react";

/**
 * Bouton VIES + affichage inline du résultat, à placer à côté du champ N° TVA.
 * Le résultat initial est chargé depuis les valeurs stockées en DB.
 */

interface ViesResult {
  valid: boolean;
  name: string | null;
  address: string | null;
  requestDate: string | null;
  serviceError?: string;
}

interface Props {
  vatNumber: string | null;
  userId: string;
  initial: {
    viesValid: boolean | null;
    viesName: string | null;
    viesAddress: string | null;
    viesRequestDate: string | null;
    viesError: string | null;
  } | null;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: ViesResult };

function initialFromDb(initial: Props["initial"]): State {
  if (!initial) return { kind: "idle" };
  if (initial.viesValid === true) {
    return {
      kind: "ok",
      data: {
        valid: true,
        name: initial.viesName,
        address: initial.viesAddress,
        requestDate: initial.viesRequestDate,
      },
    };
  }
  if (initial.viesError) {
    return { kind: "error", message: initial.viesError };
  }
  if (initial.viesValid === false) {
    return {
      kind: "ok",
      data: {
        valid: false,
        name: initial.viesName,
        address: initial.viesAddress,
        requestDate: initial.viesRequestDate,
      },
    };
  }
  return { kind: "idle" };
}

export default function VerifyViesInline({ vatNumber, userId, initial }: Props) {
  const [state, setState] = useState<State>(() => initialFromDb(initial));

  async function verify() {
    if (!vatNumber) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/admin/vies-check?vat=${encodeURIComponent(vatNumber)}&userId=${encodeURIComponent(userId)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setState({
          kind: "error",
          message: json?.error ?? `Erreur ${res.status}`,
        });
        return;
      }
      setState({
        kind: "ok",
        data: {
          valid: json.valid,
          name: json.name,
          address: json.address,
          requestDate: json.requestDate,
          serviceError: json.serviceError,
        },
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Erreur réseau",
      });
    }
  }

  if (!vatNumber) {
    return (
      <p className="text-[11px] text-text-muted italic mt-1">Aucun n° TVA fourni à l&apos;inscription.</p>
    );
  }

  const busy = state.kind === "loading";

  return (
    <>
      {/* Ligne du haut : n° TVA en mono + pastille + bouton */}
      <div className="flex flex-wrap items-center gap-2 mt-0.5">
        <span className="font-mono text-sm text-text-primary">{vatNumber}</span>

        {state.kind === "ok" && !state.data.serviceError && (
          state.data.valid
            ? <span className="badge badge-success text-[10px]">Valide</span>
            : <span className="badge badge-error text-[10px]">Invalide</span>
        )}
        {state.kind === "ok" && state.data.serviceError && (
          <span className="badge badge-warning text-[10px]">Service indisponible</span>
        )}
        {state.kind === "error" && (
          <span className="badge badge-warning text-[10px]">Échec</span>
        )}
        {state.kind === "loading" && (
          <span className="text-[11px] text-text-muted italic">Vérification…</span>
        )}

        <button
          type="button"
          onClick={verify}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {state.kind === "idle" ? "Vérifier VIES" : "Revérifier"}
        </button>
      </div>

      {/* Ligne du bas : détail court */}
      {state.kind === "ok" && (state.data.name || state.data.address) && (
        <p className="text-[11px] text-text-muted mt-1 leading-snug">
          {state.data.name && <span className="text-text-secondary font-medium">{state.data.name}</span>}
          {state.data.name && state.data.address && <span> — </span>}
          {state.data.address}
          {state.data.requestDate && (
            <span className="text-text-muted"> · Vérifié le {new Date(state.data.requestDate).toLocaleString("fr-FR", {
              day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
            })}</span>
          )}
        </p>
      )}
      {state.kind === "error" && (
        <p className="text-[11px] text-text-muted mt-1">{state.message}</p>
      )}
    </>
  );
}
