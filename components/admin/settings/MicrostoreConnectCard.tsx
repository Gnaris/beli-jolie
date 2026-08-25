"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// useRef reste nécessaire pour l'abort controller du polling QR
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { disconnectMicrostore, setMarketplaceProductsManagement } from "@/app/actions/admin/site-config";

interface Props {
  initiallyConnected: boolean;
  initiallyEnabled: boolean;
  initialExpiresAtIso: string | null;
}

function formatFrenchDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function daysUntil(iso: string): number {
  const d = new Date(iso).getTime();
  return Math.max(0, Math.floor((d - Date.now()) / (1000 * 60 * 60 * 24)));
}

// Bookmarklet legacy — remplacé par le flow QR compagnon depuis 2026-08-25.
// Conservé exporté pour compat avec d'éventuels callers externes ; ne plus utiliser.
/** @deprecated utiliser le flow QR compagnon via /api/admin/microstore/qr */
export function buildMicrostoreBookmarklet(originForRedirect: string): string {
  const target = `${originForRedirect}/admin/parametres?tab=marketplaces`;
  const script =
    `(function(){` +
    `var t=localStorage.getItem("admin_token");` +
    `if(!t){alert("Pas connecte a Microstore ici. Ouvrez web.mc.app et connectez-vous d abord, puis recliquez.");return;}` +
    `var m=localStorage.getItem("admin_mask_token")||"";` +
    `location.href=` +
    JSON.stringify(target) +
    `+"#mc_import="+encodeURIComponent(t)+"&mc_mask="+encodeURIComponent(m);` +
    `})();`;
  return `javascript:${script}`;
}

