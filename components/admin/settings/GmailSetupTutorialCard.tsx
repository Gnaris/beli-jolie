"use client";

import { useState } from "react";

interface Props {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  proEmail: string;
  shopName: string;
}

function CopyableValue({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={`text-white flex-1 truncate ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value || <span className="italic text-slate-500">(non configuré)</span>}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        disabled={!value}
        className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition"
      >
        {copied ? "✓" : "Copier"}
      </button>
    </div>
  );
}

export default function GmailSetupTutorialCard({
  smtpHost,
  smtpPort,
  smtpUser,
  proEmail,
  shopName,
}: Props) {
  const displayName = shopName || "Boutique";
  const displayEmail = proEmail || smtpUser || "contact@…";
  const dmarcFilterSubject = `Report Domain: ${
    proEmail?.split("@")[1] || "beliandjolie.com"
  }`;

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-secondary">
        Pour que vos réponses partent depuis <span className="font-semibold">{displayEmail}</span>{" "}
        et pas depuis votre Gmail perso, il faut configurer Gmail une fois. Suivez les étapes
        ci-dessous.
      </p>

      {/* Bloc valeurs SMTP */}
      <div className="rounded-xl bg-slate-900 text-slate-100 p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold mb-3">
          Valeurs à copier-coller
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 w-20 shrink-0">Serveur</span>
            <CopyableValue value={smtpHost} />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 w-20 shrink-0">Port</span>
            <CopyableValue value={String(smtpPort)} />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 w-20 shrink-0">Utilisateur</span>
            <CopyableValue value={smtpUser} />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 w-20 shrink-0">Mot de passe</span>
            <span className="text-slate-500 flex-1 italic text-xs truncate">
              celui de la boîte pro (voir bloc « Sécurité » plus bas)
            </span>
          </div>
        </dl>
      </div>

      {/* Étapes */}
      <div className="space-y-3">
        <details className="group rounded-xl border border-border bg-bg-secondary open:bg-bg-primary open:border-border-strong open:shadow-sm transition-all" open>
          <summary className="flex items-center gap-3 p-4 cursor-pointer list-none">
            <div className="w-8 h-8 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
              1
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-text-primary">Ouvrez les paramètres Gmail</div>
              <div className="text-xs text-text-muted mt-0.5">
                Sur <span className="font-mono">mail.google.com</span>
              </div>
            </div>
            <svg
              className="w-4 h-4 text-text-muted transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </summary>
          <div className="px-4 pb-4 pl-16 text-sm text-text-secondary space-y-1.5">
            <p>1. Cliquez sur l'engrenage ⚙ en haut à droite.</p>
            <p>
              2. Cliquez sur <span className="font-semibold">« Voir tous les paramètres »</span>.
            </p>
            <p>
              3. Allez dans l'onglet{" "}
              <span className="font-semibold">« Comptes et importation »</span>.
            </p>
          </div>
        </details>

        <details className="group rounded-xl border border-border bg-bg-secondary open:bg-bg-primary open:border-border-strong open:shadow-sm transition-all">
          <summary className="flex items-center gap-3 p-4 cursor-pointer list-none">
            <div className="w-8 h-8 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
              2
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-text-primary">
                Ajoutez l'adresse pro comme expéditeur
              </div>
              <div className="text-xs text-text-muted mt-0.5">
                Section « Envoyer des e-mails en tant que »
              </div>
            </div>
            <svg
              className="w-4 h-4 text-text-muted transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </summary>
          <div className="px-4 pb-4 pl-16 text-sm text-text-secondary space-y-1.5">
            <p>
              1. Cliquez <span className="font-semibold">« Ajouter une autre adresse e-mail »</span>
              .
            </p>
            <p>
              2. Nom :{" "}
              <span className="font-mono bg-bg-secondary px-1.5 py-0.5 rounded border border-border">
                {displayName}
              </span>{" "}
              — Adresse :{" "}
              <span className="font-mono bg-bg-secondary px-1.5 py-0.5 rounded border border-border break-all">
                {displayEmail}
              </span>
            </p>
            <p>
              3. <span className="font-semibold">Décochez</span> « Traiter comme un alias ».
            </p>
            <p>
              4. Écran suivant : reprenez les valeurs du tableau noir ci-dessus (Serveur, Port,
              Utilisateur, Mot de passe). Laissez cochée{" "}
              <span className="font-semibold">« TLS »</span>.
            </p>
            <p>
              5. Gmail vous envoie un <span className="font-semibold">code de vérification</span> —
              il arrive dans votre Gmail (grâce au transfert du bloc du dessus). Copiez-le →{" "}
              <span className="font-semibold">Vérifier</span>.
            </p>
          </div>
        </details>

        <details className="group rounded-xl border border-border bg-bg-secondary open:bg-bg-primary open:border-border-strong open:shadow-sm transition-all">
          <summary className="flex items-center gap-3 p-4 cursor-pointer list-none">
            <div className="w-8 h-8 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
              3
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-text-primary">Le réglage qui change tout</div>
              <div className="text-xs text-text-muted mt-0.5">
                Répondre automatiquement avec la bonne adresse
              </div>
            </div>
            <svg
              className="w-4 h-4 text-text-muted transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </summary>
          <div className="px-4 pb-4 pl-16 text-sm text-text-secondary space-y-1.5">
            <p>
              Toujours dans <span className="font-semibold">« Comptes et importation »</span>, à la
              ligne <span className="font-semibold">« Lorsque vous répondez à un message »</span>{" "}
              :
            </p>
            <p>
              → Cochez{" "}
              <span className="font-semibold">
                « Répondre à partir de la même adresse que celle du destinataire »
              </span>
              .
            </p>
            <p className="text-xs text-text-muted italic mt-2">
              Cette ligne n'apparaît qu'une fois l'étape 2 terminée.
            </p>
          </div>
        </details>

        <details className="group rounded-xl border border-dashed border-border-strong bg-bg-secondary/50">
          <summary className="flex items-center gap-3 p-4 cursor-pointer list-none">
            <div className="w-8 h-8 rounded-full bg-bg-tertiary text-text-secondary flex items-center justify-center font-bold text-sm shrink-0">
              ✦
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-text-primary">
                Bonus — cacher les rapports DMARC
              </div>
              <div className="text-xs text-text-muted mt-0.5">
                Optionnel — nettoie les rapports techniques quotidiens
              </div>
            </div>
            <svg
              className="w-4 h-4 text-text-muted transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </summary>
          <div className="px-4 pb-4 pl-16 text-sm text-text-secondary space-y-1.5">
            <p>
              Vous recevez chaque jour des mails « {dmarcFilterSubject}… » — c'est technique et sans
              action de votre part.
            </p>
            <p>
              Dans Gmail : ouvrez un rapport → <span className="font-semibold">⋮</span> →{" "}
              <span className="font-semibold">« Filtrer les messages similaires »</span> → Objet :{" "}
              <span className="font-mono bg-bg-secondary px-1.5 py-0.5 rounded border border-border">
                {dmarcFilterSubject}
              </span>{" "}
              → <span className="font-semibold">Créer le filtre</span> → cochez{" "}
              <span className="font-semibold">« Ignorer la boîte de réception »</span> et{" "}
              <span className="font-semibold">« Marquer comme lu »</span>.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
