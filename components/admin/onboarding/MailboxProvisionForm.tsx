"use client";

import { useState, useEffect, useTransition } from "react";
import {
  provisionShopMailbox,
  sendMailboxTest,
  checkMailboxDns,
  getMailboxDnsRecords,
  type DnsCheckLine,
  type DnsRecordStructured,
} from "@/app/actions/admin/mailbox-provision";
import { useToast } from "@/components/ui/Toast";

type ProvisionResult = {
  ok: boolean;
  email?: string;
  error?: string;
};

export default function MailboxProvisionForm({
  defaultEmail,
  shopDomain,
  initiallyProvisioned = false,
  provisionedEmail,
}: {
  defaultEmail: string;
  shopDomain: string;
  /** Si vrai, la boîte est déjà provisionnée : on affiche direct la vue post. */
  initiallyProvisioned?: boolean;
  /** Adresse contact@ déjà provisionnée (utilisée si initiallyProvisioned=true). */
  provisionedEmail?: string;
}) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState(defaultEmail);
  const [provision, setProvision] = useState<ProvisionResult | null>(
    initiallyProvisioned && provisionedEmail
      ? { ok: true, email: provisionedEmail }
      : null,
  );
  const [records, setRecords] = useState<DnsRecordStructured[] | null>(null);
  const [dnsCheck, setDnsCheck] = useState<DnsCheckLine[] | null>(null);
  const [dnsAllOk, setDnsAllOk] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [notReceivedOpen, setNotReceivedOpen] = useState(false);

  // Au chargement initial (boîte déjà provisionnée) : recharger les 4 DNS
  // depuis le serveur pour les afficher dans le tableau.
  useEffect(() => {
    if (initiallyProvisioned && provisionedEmail && !records) {
      (async () => {
        const recs = await getMailboxDnsRecords();
        if (recs.success && recs.records) setRecords(recs.records);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initiallyProvisioned, provisionedEmail]);

  const canSubmit =
    !!email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await provisionShopMailbox(email.trim());
      if (res.success) {
        setProvision({ ok: true, email: res.email });
        toast.success("Boîte pro créée", `Les mails arrivent maintenant sur ${email.trim()}.`);
        // markStepCompleted("email") est déclenché plus tard par
        // AdminPersonalEmailStep une fois le mail perso vérifié.
        const recs = await getMailboxDnsRecords();
        if (recs.success && recs.records) setRecords(recs.records);
      } else {
        setProvision({ ok: false, error: res.error });
        toast.error("Impossible", res.error ?? "Réessayez.");
      }
    });
  };

  const handleReset = () => {
    setProvision(null);
    setRecords(null);
    setDnsCheck(null);
    setDnsAllOk(false);
    setTestSent(false);
    setNotReceivedOpen(false);
  };

  const handleSendTest = () => {
    startTransition(async () => {
      const res = await sendMailboxTest();
      if (res.success) {
        setTestSent(true);
        setNotReceivedOpen(false);
        toast.success(
          "Mail test envoyé",
          `Vérifiez ${res.forwardedTo ?? "votre boîte perso"} d'ici quelques minutes.`,
        );
      } else {
        toast.error("Échec", res.error ?? "Envoi impossible.");
      }
    });
  };

  const handleCheckDns = () => {
    startTransition(async () => {
      const res = await checkMailboxDns();
      if (res.success && res.lines) {
        setDnsCheck(res.lines);
        setDnsAllOk(!!res.allOk);
        if (res.allOk) {
          toast.success("DNS OK", "Vos 4 lignes sont bien détectées.");
        }
      } else {
        toast.error("Vérification impossible", res.error ?? "Réessayez.");
      }
    });
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copié", "La valeur est dans votre presse-papier.");
    } catch {
      toast.error("Copie impossible", "Sélectionnez et copiez à la main.");
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  // FORMULAIRE INITIAL — avant provision
  // ══════════════════════════════════════════════════════════════════════
  if (!provision?.ok) {
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

        {provision?.ok === false && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
            {provision.error ?? "Erreur inconnue."}
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

  // ══════════════════════════════════════════════════════════════════════
  // APRÈS PROVISION
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Confirmation création */}
      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5">
        <p className="text-lg font-heading font-bold text-emerald-900 mb-1">
          ✓ Votre boîte pro est active
        </p>
        <p className="text-sm text-emerald-800">
          Toute personne qui écrit à{" "}
          <strong className="font-mono">{provision.email}</strong> verra son
          message arriver dans <strong>{email}</strong>. Il reste{" "}
          <strong>une dernière étape</strong> ci-dessous, indispensable.
        </p>
      </div>

      {/* BANDEAU ROUGE — Étape obligatoire */}
      <div className="rounded-2xl bg-rose-50 border-2 border-rose-300 p-5">
        <p className="text-base font-heading font-bold text-rose-900 mb-1 flex items-center gap-2">
          ⚠️ Étape indispensable et obligatoire
        </p>
        <p className="text-sm text-rose-900">
          Tant que vous n&apos;avez pas ajouté les <strong>4 lignes ci-dessous</strong>{" "}
          chez votre registrar (Hostinger, OVH, Gandi…), <strong>aucun client ne
          pourra vous écrire</strong>. Comptez 5 à 30 minutes après ajout pour
          que ça marche.
        </p>
      </div>

      {/* Tableau des 4 DNS avec bouton copier */}
      {records && (
        <div className="rounded-2xl border border-border bg-white overflow-hidden">
          <div className="bg-bg-secondary/60 px-5 py-3 border-b border-border">
            <p className="font-heading font-bold text-text-primary">
              📋 Les 4 lignes à copier dans les DNS de {shopDomain}
            </p>
          </div>
          <div className="divide-y divide-border">
            {records.map((r) => (
              <div key={r.label} className="p-4 flex gap-4 items-start">
                <div className="w-16 flex-shrink-0">
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-sky-100 text-sky-800 text-xs font-mono font-semibold">
                    {r.label}
                  </span>
                </div>
                <div className="flex-1 min-w-0 space-y-1 text-sm">
                  <div className="grid grid-cols-[80px_1fr] gap-x-2">
                    <span className="text-text-secondary">Type</span>
                    <span className="font-mono">{r.type}</span>
                    <span className="text-text-secondary">Nom</span>
                    <span className="font-mono break-all">{r.name}</span>
                    {r.priority !== undefined && (
                      <>
                        <span className="text-text-secondary">Priorité</span>
                        <span className="font-mono">{r.priority}</span>
                      </>
                    )}
                    <span className="text-text-secondary">Valeur</span>
                    <span className="font-mono break-all text-text-primary bg-bg-secondary/40 px-2 py-1 rounded">
                      {r.value || <em className="text-amber-700">Clé manquante — recréez la boîte.</em>}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(r.value)}
                  disabled={!r.value}
                  className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-white hover:bg-bg-secondary/50 text-xs font-semibold text-text-primary disabled:opacity-40"
                >
                  📎 Copier
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bouton vérifier DNS + tableau résultat */}
      <div className="rounded-2xl border border-border bg-white p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div>
            <p className="font-heading font-bold text-text-primary">
              Vérifier que les DNS sont en place
            </p>
            <p className="text-sm text-text-secondary">
              Cliquez après avoir ajouté les 4 lignes chez votre registrar.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCheckDns}
            disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold disabled:opacity-60"
          >
            {isPending ? "Vérification…" : "🔍 Vérifier maintenant"}
          </button>
        </div>
        {dnsCheck && (
          <div className="rounded-xl border border-border overflow-hidden">
            {dnsCheck.map((l) => (
              <div
                key={l.label}
                className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 text-sm ${
                  l.status === "ok"
                    ? "bg-emerald-50/50"
                    : l.status === "wrong"
                      ? "bg-amber-50/60"
                      : "bg-rose-50/60"
                }`}
              >
                <span className="text-xl">
                  {l.status === "ok" ? "✅" : l.status === "wrong" ? "⚠️" : "❌"}
                </span>
                <span className="w-16 font-mono text-xs font-bold text-text-primary">
                  {l.label}
                </span>
                <span className="text-text-primary flex-1">{l.detail}</span>
              </div>
            ))}
            {!dnsAllOk && (
              <div className="px-4 py-3 bg-bg-secondary/50 text-xs text-text-secondary">
                💡 Si une ligne manque encore, c&apos;est peut-être normal —
                les DNS mettent 5 à 30 minutes à se propager. Réessayez d&apos;ici
                quelques minutes.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bouton test envoi mail + gestion « je n'ai pas reçu » */}
      <div className="rounded-2xl border border-border bg-white p-5">
        <p className="font-heading font-bold text-text-primary mb-1">
          Tester la réception
        </p>
        <p className="text-sm text-text-secondary mb-3">
          On envoie un mail sur <span className="font-mono">{provision.email}</span>.
          Vous devriez le recevoir sur <strong>{email}</strong> en 1-2 min.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleSendTest}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60"
          >
            {isPending ? "Envoi…" : testSent ? "✓ Renvoyer le mail test" : "📧 Envoyer un mail test"}
          </button>
          {testSent && (
            <button
              type="button"
              onClick={() => setNotReceivedOpen((v) => !v)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold"
            >
              ❌ Je n&apos;ai pas reçu le mail
            </button>
          )}
        </div>

        {notReceivedOpen && (
          <div className="mt-4 rounded-xl bg-rose-50 border border-rose-200 p-4 space-y-3">
            <p className="text-sm text-rose-900 font-semibold">
              Deux causes possibles :
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleReset}
                className="w-full text-left px-4 py-3 rounded-lg bg-white border border-rose-200 hover:border-rose-400 text-sm text-text-primary"
              >
                <strong>1.</strong> J&apos;ai mal saisi mon email principal —
                recommencer avec une autre adresse.
              </button>
              <button
                type="button"
                onClick={handleSendTest}
                disabled={isPending}
                className="w-full text-left px-4 py-3 rounded-lg bg-white border border-rose-200 hover:border-rose-400 text-sm text-text-primary disabled:opacity-50"
              >
                <strong>2.</strong> Mon email est bon — renvoyer un mail test
                pour réessayer (vérifiez aussi vos spams).
              </button>
            </div>
            <p className="text-xs text-rose-900/80">
              Si aucune des deux ne marche après 5 min, contactez le support :
              il y a probablement un bug côté serveur mail.
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
