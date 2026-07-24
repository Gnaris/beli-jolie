"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { disconnectMicrostore, toggleMicrostoreEnabled } from "@/app/actions/admin/site-config";

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

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "waiting"; code: string; qrDataUrl: string; expiresAt: number }
  | { kind: "success" }
  | { kind: "error"; message: string };

// Bookmarklet : lit les tokens dans localStorage de web.mc.app puis redirige
// vers notre admin avec les tokens en fragment URL (jamais envoyé au serveur,
// on les POSTera nous-mêmes via fetch).
// Pas de caractères accentués → certains navigateurs les URL-encodent au
// drag-and-drop, ce qui casse le script. On garde de l'ASCII pur.
function buildBookmarklet(originForRedirect: string): string {
  const target = `${originForRedirect}/admin/parametres/microstore`;
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

// Le QR Microstore expire ~120s (observation empirique). On regénère avant.
const QR_TTL_MS = 110_000;
const POLL_INTERVAL_MS = 1200;

export default function MicrostoreConnectCard({
  initiallyConnected,
  initiallyEnabled,
  initialExpiresAtIso,
}: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [connected, setConnected] = useState(initiallyConnected);
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [expiresAtIso, setExpiresAtIso] = useState<string | null>(initialExpiresAtIso);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pingResult, setPingResult] = useState<null | {
    ok: boolean;
    stage: string;
    err?: number | null;
    msg?: string | null;
    durationMs?: number;
    keyMasked?: string;
  }>(null);
  const [pinging, setPinging] = useState(false);
  const [bookmarkletUrl, setBookmarkletUrl] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const bookmarkletAnchorRef = useRef<HTMLAnchorElement | null>(null);

  // Construit le bookmarklet avec l'origine courante (localhost:3000 en dev,
  // beliandjolie.com en prod). En SSR, `window` n'existe pas — on met le href
  // à jour après montage pour ne pas casser l'hydratation.
  useEffect(() => {
    setBookmarkletUrl(buildBookmarklet(window.location.origin));
  }, []);

  // CRITIQUE — React 19 refuse silencieusement les URL javascript: dans les
  // attributs `href` par sécurité. Sans ce contournement via setAttribute,
  // l'ancre n'a AUCUN href et le drag-and-drop vers les favoris crée un
  // bookmark inutilisable. On pose le href impérativement après montage.
  useEffect(() => {
    if (!bookmarkletUrl || !bookmarkletAnchorRef.current) return;
    bookmarkletAnchorRef.current.setAttribute("href", bookmarkletUrl);
  }, [bookmarkletUrl]);

  // Import automatique du token si le fragment d'URL en contient un (bookmarklet)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#mc_import=")) return;
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get("mc_import");
    const maskToken = params.get("mc_mask") ?? "";
    if (!token) return;
    // Nettoie l'URL immédiatement (le token ne doit pas rester dans l'historique)
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
        } else {
          const err = "error" in data ? data.error : "Erreur inconnue.";
          toast.error("Impossible d'importer la session", err);
        }
      } catch {
        toast.error("Erreur réseau", "Impossible de contacter le serveur.");
      }
    })();
  }, [toast]);

  const stopPolling = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const fetchNewQr = useCallback(async (): Promise<{ code: string; qrDataUrl: string } | null> => {
    const res = await fetch("/api/admin/microstore/qr", { method: "POST" });
    if (!res.ok) {
      setPhase({ kind: "error", message: "Impossible de générer un QR code." });
      return null;
    }
    const data = (await res.json()) as { code: string; qrDataUrl: string };
    return data;
  }, []);

  const pollOnce = useCallback(
    async (code: string, signal: AbortSignal): Promise<
      { done: boolean; success?: boolean; expiresAt?: string | null; error?: string }
    > => {
      const res = await fetch("/api/admin/microstore/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        signal,
      });
      if (!res.ok) return { done: false };
      const data = (await res.json()) as
        | { status: "waiting" }
        | { status: "success"; expiresAt: string | null }
        | { status: "error"; error: string };
      if (data.status === "waiting") return { done: false };
      if (data.status === "success") {
        return { done: true, success: true, expiresAt: data.expiresAt };
      }
      return { done: true, error: data.error };
    },
    [],
  );

  const startConnect = useCallback(async () => {
    stopPolling();
    setPhase({ kind: "loading" });
    const controller = new AbortController();
    abortRef.current = controller;

    let current = await fetchNewQr();
    if (!current) return;
    let expiresAt = Date.now() + QR_TTL_MS;
    setPhase({ kind: "waiting", code: current.code, qrDataUrl: current.qrDataUrl, expiresAt });

    while (!controller.signal.aborted) {
      // Régénère le QR si TTL bientôt écoulé (avant que Microstore ne renvoie "expired").
      if (Date.now() > expiresAt) {
        const next = await fetchNewQr();
        if (!next) return;
        current = next;
        expiresAt = Date.now() + QR_TTL_MS;
        setPhase({
          kind: "waiting",
          code: current.code,
          qrDataUrl: current.qrDataUrl,
          expiresAt,
        });
      }

      let result: Awaited<ReturnType<typeof pollOnce>>;
      try {
        result = await pollOnce(current.code, controller.signal);
      } catch {
        return; // aborted
      }

      if (result.done) {
        if (result.success) {
          setPhase({ kind: "success" });
          setConnected(true);
          setEnabled(true);
          setExpiresAtIso(result.expiresAt ?? null);
          toast.success("Microstore connecté", "Votre session est valide environ 1 an.");
          return;
        }
        // Erreur : si "expired" on regénère silencieusement, sinon on affiche.
        if (result.error === "expired") {
          expiresAt = 0; // force régen à la prochaine itération
          continue;
        }
        setPhase({ kind: "error", message: result.error || "Erreur inconnue." });
        return;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }, [fetchNewQr, pollOnce, stopPolling, toast]);

  const handleDisconnect = useCallback(async () => {
    const ok = await confirm({
      type: "danger",
      title: "Déconnecter Microstore ?",
      message:
        "Vous devrez re-scanner le QR code depuis l'app mobile Microstore pour réimporter des commandes.",
      confirmLabel: "Déconnecter",
    });
    if (ok !== true) return;
    const res = await disconnectMicrostore();
    if (res.success) {
      setConnected(false);
      setEnabled(false);
      setExpiresAtIso(null);
      setPhase({ kind: "idle" });
      toast.success("Microstore déconnecté.");
    } else {
      toast.error("Erreur", res.error);
    }
  }, [confirm, toast]);

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
      const res = await toggleMicrostoreEnabled(next);
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

  // Non connecté
  return (
    <div className="space-y-4">
      {/* Option A (recommandée) : bookmarklet — préserve la session web.mc.app */}
      {phase.kind === "idle" && (
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4v16l7-4 7 4V4H5z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-heading text-sm font-bold text-emerald-900">
                Option recommandée — Partager ma session web déjà active
              </div>
              <p className="text-xs text-emerald-800 mt-1 font-body">
                Vous restez connectée à <code className="px-1 rounded bg-emerald-100">web.mc.app</code> ET dans votre admin en même temps. Aucun scan de QR.
              </p>

              {/* Méthode A : drag-and-drop */}
              <div className="mt-4 space-y-2">
                <div className="font-heading text-xs font-bold text-emerald-900 uppercase tracking-wider">
                  Méthode A — Glisser dans les favoris (le plus simple)
                </div>
                <ol className="space-y-1 text-xs text-emerald-900 font-body list-decimal list-inside">
                  <li>Appuyez sur <b>Ctrl+Maj+B</b> pour afficher votre barre de favoris.</li>
                  <li><b>Faites glisser</b> le bouton vert ci-dessous dans la barre de favoris.</li>
                  <li>Allez sur <code className="px-1 rounded bg-emerald-100">web.mc.app</code> (connectée) et cliquez sur le favori.</li>
                </ol>
                <div className="pt-1">
                  {/*
                    NB : `href` est posé impérativement dans useEffect via
                    setAttribute — React 19 bloque les URL javascript: sur
                    le JSX. Cf. bookmarkletAnchorRef.
                  */}
                  {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- href posé via ref pour contourner React 19 */}
                  <a
                    ref={bookmarkletAnchorRef}
                    onClick={(e) => {
                      e.preventDefault();
                      toast.info(
                        "Ce n'est pas un bouton à cliquer",
                        "Faites-le glisser dans votre barre de favoris.",
                      );
                    }}
                    draggable
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-emerald-600 text-white text-sm font-heading font-bold hover:bg-emerald-700 transition-colors cursor-grab active:cursor-grabbing shadow-md select-none"
                    title="Faites glisser dans votre barre de favoris"
                  >
                    📎 Connecter Microstore
                  </a>
                </div>
              </div>

              {/* Méthode B : copier-coller si drag-and-drop ne marche pas */}
              <details className="mt-4 group">
                <summary className="cursor-pointer text-xs font-heading font-bold text-emerald-900 uppercase tracking-wider hover:underline">
                  Méthode B — Si le clic sur le favori ne fait rien
                </summary>
                <div className="mt-3 pl-2 space-y-2">
                  <p className="text-xs text-emerald-900 font-body">
                    Certains navigateurs suppriment automatiquement le code au moment du drag. Créez le favori manuellement :
                  </p>
                  <ol className="space-y-1.5 text-xs text-emerald-900 font-body list-decimal list-inside">
                    <li>
                      Cliquez sur <b>« Copier le code »</b> ci-dessous.
                    </li>
                    <li>
                      Dans votre navigateur, faites <b>clic droit sur la barre de favoris → « Ajouter une page »</b> (ou « Ajouter un signet »).
                    </li>
                    <li>
                      <b>Nom :</b> <code className="px-1 rounded bg-emerald-100">Connecter Microstore</code>
                    </li>
                    <li>
                      <b>URL :</b> collez le code que vous venez de copier (Ctrl+V).
                    </li>
                    <li>
                      Enregistrez, puis allez sur <code className="px-1 rounded bg-emerald-100">web.mc.app</code> et cliquez le favori.
                    </li>
                  </ol>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(bookmarkletUrl);
                        toast.success(
                          "Code copié !",
                          "Créez un nouveau favori et collez le code comme URL.",
                        );
                      } catch {
                        toast.error(
                          "Impossible de copier",
                          "Sélectionnez le code manuellement et copiez-le (Ctrl+C).",
                        );
                      }
                    }}
                    className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-emerald-100 text-emerald-900 text-xs font-body font-bold hover:bg-emerald-200 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copier le code du favori
                  </button>
                  <textarea
                    readOnly
                    rows={3}
                    value={bookmarkletUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full mt-2 p-2 rounded-lg border border-emerald-200 bg-white text-[10px] font-mono text-emerald-950 resize-none"
                  />
                </div>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* Option B : QR code (kick la session web.mc.app) */}
      <div className="rounded-xl border border-border bg-bg-secondary/30 p-4">
        <div className="text-xs text-text-secondary font-body">
          <b>Alternative :</b> connexion par QR code — <span className="text-amber-700">déconnecte votre session web.mc.app active</span>. À utiliser si vous n'êtes pas connectée sur ordinateur.
        </div>
        {phase.kind === "idle" && (
          <button
            type="button"
            onClick={startConnect}
            className="mt-3 w-full h-10 rounded-xl border border-border bg-bg-primary text-text-primary text-sm font-body font-medium hover:bg-bg-secondary transition-colors flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3h-3zM19 14h2M14 19h2v2h-2zM19 19h2v2h-2z" />
            </svg>
            Se connecter par QR code
          </button>
        )}
      </div>

      {phase.kind === "loading" && (
        <div className="h-12 rounded-xl border border-border bg-bg-secondary flex items-center justify-center gap-2 text-sm text-text-muted">
          <span className="inline-block w-4 h-4 rounded-full border-2 border-text-muted border-t-transparent animate-spin" />
          Génération du QR code…
        </div>
      )}

      {phase.kind === "waiting" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-border bg-white">
            <Image
              src={phase.qrDataUrl}
              alt="QR code Microstore"
              width={280}
              height={280}
              unoptimized
              className="rounded-lg"
            />
            <div className="text-center">
              <div className="font-heading text-sm font-bold text-text-primary">
                Ouvrez votre application Microstore
              </div>
              <div className="text-xs text-text-muted mt-1 max-w-[280px]">
                Menu → « Se connecter à la version web » → scannez ce QR code
              </div>
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-text-muted">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              En attente du scan…
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopPolling();
              setPhase({ kind: "idle" });
            }}
            className="w-full h-10 rounded-xl border border-border bg-bg-primary text-text-secondary text-sm font-body font-medium hover:bg-bg-secondary transition-colors"
          >
            Annuler
          </button>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="space-y-3">
          <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800">
            {phase.message}
          </div>
          <button
            type="button"
            onClick={startConnect}
            className="w-full h-11 rounded-xl bg-text-primary text-text-inverse text-sm font-body font-bold hover:bg-text-primary/90 transition-colors"
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}
