"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// Bookmarklet : lit les tokens dans localStorage de web.mc.app puis redirige
// vers l'onglet Marketplaces avec les tokens en fragment URL. Aucun caractère
// accentué — certains navigateurs les URL-encodent au drag-and-drop, ce qui
// casse le script.
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
  const [bookmarkletUrl, setBookmarkletUrl] = useState<string>("");
  const bookmarkletAnchorRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    setBookmarkletUrl(buildMicrostoreBookmarklet(window.location.origin));
  }, []);

  // React 19 refuse silencieusement les URL `javascript:` dans les attributs
  // `href` par sécurité. On pose donc l'attribut impérativement.
  //
  // Callback ref (au lieu d'un useEffect) : le noeud <a> n'existe dans le DOM
  // que dans la branche « non connecté » du rendu. Avec un useEffect(deps=[url])
  // classique, le href n'était plus posé si on passait de "connecté" à
  // "déconnecté" à chaud (le useEffect ne redéclenche pas puisque url ne
  // change pas). Résultat : un bouton draggable sans href, favori inutilisable.
  const setBookmarkletAnchor = useCallback(
    (node: HTMLAnchorElement | null) => {
      bookmarkletAnchorRef.current = node;
      if (node && bookmarkletUrl) {
        node.setAttribute("href", bookmarkletUrl);
      }
    },
    [bookmarkletUrl],
  );

  // Import automatique du token si le fragment d'URL en contient un (bookmarklet)
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
        "Vous devrez refaire la manip du favori depuis web.mc.app pour vous reconnecter.",
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
                  ? `⚠️ Session valide jusqu'au ${dateLabel} — pensez à refaire la manip du favori bientôt (${days} j restants).`
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

  // Non connecté — seule méthode : bookmarklet à glisser dans la barre de favoris
  return (
    <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4v16l7-4 7 4V4H5z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-heading text-sm font-bold text-emerald-900">
            Connecter via la barre de favoris
          </div>
          <p className="text-xs text-emerald-800 mt-1 font-body">
            Vous restez connectée à <code className="px-1 rounded bg-emerald-100">web.mc.app</code> ET dans votre admin en même temps.
          </p>

          <ol className="mt-4 space-y-1 text-xs text-emerald-900 font-body list-decimal list-inside">
            <li>Appuyez sur <b>Ctrl+Maj+B</b> pour afficher votre barre de favoris.</li>
            <li><b>Faites glisser</b> le bouton vert ci-dessous dans la barre de favoris.</li>
            <li>Allez sur <code className="px-1 rounded bg-emerald-100">web.mc.app</code> (connectée) et cliquez sur le favori.</li>
          </ol>

          <div className="pt-3">
            {/* href posé impérativement via callback ref — React 19 bloque les
                URL javascript: dans le JSX. La callback ref garantit que le
                href est reposé si le bouton (re)monte dans le DOM après un
                cycle connecté → déconnecté. */}
            {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- href posé via ref pour contourner React 19 */}
            <a
              ref={setBookmarkletAnchor}
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
      </div>
    </div>
  );
}
