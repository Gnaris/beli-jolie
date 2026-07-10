"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { provisionShopMailbox } from "@/app/actions/admin/mailbox-provision";
import { markStepCompleted } from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";

/**
 * Formulaire 1 clic : « votre email principal » → crée automatiquement
 * `contact@{domaine}` sur le serveur mail + forward vers l'email fourni +
 * pose la zone DNS complète (SPF/DKIM/MX/DMARC + A/www) dans bind9.
 * L'utilisatrice n'a plus qu'à changer ses nameservers chez son registrar
 * une seule fois (délégation DNS).
 */
export default function MailboxProvisionForm({
  defaultEmail,
  shopDomain,
}: {
  defaultEmail: string;
  shopDomain: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState(defaultEmail);
  const [result, setResult] = useState<null | {
    ok: boolean;
    email?: string;
    nameservers?: string[];
    dnsZoneCreated?: boolean;
    error?: string;
  }>(null);

  const canSubmit =
    !!email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await provisionShopMailbox(email.trim());
      if (res.success) {
        setResult({
          ok: true,
          email: res.email,
          nameservers: res.nameservers,
          dnsZoneCreated: res.dnsZoneCreated,
        });
        toast.success("Boîte pro créée", `Les mails arrivent maintenant sur ${email.trim()}.`);
        await markStepCompleted("email");
      } else {
        setResult({ ok: false, error: res.error });
        toast.error("Impossible", res.error ?? "Réessayez.");
      }
    });
  };

  const handleContinue = () => {
    router.push("/admin/bienvenue/livraison");
  };

  if (result?.ok) {
    const nameservers = result.nameservers ?? [
      "ns1.beliandjolie.com",
      "ns2.beliandjolie.com",
    ];
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5">
          <p className="text-lg font-heading font-bold text-emerald-900 mb-1">
            ✓ Votre boîte pro est active
          </p>
          <p className="text-sm text-emerald-800">
            Toute personne qui écrit à{" "}
            <strong className="font-mono">{result.email}</strong> verra son
            message arriver dans <strong>{email}</strong>. Votre site utilisera
            automatiquement cette boîte pour les confirmations et notifications.
          </p>
        </div>

        {result.dnsZoneCreated && (
          <div className="rounded-2xl bg-sky-50 border border-sky-200 p-5">
            <p className="text-sm font-heading font-bold text-sky-900 mb-2">
              📡 Une seule action manuelle à faire ensuite
            </p>
            <p className="text-sm text-sky-900/90 mb-3">
              Chez l&apos;endroit où vous avez acheté <strong className="font-mono">{shopDomain}</strong>{" "}
              (Hostinger, OVH, Gandi…), ouvrez la page du domaine et changez les
              <strong> serveurs de noms</strong> pour&nbsp;:
            </p>
            <div className="bg-white rounded-xl border border-sky-200 p-3 font-mono text-sm space-y-1">
              {nameservers.map((ns) => (
                <div key={ns} className="text-sky-900">
                  {ns}
                </div>
              ))}
            </div>
            <p className="text-xs text-sky-900/70 mt-3">
              💡 C&apos;est la seule fois où il faudra le faire. Comptez 1 à 6 h
              avant que votre boutique soit accessible à vos clients. Tous les
              réglages techniques (mail, SSL, sous-domaines) se poseront tout
              seuls ensuite.
            </p>
          </div>
        )}

        {!result.dnsZoneCreated && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            <p className="font-semibold mb-1">⚠️ Zone DNS non créée</p>
            <p>
              La boîte mail fonctionne, mais le serveur DNS n&apos;a pas pu
              être configuré automatiquement. Contactez le support pour poser
              les 4 records à la main.
            </p>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleContinue}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-sky-500 to-blue-600 hover:brightness-105 transition"
          >
            Continuer
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-sky-50 border border-sky-200 p-4 text-sm text-sky-900">
        <p className="font-semibold mb-1">🎁 On crée tout pour vous</p>
        <p className="text-sky-900/80">
          On crée <strong className="font-mono">contact@{shopDomain}</strong>{" "}
          sur notre serveur, on configure les réglages techniques (mail, SSL,
          anti-spam) et on branche le transfert vers votre adresse email
          habituelle. Zéro copier-coller.
        </p>
      </div>

      <div>
        <label className="text-sm font-medium text-text-primary mb-1.5 block">
          Votre email principal <span className="text-rose-500">*</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="votre-nom@gmail.com"
          disabled={isPending}
          className="w-full rounded-xl border border-border bg-white px-4 py-3 text-[15px] focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
        />
        <p className="text-xs text-text-secondary/70 mt-1.5">
          C&apos;est cette boîte qui recevra les messages de vos clients.
        </p>
      </div>

      {result?.ok === false && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          {result.error ?? "Erreur inconnue."}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-sky-500 to-blue-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Création en cours…" : "Créer ma boîte pro"}
        </button>
      </div>
    </div>
  );
}
