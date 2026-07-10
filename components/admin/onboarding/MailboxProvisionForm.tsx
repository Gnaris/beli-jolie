"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { provisionShopMailbox } from "@/app/actions/admin/mailbox-provision";
import { markStepCompleted } from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";

/**
 * Formulaire 1 clic : « votre email principal » → crée automatiquement
 * `contact@{domaine}` sur le serveur mail + forward vers l'email fourni +
 * sauvegarde SMTP.
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
    dnsRecap?: string;
    error?: string;
  }>(null);

  const canSubmit =
    !!email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await provisionShopMailbox(email.trim());
      if (res.success) {
        setResult({ ok: true, email: res.email, dnsRecap: res.dnsRecap });
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
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5">
          <p className="text-lg font-heading font-bold text-emerald-900 mb-1">
            ✓ Votre boîte pro est active
          </p>
          <p className="text-sm text-emerald-800">
            Toute personne qui écrit à{" "}
            <strong className="font-mono">{result.email}</strong> verra son
            message arriver directement dans <strong>{email}</strong>. Votre
            site utilisera automatiquement cette boîte pour envoyer les
            confirmations de commande et les notifications.
          </p>
        </div>

        {result.dnsRecap && (
          <details className="rounded-2xl border border-border bg-bg-secondary/40 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-text-primary">
              🔧 Réglages techniques à ajouter chez votre hébergeur de domaine
            </summary>
            <p className="text-xs text-text-secondary my-3">
              Ces 4 lignes DNS permettent aux emails d&apos;arriver et
              d&apos;être acceptés par Gmail / Outlook. Copiez-les dans votre
              interface Hostinger (ou envoyez-nous ce bloc, on s&apos;en occupe).
            </p>
            <pre className="text-xs bg-white border border-border rounded-xl p-3 overflow-auto whitespace-pre-wrap font-mono text-text-primary/80 max-h-96">
              {result.dnsRecap}
            </pre>
          </details>
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
          sur notre serveur, et on branche automatiquement le transfert vers
          l&apos;adresse email que vous utilisez déjà tous les jours. Aucune
          config à faire, pas de nouveau mot de passe à retenir.
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
