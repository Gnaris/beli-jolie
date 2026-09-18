"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStripePaymentMethodEnabled } from "@/app/actions/admin/payment-methods";
import { useToast } from "@/components/ui/Toast";
import type {
  OptionalStripeMethod,
  StripeMethodsEnabled,
} from "@/lib/stripe-payment-methods-enabled";

type Props = {
  initial: StripeMethodsEnabled;
};

type MethodMeta = {
  key: OptionalStripeMethod;
  label: string;
  hint: string;
  activationUrl: string;
};

const METHODS: MethodMeta[] = [
  {
    key: "paypal",
    label: "PayPal",
    hint: "Redirect vers paypal.com puis retour. Utilisable partout.",
    activationUrl: "https://dashboard.stripe.com/settings/payment_methods",
  },
  {
    key: "billie",
    label: "Billie (B2B paiement à 30 jours)",
    hint: "Billie avance les fonds sous 1-2 jours ouvrés, votre cliente paie à 30j. B2B uniquement.",
    activationUrl: "https://dashboard.stripe.com/settings/payment_methods",
  },
  {
    key: "bancontact",
    label: "Bancontact (Belgique)",
    hint: "Standard belge, ~1,4 % + 0,25 €. Masqué pour les acheteurs hors Belgique.",
    activationUrl: "https://dashboard.stripe.com/settings/payment_methods",
  },
  {
    key: "ideal",
    label: "iDEAL (Pays-Bas)",
    hint: "Standard néerlandais, ~0,29 € flat. Masqué pour les acheteurs hors Pays-Bas.",
    activationUrl: "https://dashboard.stripe.com/settings/payment_methods",
  },
];

export default function OnlinePaymentMethodsForm({ initial }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<StripeMethodsEnabled>(initial);

  function toggle(method: OptionalStripeMethod) {
    const next = !state[method];
    setState((prev) => ({ ...prev, [method]: next }));
    startTransition(async () => {
      const res = await setStripePaymentMethodEnabled(method, next);
      if (!res.success) {
        setState((prev) => ({ ...prev, [method]: !next }));
        toast.error("Erreur", res.error ?? "Impossible d'enregistrer.");
        return;
      }
      toast.success(
        next ? "Activé" : "Désactivé",
        next
          ? `${labelFor(method)} apparaîtra au checkout (si activé côté Stripe).`
          : `${labelFor(method)} n'apparaîtra plus au checkout.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-xs text-amber-900 leading-relaxed">
        <p className="font-semibold mb-1">⚠️ Étape préalable</p>
        Chaque méthode doit d'abord être activée dans votre{" "}
        <a
          href="https://dashboard.stripe.com/settings/payment_methods"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-amber-950"
        >
          dashboard Stripe
        </a>{" "}
        (Réglages → Moyens de paiement). Cocher ici sans l'avoir activé côté
        Stripe fera échouer le paiement. La Carte est toujours active par
        défaut.
      </div>

      {METHODS.map((m) => (
        <div
          key={m.key}
          className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border bg-bg-secondary/50"
        >
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary">{m.label}</p>
            <p className="text-xs text-text-secondary mt-1">{m.hint}</p>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={() => toggle(m.key)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              state[m.key] ? "bg-emerald-500" : "bg-zinc-300"
            }`}
            aria-pressed={state[m.key]}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                state[m.key] ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  );
}

function labelFor(method: OptionalStripeMethod): string {
  return METHODS.find((m) => m.key === method)?.label ?? method;
}
