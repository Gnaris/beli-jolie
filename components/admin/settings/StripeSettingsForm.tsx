"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateStripeConfig,
  validateStripeSecret,
} from "@/app/actions/admin/stripe-config";
import { useToast } from "@/components/ui/Toast";

type Props = {
  initialHasSecret: boolean;
  initialHasWebhook: boolean;
  initialPublishable: string;
};

export default function StripeSettingsForm({
  initialHasSecret,
  initialHasWebhook,
  initialPublishable,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState(initialPublishable);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [hasSecret, setHasSecret] = useState(initialHasSecret);
  const [hasWebhook, setHasWebhook] = useState(initialHasWebhook);
  const [secretValidated, setSecretValidated] = useState<null | {
    ok: boolean;
    testMode: boolean;
    error?: string;
  }>(null);

  const secretPlaceholder = hasSecret ? "•••••••••••• (déjà en place)" : "sk_live_ ou sk_test_…";
  const webhookPlaceholder = hasWebhook ? "•••••••••••• (déjà en place)" : "whsec_…";

  const handleValidate = () => {
    if (!secretKey.trim()) {
      toast.warning("Clé manquante", "Collez la clé secrète Stripe avant de tester.");
      return;
    }
    startTransition(async () => {
      const res = await validateStripeSecret(secretKey.trim());
      setSecretValidated({ ok: res.valid, testMode: res.testMode, error: res.error });
      if (res.valid) {
        toast.success(
          "Clé acceptée",
          res.testMode ? "Mode TEST détecté." : "Mode LIVE — les paiements arriveront sur votre compte.",
        );
      } else {
        toast.error("Refusée par Stripe", res.error ?? "Vérifiez la clé et réessayez.");
      }
    });
  };

  const canSave =
    (!!secretKey.trim() || hasSecret) &&
    (!!publishableKey.trim()) &&
    (!!webhookSecret.trim() || hasWebhook);

  const handleSave = () => {
    if (!canSave) {
      toast.warning("Champs manquants", "Renseignez les 3 clés Stripe.");
      return;
    }
    startTransition(async () => {
      if (secretKey.trim() && (!secretValidated || !secretValidated.ok)) {
        const check = await validateStripeSecret(secretKey.trim());
        if (!check.valid) {
          toast.error("Clé secrète refusée", check.error ?? "Stripe n'a pas accepté la clé.");
          setSecretValidated({ ok: false, testMode: false, error: check.error });
          return;
        }
        setSecretValidated({ ok: true, testMode: check.testMode });
      }
      const res = await updateStripeConfig({
        secretKey: secretKey.trim() || undefined,
        publishableKey: publishableKey.trim(),
        webhookSecret: webhookSecret.trim() || undefined,
      });
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Impossible d'enregistrer.");
        return;
      }
      // Reset des champs sensibles + mise à jour des placeholders
      if (secretKey.trim()) setHasSecret(true);
      if (webhookSecret.trim()) setHasWebhook(true);
      setSecretKey("");
      setWebhookSecret("");
      setSecretValidated(null);
      toast.success("Enregistré", "Vos clés Stripe sont à jour et chiffrées en base.");
      router.refresh();
    });
  };

  const input =
    "w-full rounded-xl border border-border bg-white px-4 py-2.5 text-[15px] focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";
  const label = "text-sm font-medium text-text-primary mb-1.5 block";

  return (
    <div className="space-y-5">
      <div>
        <label className={label}>
          Clé secrète <span className="text-rose-500">*</span>
          <span className="text-xs text-text-secondary/70 font-normal ml-1">
            (sk_live_… ou sk_test_…)
          </span>
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={secretKey}
            onChange={(e) => {
              setSecretKey(e.target.value);
              setSecretValidated(null);
            }}
            placeholder={secretPlaceholder}
            autoComplete="off"
            className={input + " flex-1"}
          />
          <button
            type="button"
            onClick={handleValidate}
            disabled={isPending || !secretKey.trim()}
            className="px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Test…" : "Tester la clé"}
          </button>
        </div>
        {secretValidated && (
          <p
            className={`text-xs mt-1.5 ${
              secretValidated.ok ? "text-emerald-700" : "text-rose-600"
            }`}
          >
            {secretValidated.ok
              ? secretValidated.testMode
                ? "✓ Acceptée par Stripe — mode TEST."
                : "✓ Acceptée par Stripe — mode LIVE."
              : `✗ ${secretValidated.error ?? "Refusée."}`}
          </p>
        )}
        {hasSecret && !secretKey.trim() && (
          <p className="text-xs text-text-secondary/70 mt-1.5">
            Laissez vide pour conserver la clé actuelle. Renseignez pour la remplacer.
          </p>
        )}
      </div>

      <div>
        <label className={label}>
          Clé publique <span className="text-rose-500">*</span>
          <span className="text-xs text-text-secondary/70 font-normal ml-1">
            (pk_live_… ou pk_test_…)
          </span>
        </label>
        <input
          type="text"
          value={publishableKey}
          onChange={(e) => setPublishableKey(e.target.value)}
          placeholder="pk_live_ ou pk_test_…"
          autoComplete="off"
          className={input}
        />
        <p className="text-xs text-text-secondary/70 mt-1">
          Publique par nature — s&apos;affiche dans le code HTML de la page paiement.
        </p>
      </div>

      <div>
        <label className={label}>
          Signature webhook <span className="text-rose-500">*</span>
          <span className="text-xs text-text-secondary/70 font-normal ml-1">
            (whsec_…)
          </span>
        </label>
        <input
          type="password"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder={webhookPlaceholder}
          autoComplete="off"
          className={input}
        />
        <p className="text-xs text-text-secondary/70 mt-1">
          Dans Stripe : <strong>Développeurs → Webhooks → Ajouter un endpoint</strong>.
          URL à renseigner : votre-site.fr/api/payments/webhook.
        </p>
        {hasWebhook && !webhookSecret.trim() && (
          <p className="text-xs text-text-secondary/70 mt-1">
            Laissez vide pour conserver la signature actuelle.
          </p>
        )}
      </div>

      <div className="rounded-2xl bg-amber-50/60 border border-amber-200 p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">🔐 Vos clés sont chiffrées</p>
        <p className="text-amber-800/80">
          La clé secrète et la signature webhook sont chiffrées en base de données.
          Même nous ne pouvons pas les relire en clair.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || isPending}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-amber-500 to-orange-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