export default function MicrostoreConnectCard({
  initiallyConnected,
  initiallyEnabled,
  initialExpiresAtIso,
}: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();
  const [connected, setConnected] = useState(initiallyConnected);
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [expiresAtIso, setExpiresAtIso] = useState<string | null>(initialExpiresAtIso);
  const [pingResult, setPingResult] = useState<null | {
    ok: boolean;
    stage: string;
    err?: number | null;
    msg?: string | null;
    durationMs?: number;
    keyMasked?: string;
  }>(null);
  const [pinging, setPinging] = useState(false);

  // Import automatique du token si le fragment d'URL en contient un (bookmarklet legacy)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#mc_import=")) return;
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get("mc_import");
    const maskToken = params.get("mc_mask") ?? "";
    if (!token) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    (async () => {
      try {
        const res = await fetch("/api/admin/microstore/import-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, maskToken }),
        });
        const data = (await res.json().catch(() => null)) as
          | { status: "success"; expiresAt: string | null }
          | { error: string };
        if (res.ok && "status" in data && data.status === "success") {
          setConnected(true);
          setEnabled(true);
          setExpiresAtIso(data.expiresAt);
          toast.success(
            "Session Microstore récupérée",
            "Votre session web.mc.app reste active — les deux coexistent.",
          );
          // Rafraîchit le rendu serveur (vignette « Non connecté » du parent
          // MarketplaceConfig / SettingCard qui prend son état des props
          // initiales, sinon reste "Non connecté" après import réussi).
          router.refresh();
        } else {
          const err = "error" in data ? data.error : "Erreur inconnue.";
          toast.error("Impossible d'importer la session", err);
        }
      } catch {
        toast.error("Erreur réseau", "Impossible de contacter le serveur.");
      }
    })();
  }, [toast]);

  const handleDisconnect = useCallback(async () => {
    const ok = await confirm({
      type: "danger",
      title: "Déconnecter Microstore ?",
      message:
        "Vous devrez re-scanner un QR code avec votre appli MC Gérant pour vous reconnecter.",
      confirmLabel: "Déconnecter",
    });
    if (ok !== true) return;
    const res = await disconnectMicrostore();
    if (res.success) {
      setConnected(false);
      setEnabled(false);
      setExpiresAtIso(null);
      toast.success("Microstore déconnecté.");
      router.refresh();
    } else {
      toast.error("Erreur", res.error);
    }
  }, [confirm, toast, router]);

  const handleTestConnection = useCallback(async () => {
    setPinging(true);
    setPingResult(null);
    try {
      const res = await fetch("/api/admin/microstore/ping", { method: "POST" });
      const data = await res.json();
      setPingResult(data);
      if (data.ok) {
        toast.success("Connexion OK", "Microstore répond correctement.");
      } else if (data.stage === "no_key") {
        toast.error("Aucune clé", "La clé Microstore n'est pas enregistrée.");
      } else if (data.err === 6011 || data.err === 6061) {
        toast.error(
          "Session Microstore invalidée",
          "Elle a probablement été kickée par une autre session active (web.mc.app ouvert).",
        );
      } else {
        toast.error("Test échoué", `err ${data.err ?? "?"} : ${data.msg ?? "?"}`);
      }
    } catch (err) {
      toast.error("Erreur réseau", err instanceof Error ? err.message : "?");
    } finally {
      setPinging(false);
    }
  }, [toast]);

  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      const res = await setMarketplaceProductsManagement("microstore", next);
      if (!res.success) {
        setEnabled(!next);
        toast.error("Erreur", res.error);
      }
    },
    [toast],
  );

  if (connected) {
    const days = expiresAtIso ? daysUntil(expiresAtIso) : null;
    const dateLabel = expiresAtIso ? formatFrenchDate(expiresAtIso) : null;
    const soon = days !== null && days <= 14;
    const bannerTone = soon
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-emerald-200 bg-emerald-50";
    const dotTone = soon ? "bg-amber-500" : "bg-emerald-500";
    return (
      <div className="space-y-4">
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${bannerTone}`}>
          <div className={`w-10 h-10 rounded-full text-white flex items-center justify-center shrink-0 ${dotTone}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="flex-1">
            <div className={`font-heading text-sm font-bold ${soon ? "text-amber-900" : "text-emerald-900"}`}>
              Microstore connecté
            </div>
            <div className={`text-xs mt-0.5 ${soon ? "text-amber-800" : "text-emerald-700"}`}>
              {dateLabel
                ? soon
                  ? `⚠️ Session valide jusqu'au ${dateLabel} — pensez à re-scanner un QR bientôt (${days} j restants).`
                  : `Session valide jusqu'au ${dateLabel} (${days} j restants).`
                : "Session active. Vous pouvez importer vos commandes depuis la page Commandes."}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleTestConnection}
          disabled={pinging}
          className="w-full h-11 rounded-xl border border-border bg-bg-primary text-text-primary text-sm font-body font-bold hover:bg-bg-secondary transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {pinging ? (
            <>
              <span className="inline-block w-4 h-4 rounded-full border-2 border-text-muted border-t-transparent animate-spin" />
              Test en cours…
            </>
          ) : (
            "🩺 Tester la connexion Microstore"
          )}
        </button>

        {pingResult && (
          <div
            className={`rounded-xl border p-3 text-xs font-body ${
              pingResult.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            <div className="font-bold">
              {pingResult.ok ? "✓ Connexion active" : "✗ Connexion échouée"}
            </div>
            <div className="mt-1 space-y-0.5">
              <div>
                <b>Clé stockée :</b>{" "}
                <code className="px-1 rounded bg-white/50">
                  {pingResult.keyMasked ?? "aucune"}
                </code>
              </div>
              {pingResult.err !== null && pingResult.err !== undefined && (
                <div>
                  <b>Code err Microstore :</b> {pingResult.err}
                </div>
              )}
              {pingResult.msg && (
                <div>
                  <b>Message :</b> {pingResult.msg}
                </div>
              )}
              {pingResult.durationMs !== undefined && (
                <div>
                  <b>Temps de réponse :</b> {pingResult.durationMs} ms
                </div>
              )}
            </div>
            {!pingResult.ok && (pingResult.err === 6011 || pingResult.err === 6061) && (
              <div className="mt-2 pt-2 border-t border-red-200">
                <b>💡 Piste :</b> Microstore a probablement invalidé cette clé parce qu'une autre session (comme <code>web.mc.app</code> ouvert dans un autre onglet) l'utilisait en même temps. <b>Fermez tous vos onglets web.mc.app</b>, refaites une connexion, puis retestez.
              </div>
            )}
          </div>
        )}

        <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-bg-secondary/40">
          <div>
            <div className="text-sm font-bold text-text-primary">Activer l'import Microstore</div>
            <div className="text-xs text-text-muted mt-0.5">
              Désactiver masque le bouton d'import sans supprimer la connexion.
            </div>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
            className="w-11 h-6 rounded-full appearance-none bg-bg-tertiary checked:bg-emerald-500 transition-colors relative cursor-pointer before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-5 before:h-5 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-5"
          />
        </label>

        <button
          type="button"
          onClick={handleDisconnect}
          className="w-full h-11 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm font-body font-bold hover:bg-red-100 transition-colors"
        >
          Déconnecter Microstore
        </button>
      </div>
    );
  }

  // Non connecté — flow QR compagnon (comme WhatsApp Web)
  return <MicrostoreQrConnect onConnected={(iso) => {
    setConnected(true);
    setEnabled(true);
    setExpiresAtIso(iso);
    router.refresh();
  }} />;
}

// ─── Composant QR compagnon ──────────────────────────────────────────────

function MicrostoreQrConnect({ onConnected }: { onConnected: (expiresAtIso: string | null) => void }) {
  const toast = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "waiting" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generateQr = useCallback(async () => {
    setStatus("generating");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/admin/microstore/qr", { method: "POST" });
      const data = (await res.json()) as { code?: string; qrDataUrl?: string; error?: string };
      if (!res.ok || !data.code || !data.qrDataUrl) {
        setErrorMsg(data.error ?? "Impossible de générer le QR");
        setStatus("error");
        return;
      }
      setCode(data.code);
      setQrDataUrl(data.qrDataUrl);
      setStatus("waiting");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur réseau");
      setStatus("error");
    }
  }, []);

  // Poll toutes les 1s tant qu'on attend le scan (max 3 min)
  useEffect(() => {
    if (status !== "waiting" || !code) return;
    const abort = new AbortController();
    abortRef.current = abort;
    let stopped = false;
    let elapsed = 0;

    const poll = async () => {
      while (!stopped && elapsed < 180) {
        await new Promise((r) => setTimeout(r, 1000));
        elapsed++;
        if (stopped) return;
        try {
          const res = await fetch("/api/admin/microstore/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
            signal: abort.signal,
          });
          const data = (await res.json()) as
            | { status: "success"; expiresAt: string | null }
            | { status: "waiting" }
            | { status: "error"; error?: string }
            | { error: string };
          if ("status" in data) {
            if (data.status === "success") {
              stopped = true;
              toast.success("Microstore connecté", "Ton appli MC Gérant reste connectée en parallèle.");
              onConnected("expiresAt" in data ? data.expiresAt : null);
              return;
            }
            if (data.status === "error") {
              if (data.error === "expired") {
                stopped = true;
                setErrorMsg("QR expiré — regénère-en un nouveau");
                setStatus("error");
                return;
              }
              if (data.error === "timeout") {
                stopped = true;
                setErrorMsg("Aucun scan reçu — regénère un nouveau QR");
                setStatus("error");
                return;
              }
            }
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          // ignore fetch errors intermédiaires, retry
        }
      }
      if (!stopped && elapsed >= 180) {
        setErrorMsg("Aucun scan après 3 min — regénère un nouveau QR");
        setStatus("error");
      }
    };

    void poll();
    return () => {
      stopped = true;
      abort.abort();
    };
  }, [status, code, onConnected, toast]);

  return (
    <div className="rounded-xl border-2 border-cyan-200 bg-cyan-50/40 p-5">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="w-10 h-10 rounded-full bg-cyan-500 text-white flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <path d="M14 14h3v3M14 21h7M17 17v4" />
            </svg>
          </span>
          <div className="font-heading text-base font-bold text-cyan-900">
            Connecter Microstore par QR code
          </div>
        </div>

        {status === "idle" && (
          <>
            <p className="text-xs text-cyan-800 mb-4 max-w-md mx-auto">
              Tu vas scanner un QR code avec ton appli mobile MC Gérant (exactement comme WhatsApp Web).
              <br />
              <b>Ton appli mobile reste connectée</b> en parallèle — aucun risque d'être déconnectée.
            </p>
            <button
              type="button"
              onClick={generateQr}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-cyan-600 text-white text-sm font-heading font-bold hover:bg-cyan-700 transition-colors shadow-md"
            >
              🔗 Générer un QR code
            </button>
          </>
        )}

        {status === "generating" && (
          <div className="py-8 text-cyan-700 text-sm">Génération du QR…</div>
        )}

        {status === "waiting" && qrDataUrl && (
          <div className="space-y-3">
            <div className="inline-block bg-white p-3 rounded-2xl border border-cyan-200 shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR code Microstore" width={280} height={280} className="block" />
            </div>
            <div className="text-xs text-cyan-800 max-w-md mx-auto space-y-1">
              <p className="font-bold">📱 Scanne ce QR avec ton appli MC Gérant</p>
              <p>Ouvre l'appli → menu Scanner (icône ⁝) → dirige la caméra sur le QR.</p>
              <p className="text-cyan-600 italic">En attente du scan…</p>
            </div>
            <button
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                setStatus("idle");
                setQrDataUrl(null);
                setCode(null);
              }}
              className="text-xs text-cyan-700 hover:underline"
            >
              Annuler
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              {errorMsg}
            </div>
            <button
              type="button"
              onClick={generateQr}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-cyan-600 text-white text-sm font-heading font-bold hover:bg-cyan-700 transition-colors"
            >
              🔄 Regénérer un QR
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
