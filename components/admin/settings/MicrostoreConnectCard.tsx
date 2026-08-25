"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

/**
 * Génère un bookmarklet à glisser dans les favoris du navigateur. Cliqué
 * depuis un onglet `web.mc.app` connecté, il lit le token stocké dans le
 * `localStorage` de Microstore et redirige vers BJ avec le token en fragment
 * d'URL. L'auto-import déclenché par `MicrostoreConnectCard` prend le relais.
 *
 * Cas d'usage principal (voie 2 dans l'onglet de connexion) : éviter de perdre
 * la session `web.mc.app` en cours en scannant un nouveau QR (les deux
 * utilisent le même slot compagnon côté Microstore).
 */
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

  // Non connecté — deux voies au choix (onglets)
  return (
    <MicrostoreConnectTabs
      onConnected={(iso) => {
        setConnected(true);
        setEnabled(true);
        setExpiresAtIso(iso);
        router.refresh();
      }}
    />
  );
}

// ─── Onglets « Non connecté » ────────────────────────────────────────────

/**
 * Deux voies pour connecter Microstore :
 *   - Voie 1 (défaut) : Scanner un QR. Simple mais **kicke la session
 *     web.mc.app** en cours (Microstore n'a qu'un seul slot compagnon).
 *   - Voie 2 : Bookmarklet. Idéal si la cliente a déjà `web.mc.app` ouvert et
 *     ne veut PAS être déconnectée. Le bookmarklet lit son token depuis
 *     `localStorage` de `web.mc.app` et le renvoie à BJ. Les deux sessions
 *     partagent alors le même token → coexistence propre.
 */
