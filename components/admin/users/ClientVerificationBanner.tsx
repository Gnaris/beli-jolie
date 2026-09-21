"use client";

import { useEffect, useRef, useState } from "react";
import type { UserStatus } from "@prisma/client";

interface SiretPayload {
  found: boolean;
  siret: string;
  companyName: string | null;
  address: string | null;
  activity: string | null;
  activeStatus: "active" | "closed" | null;
  creationDate: string | null;
  requestDate: string;
  serviceError?: string;
}

interface ViesPayload {
  valid: boolean;
  countryCode?: string;
  vatNumber?: string;
  name: string | null;
  address: string | null;
  requestDate: string | null;
  serviceError?: string;
}

type SiretState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: SiretPayload };

type ViesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: ViesPayload };

interface Props {
  userId: string;
  status: UserStatus;
  siret: string | null;
  vatNumber: string | null;
  addressCountry: string | null;
  viesInitial: {
    valid: boolean | null;
    name: string | null;
    address: string | null;
    requestDate: string | null;
    error: string | null;
  } | null;
}

function viesInitialToState(initial: Props["viesInitial"]): ViesState {
  if (!initial) return { kind: "idle" };
  if (initial.error && initial.valid === null) {
    return { kind: "error", message: initial.error };
  }
  if (initial.valid !== null) {
    return {
      kind: "ok",
      data: {
        valid: initial.valid,
        name: initial.name,
        address: initial.address,
        requestDate: initial.requestDate,
        serviceError: initial.error ?? undefined,
      },
    };
  }
  return { kind: "idle" };
}

