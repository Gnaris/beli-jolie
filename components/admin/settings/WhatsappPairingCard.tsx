"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getWhatsappStatus,
  startWhatsappPairing,
  stopWhatsappSession,
} from "@/app/actions/admin/whatsapp-pairing";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

interface SerializedState {
  status: "disconnected" | "awaiting_pairing" | "connecting" | "connected" | "logged_out" | "error";
  phoneNumber: string | null;
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
  connectedSince: string | null;
  lastError: string | null;
}

interface Props {
  initialState: SerializedState;
}

/**
 * Carte de pairing WhatsApp (session Baileys propre à la boutique courante — chaque tenant appaire son propre numéro).
 *
 * Flow :
 *  1. La cliente saisit son numéro WhatsApp secondaire (format international ou "0X XX XX XX XX").
 *  2. Clic « Appairer » → server action demande à Meta un code 8 chiffres.
 *  3. Le code s'affiche en gros + compte à rebours (60 s).
 *  4. La cliente ouvre WhatsApp → Appareils connectés → Connecter avec un numéro → tape le code.
 *  5. Statut passe à « Connecté » automatiquement (polling 2 s pendant pairing).
 *
 * État persistant côté serveur dans `lib/whatsapp-session.ts` — on refetch à l'ouverture.
 */