function MicrostoreConnectTabs({
  onConnected,
}: {
  onConnected: (expiresAtIso: string | null) => void;
}) {
  const [tab, setTab] = useState<"qr" | "web">("qr");
  return (
    <div className="space-y-4">
      <div className="inline-flex bg-bg-tertiary rounded-xl p-1 shadow-[var(--shadow-inset)] w-full">
        <button
          type="button"
          onClick={() => setTab("qr")}
          className={`flex-1 px-4 py-2 text-xs font-body font-bold rounded-lg transition-colors ${
            tab === "qr"
              ? "bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          📱 Scanner un QR
        </button>
        <button
          type="button"
          onClick={() => setTab("web")}
          className={`flex-1 px-4 py-2 text-xs font-body font-bold rounded-lg transition-colors ${
            tab === "web"
              ? "bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          🖥 J&apos;ai déjà web.mc.app ouvert
        </button>
      </div>

      {tab === "qr" ? (
        <MicrostoreQrConnect onConnected={onConnected} />
      ) : (
        <MicrostoreWebImport />
      )}
    </div>
  );
}

// ─── Voie 2 : import depuis web.mc.app (bookmarklet + console + paste) ──

/**
 * Snippet à copier dans la console de web.mc.app. Copie directement dans le
 * presse-papiers de la cliente les deux tokens séparés par `|`, puis affiche
 * un message pour lui dire de coller dans BJ. Contourne CSP (une console
 * DevTools n'est pas soumise à la CSP de la page).
 */
const CONSOLE_SNIPPET = `(async()=>{const t=localStorage.getItem("admin_token");const m=localStorage.getItem("admin_mask_token")||"";if(!t){console.log("%cPas de session Microstore ici — connecte-toi d'abord à web.mc.app.","color:#dc2626;font-weight:bold");return;}await navigator.clipboard.writeText(t+"|"+m);console.log("%cCopié ! Retourne dans BJ et colle dans le champ « Coller le token ».","color:#059669;font-weight:bold");})();`;

function MicrostoreWebImport() {
  const toast = useToast();
  const [origin, setOrigin] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [importing, setImporting] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const bookmarkletRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const bookmarkletHref = origin ? buildMicrostoreBookmarklet(origin) : "";

  // React 19 refuse de rendre un href="javascript:…" (bloqué par la
  // sanitisation d'URL). On le pose sur le nœud DOM après mount — setAttribute
  // n'est pas sanitisé, donc le drag-to-favorites fonctionne à nouveau.
  useLayoutEffect(() => {
    const node = bookmarkletRef.current;
    if (!node || !bookmarkletHref) return;
    node.setAttribute("href", bookmarkletHref);
  }, [bookmarkletHref]);

  async function handleCopySnippet() {
    try {
      await navigator.clipboard.writeText(CONSOLE_SNIPPET);
      setSnippetCopied(true);
      toast.success("Script copié", "Colle-le dans la console de web.mc.app.");
      setTimeout(() => setSnippetCopied(false), 3000);
    } catch {
      toast.error("Impossible de copier", "Copie manuellement le texte du script.");
    }
  }

  async function handleImport() {
    const raw = pasteValue.trim();
    if (!raw) {
      toast.error("Vide", "Colle le contenu copié depuis web.mc.app.");
      return;
    }
    // Format « token|maskToken » (snippet) OU juste « token » (paste manuel simple).
    const [token, maskToken = ""] = raw.split("|");
    if (!token.trim()) {
      toast.error("Token vide", "Le token Microstore semble vide.");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/admin/microstore/import-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          maskToken: maskToken.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { status: "success"; expiresAt: string | null }
        | { error: string }
        | null;
      if (res.ok && data && "status" in data && data.status === "success") {
        toast.success(
          "Session Microstore importée",
          "web.mc.app reste connectée en parallèle.",
        );
        window.location.reload();
      } else {
        const err = data && "error" in data ? data.error : "Erreur inconnue.";
        toast.error("Import refusé", err);
      }
    } catch {
      toast.error("Erreur réseau", "Impossible de contacter le serveur.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-cyan-500/40 bg-bg-secondary p-5 space-y-5">
      <div>
        <div className="font-heading text-base font-bold text-text-primary mb-1">
          Récupère la session sans te déconnecter de web.mc.app
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">
          Si tu es <b>déjà connectée à web.mc.app</b> dans un autre onglet, tu peux
          copier ta session ici sans passer par le QR (qui déconnecterait
          web.mc.app).
        </p>
      </div>

      {/* Voie A : bookmarklet à glisser dans les favoris */}
      <div className="rounded-lg bg-bg-primary border border-border p-4 space-y-3">
        <div className="text-xs font-body font-bold text-text-primary">
          Option A · Bouton à glisser dans tes favoris
        </div>
        <ol className="text-xs text-text-secondary space-y-1 list-decimal pl-4">
          <li>Affiche la barre des favoris (Ctrl + Maj + B).</li>
          <li>Glisse le bouton ci-dessous dans ta barre de favoris.</li>
          <li>
            Va sur <code className="px-1 rounded bg-bg-tertiary text-text-primary">web.mc.app</code>,
            connecte-toi si besoin, puis clique sur ton nouveau favori.
          </li>
        </ol>
        <div className="flex justify-center py-2">
          <a
            ref={bookmarkletRef}
            onClick={(e) => e.preventDefault()}
            draggable
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-cyan-600 text-white text-sm font-heading font-bold shadow-md cursor-grab active:cursor-grabbing select-none hover:bg-cyan-700 transition-colors"
          >
            🔗 Importer Microstore vers BJ
          </a>
        </div>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2.5 text-[11px] text-amber-800 dark:text-amber-300">
          <b>Ça ne se passe rien quand tu cliques&nbsp;?</b> C&apos;est la sécurité
          de Microstore qui bloque les favoris JavaScript sur leur site.
          Utilise l&apos;<b>Option B</b> ci-dessous, elle marche à tous les coups.
        </div>
      </div>

      {/* Voie B : snippet console + collage */}
      <div className="rounded-lg bg-bg-primary border border-border p-4 space-y-3">
        <div className="text-xs font-body font-bold text-text-primary">
          Option B · Coller un script dans la console (marche partout)
        </div>
        <ol className="text-xs text-text-secondary space-y-1.5 list-decimal pl-4">
          <li>
            Va sur <code className="px-1 rounded bg-bg-tertiary text-text-primary">web.mc.app</code>{" "}
            (connectée). Ouvre la console&nbsp;: touche <b>F12</b> → onglet
            <b> Console</b>.
          </li>
          <li>
            Copie le script ci-dessous avec le bouton, puis colle-le dans la
            console (clic-droit → Coller, ou <b>Ctrl+V</b>). Appuie sur Entrée.
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleCopySnippet}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-xs font-heading font-bold hover:bg-black transition-colors"
              >
                {snippetCopied ? "✓ Copié !" : "📋 Copier le script"}
              </button>
              <details className="flex-1">
                <summary className="text-[11px] text-text-muted cursor-pointer hover:text-text-secondary py-2">
                  voir le script
                </summary>
                <pre className="mt-1 p-2 rounded-md bg-bg-tertiary text-[10px] font-mono text-text-primary overflow-x-auto whitespace-pre-wrap break-all">
                  {CONSOLE_SNIPPET}
                </pre>
              </details>
            </div>
          </li>
          <li>
            Le script copie ta session dans le presse-papiers. Reviens ici et
            colle dans le champ&nbsp;:
          </li>
        </ol>
        <div>
          <input
            type="text"
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder="Colle ici (Ctrl+V)"
            className="field-input w-full text-xs font-mono"
          />
        </div>
        <button
          type="button"
          onClick={handleImport}
          disabled={importing || !pasteValue.trim()}
          className="w-full h-10 rounded-xl bg-cyan-600 text-white text-sm font-heading font-bold hover:bg-cyan-700 transition-colors disabled:opacity-60"
        >
          {importing ? "Import en cours…" : "Importer la session"}
        </button>
      </div>
    </div>
  );
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
    <div className="rounded-xl border-2 border-cyan-500/40 bg-bg-secondary p-5">
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
          <div className="font-heading text-base font-bold text-text-primary">
            Connecter Microstore par QR code
          </div>
        </div>

        {status === "idle" && (
          <>
            <p className="text-xs text-text-secondary mb-4 max-w-md mx-auto">
              Tu vas scanner un QR code avec ton appli mobile MC Gérant (exactement comme WhatsApp Web).
              <br />
              <b>Ton appli mobile reste connectée</b> en parallèle — aucun risque d&apos;être déconnectée.
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
          <div className="py-8 text-text-secondary text-sm">Génération du QR…</div>
        )}

        {status === "waiting" && qrDataUrl && (
          <div className="space-y-3">
            <div className="inline-block bg-white p-3 rounded-2xl border border-border shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR code Microstore" width={280} height={280} className="block" />
            </div>
            <div className="text-xs text-text-secondary max-w-md mx-auto space-y-1">
              <p className="font-bold text-text-primary">📱 Scanne ce QR avec ton appli MC Gérant</p>
              <p>Ouvre l&apos;appli → menu Scanner (icône ⁝) → dirige la caméra sur le QR.</p>
              <p className="text-text-muted italic">En attente du scan…</p>
            </div>
            <button
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                setStatus("idle");
                setQrDataUrl(null);
                setCode(null);
              }}
              className="text-xs text-text-secondary hover:text-text-primary hover:underline"
            >
              Annuler
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-800 dark:text-red-300">
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