export default function ClientVerificationBanner({
  userId,
  status,
  siret,
  vatNumber,
  addressCountry,
  viesInitial,
}: Props) {
  const isPending = status === "PENDING";
  const isFrench = (addressCountry ?? "").toUpperCase() === "FR";
  const hasSiret = !!siret && siret.replace(/\D/g, "").length === 14;
  const canCheckSiret = isFrench && hasSiret;
  const canCheckVies = !!vatNumber && vatNumber.trim().length > 0;

  const [siretState, setSiretState] = useState<SiretState>({ kind: "idle" });
  const [viesState, setViesState] = useState<ViesState>(() => viesInitialToState(viesInitial));

  const autoRan = useRef(false);

  async function runSiret() {
    if (!siret) return;
    setSiretState({ kind: "loading" });
    try {
      const res = await fetch(`/api/admin/siret-check?siret=${encodeURIComponent(siret)}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as (SiretPayload & { error?: string }) | null;
      if (!res.ok || !json) {
        setSiretState({ kind: "error", message: json?.error ?? `Erreur ${res.status}` });
        return;
      }
      setSiretState({ kind: "ok", data: json });
    } catch (err) {
      setSiretState({ kind: "error", message: err instanceof Error ? err.message : "Erreur réseau" });
    }
  }

  async function runVies() {
    if (!vatNumber) return;
    setViesState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/admin/vies-check?vat=${encodeURIComponent(vatNumber)}&userId=${encodeURIComponent(userId)}`,
        { cache: "no-store" },
      );
      const json = (await res.json().catch(() => null)) as (ViesPayload & { error?: string }) | null;
      if (!res.ok || !json) {
        setViesState({ kind: "error", message: json?.error ?? `Erreur ${res.status}` });
        return;
      }
      setViesState({ kind: "ok", data: json });
    } catch (err) {
      setViesState({ kind: "error", message: err instanceof Error ? err.message : "Erreur réseau" });
    }
  }

  useEffect(() => {
    if (autoRan.current) return;
    if (!isPending) return;
    autoRan.current = true;
    if (canCheckSiret) void runSiret();
    if (canCheckVies) void runVies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerCls = isPending
    ? "rounded-3xl border border-amber-200/70 bg-gradient-to-br from-amber-50/80 via-white to-pink-50/40 shadow-sm p-6 md:p-7"
    : "rounded-3xl border border-border bg-gradient-to-br from-violet-50/40 via-bg-primary to-sky-50/30 shadow-sm p-6 md:p-7";

  return (
    <div className={containerCls}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${isPending ? "bg-amber-100 border-amber-200" : "bg-bg-primary border-border"}`}>
            <svg className={`w-5 h-5 ${isPending ? "text-amber-700" : "text-text-secondary"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${isPending ? "text-amber-800" : "text-text-muted"}`}>
              Vérification identité{isPending ? " · demande en attente" : ""}
            </p>
            <h3 className="font-heading text-xl md:text-2xl font-bold text-text-primary leading-tight">
              {isPending ? "Contrôles automatiques lancés" : "Contrôles à la demande"}
            </h3>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SiretCard
          state={siretState}
          onRerun={runSiret}
          siret={siret}
          hasSiret={hasSiret}
          isFrench={isFrench}
        />
        <ViesCard
          state={viesState}
          onRerun={runVies}
          vatNumber={vatNumber}
          canCheck={canCheckVies}
        />
      </div>

      <p className="text-[11px] text-text-muted mt-4 leading-relaxed">
        Comparez les infos ci-dessus avec ce que le client a saisi à l&apos;inscription. Un SIRET « Introuvable » ou un nom légal qui ne correspond pas = signal fort.
      </p>
    </div>
  );
}

// ─── SIRET Card ─────────────────────────────────────────────────────────

function SiretCard({
  state,
  onRerun,
  siret,
  hasSiret,
  isFrench,
}: {
  state: SiretState;
  onRerun: () => void;
  siret: string | null;
  hasSiret: boolean;
  isFrench: boolean;
}) {
  if (!isFrench) {
    return (
      <article className="rounded-2xl border border-dashed border-border bg-bg-tertiary/40 p-5">
        <CardHeader label="SIRET · registre INSEE" tone="muted" />
        <p className="text-sm text-text-secondary italic">Non applicable — client non français.</p>
        <p className="text-[11px] text-text-muted mt-1">Le SIRET est un identifiant purement français, on ne peut pas vérifier une société étrangère via ce service.</p>
      </article>
    );
  }

  if (!hasSiret) {
    return (
      <article className="rounded-2xl border border-dashed border-border bg-bg-tertiary/40 p-5">
        <CardHeader label="SIRET · registre INSEE" tone="muted" />
        <p className="text-sm text-text-secondary italic">Le client n&apos;a pas renseigné de SIRET valide (14 chiffres attendus).</p>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-border bg-bg-primary/70 backdrop-blur-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <CardHeader label="SIRET · registre INSEE" tone={state.kind === "ok" && state.data.found ? "success" : "neutral"} />
        <StatusBadge kind={siretBadgeKind(state)} />
      </div>

      <p className="font-mono text-sm text-text-primary">{siret}</p>

      {state.kind === "loading" && (
        <div className="mt-2 space-y-1.5">
          <div className="h-3 rounded bg-bg-tertiary animate-pulse w-2/3" />
          <div className="h-3 rounded bg-bg-tertiary animate-pulse w-3/4" />
          <p className="text-[11px] text-text-muted italic mt-1">Vérification auprès de l&apos;INSEE…</p>
        </div>
      )}

      {state.kind === "ok" && state.data.found && (
        <div className="text-xs text-text-secondary mt-2 leading-snug space-y-0.5">
          {state.data.companyName && (
            <p className="text-sm text-text-primary font-medium">{state.data.companyName}</p>
          )}
          {state.data.address && <p>{state.data.address}</p>}
          {state.data.activity && <p className="italic text-text-muted">{state.data.activity}</p>}
          {(state.data.activeStatus || state.data.creationDate) && (
            <p className="text-[11px] text-text-muted">
              {state.data.activeStatus === "closed" && <span className="text-rose-700 font-medium">Établissement fermé</span>}
              {state.data.activeStatus === "active" && <span className="text-emerald-700">Établissement actif</span>}
              {state.data.creationDate && (
                <> · Créée le {new Date(state.data.creationDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}</>
              )}
            </p>
          )}
        </div>
      )}

      {state.kind === "ok" && !state.data.found && !state.data.serviceError && (
        <p className="text-[11px] text-rose-700 mt-2">Aucune entreprise trouvée au registre INSEE pour ce SIRET.</p>
      )}

      {state.kind === "ok" && state.data.serviceError && (
        <p className="text-[11px] text-text-muted mt-2">{state.data.serviceError}</p>
      )}

      {state.kind === "error" && (
        <p className="text-[11px] text-text-muted mt-2">{state.message}</p>
      )}

      <CardFooter
        hint="Contrôle live · non stocké"
        onRerun={onRerun}
        rerunLabel={state.kind === "idle" ? "Vérifier SIRET" : "Revérifier"}
        primary={state.kind === "idle"}
        busy={state.kind === "loading"}
      />
    </article>
  );
}

// ─── VIES Card ──────────────────────────────────────────────────────────

function ViesCard({
  state,
  onRerun,
  vatNumber,
  canCheck,
}: {
  state: ViesState;
  onRerun: () => void;
  vatNumber: string | null;
  canCheck: boolean;
}) {
  if (!canCheck) {
    return (
      <article className="rounded-2xl border border-dashed border-border bg-bg-tertiary/40 p-5">
        <CardHeader label="N° TVA intra · service VIES" tone="muted" />
        <p className="text-sm text-text-secondary italic">Le client n&apos;a pas renseigné de numéro de TVA.</p>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-border bg-bg-primary/70 backdrop-blur-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <CardHeader label="N° TVA intra · service VIES" tone={state.kind === "ok" && state.data.valid ? "success" : "neutral"} />
        <StatusBadge kind={viesBadgeKind(state)} />
      </div>

      <p className="font-mono text-sm text-text-primary">{vatNumber}</p>

      {state.kind === "loading" && (
        <div className="mt-2 space-y-1.5">
          <div className="h-3 rounded bg-bg-tertiary animate-pulse w-2/3" />
          <div className="h-3 rounded bg-bg-tertiary animate-pulse w-3/4" />
          <p className="text-[11px] text-text-muted italic mt-1">
            Interrogation VIES… le fisc du pays peut mettre jusqu&apos;à 30 s à répondre.
          </p>
        </div>
      )}

      {state.kind === "ok" && (state.data.name || state.data.address) && (
        <div className="text-xs text-text-secondary mt-2 leading-snug space-y-0.5">
          {state.data.name && <p className="text-sm text-text-primary font-medium">{state.data.name}</p>}
          {state.data.address && <p>{state.data.address}</p>}
          {state.data.requestDate && (
            <p className="text-[11px] text-text-muted">
              Vérifié le {new Date(state.data.requestDate).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
      )}

      {state.kind === "ok" && state.data.serviceError && (
        <p className="text-[11px] text-text-muted mt-2">{state.data.serviceError}</p>
      )}

      {state.kind === "error" && (
        <p className="text-[11px] text-text-muted mt-2">{state.message}</p>
      )}

      <CardFooter
        hint="Contrôle enregistré"
        onRerun={onRerun}
        rerunLabel={state.kind === "idle" ? "Vérifier VIES" : "Revérifier"}
        primary={state.kind === "idle"}
        busy={state.kind === "loading"}
      />
    </article>
  );
}

// ─── Sous-primitives ────────────────────────────────────────────────────

function CardHeader({ label, tone }: { label: string; tone: "success" | "neutral" | "muted" }) {
  const dotCls =
    tone === "success" ? "bg-emerald-100 border-emerald-200 text-emerald-700"
    : tone === "muted"  ? "bg-bg-tertiary border-border text-text-muted"
    :                     "bg-bg-tertiary border-border text-text-secondary";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${dotCls}`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75" />
        </svg>
      </span>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] truncate ${tone === "muted" ? "text-text-muted" : "text-text-secondary"}`}>{label}</p>
    </div>
  );
}

type BadgeKind = "idle" | "loading" | "success" | "warning" | "error" | "hidden";

function StatusBadge({ kind }: { kind: BadgeKind }) {
  if (kind === "hidden") return null;
  if (kind === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide bg-sky-100 text-sky-800 border border-sky-200 rounded-full px-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
        Vérification…
      </span>
    );
  }
  if (kind === "success") {
    return <span className="badge badge-success text-[10px]">Trouvée</span>;
  }
  if (kind === "warning") {
    return <span className="badge badge-warning text-[10px]">Attention</span>;
  }
  if (kind === "error") {
    return <span className="badge badge-error text-[10px]">Introuvable</span>;
  }
  return null;
}

function siretBadgeKind(state: SiretState): BadgeKind {
  if (state.kind === "idle") return "hidden";
  if (state.kind === "loading") return "loading";
  if (state.kind === "error") return "warning";
  if (state.data.serviceError) return "warning";
  if (!state.data.found) return "error";
  if (state.data.activeStatus === "closed") return "warning";
  return "success";
}

function viesBadgeKind(state: ViesState): BadgeKind {
  if (state.kind === "idle") return "hidden";
  if (state.kind === "loading") return "loading";
  if (state.kind === "error") return "warning";
  if (state.data.serviceError) return "warning";
  return state.data.valid ? "success" : "error";
}

function CardFooter({
  hint,
  onRerun,
  rerunLabel,
  primary,
  busy,
}: {
  hint: string;
  onRerun: () => void;
  rerunLabel: string;
  primary: boolean;
  busy: boolean;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
      <p className="text-[10px] text-text-muted">{hint}</p>
      <button
        type="button"
        onClick={onRerun}
        disabled={busy}
        className={
          primary
            ? "text-xs font-medium bg-bg-dark text-text-inverse rounded-lg px-3 py-1.5 hover:bg-bg-darker inline-flex items-center gap-1.5 disabled:opacity-40 transition-colors"
            : "text-[11px] text-text-secondary hover:text-text-primary inline-flex items-center gap-1 disabled:opacity-40 transition-colors"
        }
      >
        <svg className={primary ? "w-3.5 h-3.5" : "w-3 h-3"} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {rerunLabel}
      </button>
    </div>
  );
}