export default function WhatsappPairingCard({ initialState }: Props) {
  const [state, setState] = useState<SerializedState>(initialState);
  const [phoneInput, setPhoneInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const toast = useToast();
  const { confirm } = useConfirm();

  // Horloge pour le compte à rebours du code 8 chiffres.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Au montage, re-fetch l'etat courant du serveur. L'initialState serveur
  // peut etre perime : si la cliente a appaire puis ferme/reouvert la modale,
  // le composant remonte avec `initialState = disconnected` (figé au 1er render
  // de la page) alors que la vraie session est maintenant « connected ».
  useEffect(() => {
    void (async () => {
      const res = await getWhatsappStatus();
      if (res.success) setState(res.state);
    })();
  }, []);

  // Polling de l'état côté serveur quand on attend l'appairage ou qu'on tente
  // de se reconnecter. Dès qu'on est "connected" ou "disconnected", on arrête.
  useEffect(() => {
    const needsPoll =
      state.status === "awaiting_pairing" || state.status === "connecting";
    if (!needsPoll) return;
    const id = setInterval(() => {
      void (async () => {
        const res = await getWhatsappStatus();
        if (res.success) setState(res.state);
      })();
    }, 2_000);
    return () => clearInterval(id);
  }, [state.status]);

  function handleStartPairing() {
    const cleaned = phoneInput.trim();
    if (!cleaned) {
      toast.error("Numéro manquant", "Saisissez votre numéro WhatsApp secondaire.");
      return;
    }
    startTransition(async () => {
      const res = await startWhatsappPairing(cleaned);
      if (!res.success) {
        toast.error("Échec de l'appairage", res.error);
        return;
      }
      setState(res.state);
    });
  }

  async function handleDisconnect() {
    const ok = await confirm({
      type: "warning",
      title: "Déconnecter WhatsApp ?",
      message:
        "La session actuelle sera supprimée. Les clientes déjà vérifiées restent vérifiées, mais plus aucun nouveau numéro ne sera testé tant que vous n'aurez pas appairé un numéro.",
      confirmLabel: "Déconnecter",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await stopWhatsappSession();
      setState(res.state);
      setPhoneInput("");
      toast.success("Déconnecté", "La session WhatsApp a été coupée.");
    });
  }

  const expiresInSec = state.pairingCodeExpiresAt
    ? Math.max(0, Math.round((new Date(state.pairingCodeExpiresAt).getTime() - now) / 1000))
    : 0;

  return (
    <div className="space-y-5">
      {/* Statut courant */}
      <StatusBanner state={state} />

      {/* Pairing form (si pas connecté) */}
      {(state.status === "disconnected" ||
        state.status === "logged_out" ||
        state.status === "error") && (
        <div className="space-y-3">
          <label className="block text-xs font-body font-semibold text-text-primary">
            Numéro WhatsApp à appairer
          </label>
          <div className="flex items-center gap-2">
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="+33 6 12 34 56 78"
              disabled={pending}
              className="flex-1 min-w-0 px-3 py-2.5 border border-border rounded-lg text-sm font-body focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 bg-bg-primary text-text-primary disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleStartPairing}
              disabled={pending || !phoneInput.trim()}
              className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-heading font-semibold transition"
            >
              {pending ? "..." : "Appairer"}
            </button>
          </div>
          <p className="text-[11.5px] text-text-muted leading-relaxed">
            Prenez un numéro <strong>dédié à cette boutique</strong> (2ᵉ carte SIM
            ou numéro VoIP). En cas de ban Meta, votre WhatsApp perso reste
            intact. Chaque boutique utilise son propre numéro.
          </p>
        </div>
      )}

      {/* Code 8 chiffres */}
      {state.status === "awaiting_pairing" && state.pairingCode && (
        <div className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-heading font-bold text-xl">
              ①
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-body font-semibold text-emerald-900">
                Code d'appairage généré pour {state.phoneNumber ? `+${state.phoneNumber}` : "votre numéro"}
              </p>
              <div className="font-heading text-3xl sm:text-4xl font-black tracking-[0.3em] text-emerald-700 tabular-nums select-all">
                {state.pairingCode}
              </div>
              <p className="text-[11.5px] text-emerald-800">
                {expiresInSec > 0 ? (
                  <>Expire dans <strong className="tabular-nums">{expiresInSec}s</strong></>
                ) : (
                  <>Expiré — cliquez à nouveau sur « Appairer » pour en générer un nouveau</>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 pt-2 border-t border-emerald-200">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-heading font-bold text-xl">
              ②
            </div>
            <div className="flex-1 text-[13px] font-body text-emerald-900 leading-relaxed">
              Ouvrez WhatsApp sur votre téléphone →{" "}
              <strong>Réglages</strong> → <strong>Appareils connectés</strong>{" "}
              → <strong>Connecter un appareil</strong> →{" "}
              <strong>« Connecter avec un numéro de téléphone à la place »</strong>{" "}
              → tapez le code ci-dessus.
            </div>
          </div>

          <button
            type="button"
            onClick={handleDisconnect}
            disabled={pending}
            className="text-[12px] text-emerald-700 hover:text-emerald-900 underline"
          >
            Annuler l'appairage
          </button>
        </div>
      )}

      {/* Statut connecté : bouton déconnexion */}
      {state.status === "connected" && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={pending}
            className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-sm font-heading font-semibold transition"
          >
            Déconnecter WhatsApp
          </button>
          <span className="text-[11.5px] text-text-muted">
            La vérification s'arrêtera, les numéros déjà vérifiés restent en cache.
          </span>
        </div>
      )}
    </div>
  );
}

function StatusBanner({ state }: { state: SerializedState }) {
  if (state.status === "connected") {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start gap-3">
        <div className="shrink-0 w-2 h-2 rounded-full bg-emerald-500 mt-1.5 animate-pulse" />
        <div className="flex-1 text-[13px] font-body">
          <p className="font-semibold text-emerald-900">
            Connecté{state.phoneNumber ? ` — +${state.phoneNumber}` : ""}
          </p>
          <p className="text-emerald-800 text-[12px] mt-0.5">
            La vérification « a WhatsApp oui/non » est active. Vous apparaissez
            comme « appareil connecté » dans votre WhatsApp téléphone.
          </p>
        </div>
      </div>
    );
  }
  if (state.status === "connecting") {
    return (
      <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 flex items-start gap-3">
        <div className="shrink-0 w-2 h-2 rounded-full bg-sky-500 mt-1.5 animate-pulse" />
        <div className="flex-1 text-[13px] font-body">
          <p className="font-semibold text-sky-900">Reconnexion en cours…</p>
          <p className="text-sky-800 text-[12px] mt-0.5">
            On remonte la session WhatsApp. Rafraîchissez dans quelques secondes.
          </p>
        </div>
      </div>
    );
  }
  if (state.status === "logged_out") {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
        <div className="shrink-0 w-2 h-2 rounded-full bg-amber-500 mt-1.5" />
        <div className="flex-1 text-[13px] font-body">
          <p className="font-semibold text-amber-900">
            Session invalidée par Meta
          </p>
          <p className="text-amber-800 text-[12px] mt-0.5">
            Vous avez probablement déconnecté l'appareil depuis votre
            téléphone, ou Meta a limité ce numéro. Re-appairez ci-dessous.
          </p>
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
        <div className="shrink-0 w-2 h-2 rounded-full bg-red-500 mt-1.5" />
        <div className="flex-1 text-[13px] font-body">
          <p className="font-semibold text-red-900">Erreur</p>
          <p className="text-red-800 text-[12px] mt-0.5">
            {state.lastError ?? "Erreur inconnue"}
          </p>
        </div>
      </div>
    );
  }
  // disconnected
  if (state.status === "awaiting_pairing") {
    // Pas de bannière : le gros bloc code s'affiche juste en dessous.
    return null;
  }
  return (
    <div className="rounded-xl bg-bg-secondary border border-border px-4 py-3 flex items-start gap-3">
      <div className="shrink-0 w-2 h-2 rounded-full bg-text-muted/50 mt-1.5" />
      <div className="flex-1 text-[13px] font-body">
        <p className="font-semibold text-text-primary">Aucun numéro appairé</p>
        <p className="text-text-muted text-[12px] mt-0.5">
          Appairez un numéro ci-dessous pour activer la vérification
          automatique du logo WhatsApp sur vos fiches client.
        </p>
      </div>
    </div>
  );
}
