"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  saveMicrostorePictureStation,
  clearMicrostorePictureStation,
  sendProductPhotosToMicrostore,
  type SendProductPhotosResult,
} from "@/app/actions/admin/microstore-picture-station";

interface Props {
  initiallyConfigured: boolean;
  initialExpiresAtIso: string | null;
  initialShortUrl: string | null;
}

function formatFrenchDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysUntil(iso: string): number {
  const d = new Date(iso).getTime();
  return Math.floor((d - Date.now()) / (1000 * 60 * 60 * 24));
}

function tone(days: number): "ok" | "warn" | "off" {
  if (days < 0) return "off";
  if (days <= 1) return "warn";
  return "ok";
}

export default function MicrostorePictureStationCard({
  initiallyConfigured,
  initialExpiresAtIso,
  initialShortUrl,
}: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();
  const [input, setInput] = useState(initialShortUrl ?? "");
  const [configured, setConfigured] = useState(initiallyConfigured);
  const [expiresAtIso, setExpiresAtIso] = useState<string | null>(initialExpiresAtIso);
  const [pending, startTransition] = useTransition();
  const [sending, startSending] = useTransition();
  const [sendRef, setSendRef] = useState("");
  const [sendResult, setSendResult] = useState<SendProductPhotosResult | null>(null);

  const remainingDays = expiresAtIso ? daysUntil(expiresAtIso) : null;
  const badgeTone = remainingDays !== null ? tone(remainingDays) : null;

  const badgeClass =
    badgeTone === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : badgeTone === "warn"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : badgeTone === "off"
          ? "bg-rose-50 text-rose-700 border-rose-200"
          : "bg-bg-secondary text-text-muted border-border";

  const badgeLabel =
    badgeTone === "off"
      ? "Expiré"
      : remainingDays === 0
        ? "Expire aujourd'hui"
        : remainingDays === 1
          ? "Expire demain"
          : remainingDays !== null
            ? `Encore ${remainingDays} jours`
            : "";

  const handleSave = () => {
    if (!input.trim()) {
      toast.error("Collez d'abord le lien de la station.");
      return;
    }
    startTransition(async () => {
      const res = await saveMicrostorePictureStation(input);
      if (!res.success) {
        toast.error(res.error || "Échec de l'enregistrement.");
        return;
      }
      setConfigured(true);
      setExpiresAtIso(res.expiresAtIso ?? null);
      toast.success("Lien enregistré.");
      router.refresh();
    });
  };

  const handleSend = () => {
    if (!sendRef.trim()) {
      toast.error("Entre une référence produit BJ.");
      return;
    }
    setSendResult(null);
    startSending(async () => {
      const res = await sendProductPhotosToMicrostore(sendRef.trim());
      setSendResult(res);
      if (res.success) {
        toast.success(`Photos envoyées vers Microstore.`);
      } else {
        toast.error(res.error || "Envoi échoué.");
      }
    });
  };

  const handleClear = async () => {
    const ok = await confirm({
      type: "danger",
      title: "Retirer le lien de station ?",
      message:
        "Vous ne pourrez plus envoyer de photos vers Microstore tant qu'un nouveau lien ne sera pas collé.",
      confirmLabel: "Retirer",
    });
    if (!ok) return;
    startTransition(async () => {
      await clearMicrostorePictureStation();
      setConfigured(false);
      setExpiresAtIso(null);
      setInput("");
      toast.success("Lien retiré.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {configured && expiresAtIso ? (
        <div
          className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 ${badgeClass}`}
        >
          <div className="text-sm font-body">
            <div className="font-semibold">
              Valide jusqu'au {formatFrenchDateTime(expiresAtIso)}
            </div>
            <div className="text-xs opacity-80">{badgeLabel}</div>
          </div>
          <button
            type="button"
            onClick={handleClear}
            disabled={pending}
            className="h-8 px-3 rounded-lg text-xs font-body font-bold bg-white/60 hover:bg-white transition-colors border border-current/20"
          >
            Retirer
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-bg-secondary/40 px-4 py-3 text-sm text-text-secondary font-body">
          Aucun lien enregistré pour le moment. Vos photos ne peuvent pas être
          envoyées à Microstore tant que ce lien n'est pas configuré.
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-xs font-body font-semibold uppercase tracking-[0.16em] text-text-muted">
          Lien de la station de transfert
        </label>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://microstore.app/s/xxxxx"
          className="w-full h-10 px-3 rounded-xl border border-border bg-bg-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-text-primary/20"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <p className="text-xs text-text-muted font-body">
          Depuis votre back Microstore, générez un lien de « Station de transfert
          d'images » et collez-le ici. Le lien reste valide environ 7 jours.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !input.trim()}
          className="h-10 px-4 rounded-xl bg-text-primary text-text-inverse text-sm font-body font-bold hover:bg-text-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Vérification…" : "Enregistrer le lien"}
        </button>
      </div>

      {configured && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          <div className="text-xs font-body font-semibold uppercase tracking-[0.16em] text-text-muted">
            Envoyer les photos d'un produit
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={sendRef}
              onChange={(e) => setSendRef(e.target.value)}
              placeholder="Ex : A2620"
              className="flex-1 h-10 px-3 rounded-xl border border-border bg-bg-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-text-primary/20"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !sendRef.trim()}
              className="h-10 px-4 rounded-xl bg-sky-600 text-white text-sm font-body font-bold hover:bg-sky-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {sending ? "Envoi en cours…" : "Envoyer les photos"}
            </button>
          </div>
          <p className="text-xs text-text-muted font-body">
            On récupère la fiche Microstore par sa référence, on envoie chaque photo au CDN puis on met à jour la fiche.
          </p>

          {sendResult && (
            <SendResultPanel result={sendResult} />
          )}
        </div>
      )}
    </div>
  );
}

function SendResultPanel({ result }: { result: SendProductPhotosResult }) {
  const okBase = "bg-emerald-50 text-emerald-900 border-emerald-200";
  const koBase = "bg-rose-50 text-rose-900 border-rose-200";
  const totalSent =
    result.colors?.reduce((n, c) => n + c.uploadedUrls.length, 0) ?? 0;
  const matched = result.colors?.filter((c) => c.matchedSkuIds.length > 0).length ?? 0;

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm font-body space-y-3 ${result.success ? okBase : koBase}`}>
      <div>
        <div className="font-semibold">
          {result.success ? "✓ Photos envoyées à Microstore" : "✗ Envoi échoué"}
        </div>
        {result.error && (
          <div className="text-xs mt-1 opacity-90">{result.error}</div>
        )}
        {result.reference && result.microstoreGoodsName && (
          <div className="text-xs opacity-80 mt-1">
            <b>{result.reference}</b> · {result.microstoreGoodsName} (Microstore #{result.microstoreGoodsId})
          </div>
        )}
        {result.success && (
          <div className="text-xs opacity-80 mt-1">
            {totalSent} photo{totalSent > 1 ? "s" : ""} envoyée{totalSent > 1 ? "s" : ""} sur {matched} couleur{matched > 1 ? "s" : ""}.
          </div>
        )}
      </div>

      {result.colors && result.colors.length > 0 && (
        <div className="space-y-2">
          {result.colors.map((c, i) => (
            <div key={i} className="rounded-lg bg-white/60 border border-current/20 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                <div>
                  {c.colorName}
                  {c.matchedMicrostoreColor && c.matchedMicrostoreColor !== c.colorName && (
                    <span className="opacity-60 font-normal"> → {c.matchedMicrostoreColor} chez Microstore</span>
                  )}
                </div>
                <div className="opacity-70">
                  {c.uploadedUrls.length}/{c.imagesLocal.length} photo{c.imagesLocal.length > 1 ? "s" : ""}
                </div>
              </div>
              {c.error && <div className="text-xs mt-1 text-rose-700">{c.error}</div>}
              {c.uploadedUrls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.uploadedUrls.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={u}
                        alt=""
                        className="w-14 h-14 rounded-lg border border-current/20 bg-white object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
