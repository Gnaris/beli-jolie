"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateSmtpConfig,
  testSmtpConfig,
} from "@/app/actions/admin/smtp-config";
import { markStepCompleted } from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";

type Props = {
  initial: {
    host: string;
    port: string;
    secure: boolean;
    user: string;
    fromEmail: string;
    fromName: string;
    hasPassword: boolean;
  };
  defaultTestTo: string;
};

/**
 * Formulaire wizard SMTP : 7 champs (serveur, port, chiffrement, identifiant,
 * mot de passe, expéditeur, nom expéditeur) + bouton « Tester » qui envoie
 * un vrai email de test avant la sauvegarde définitive.
 */
export default function SmtpStepForm({ initial, defaultTestTo }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port || "587");
  const [secure, setSecure] = useState(initial.secure);
  const [user, setUser] = useState(initial.user);
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [fromName, setFromName] = useState(initial.fromName);
  const [testTo, setTestTo] = useState(defaultTestTo);
  const [lastTest, setLastTest] = useState<null | {
    ok: boolean;
    message: string;
  }>(null);

  const passwordPlaceholder = initial.hasPassword
    ? "•••••••••••• (déjà en place)"
    : "Mot de passe SMTP";

  const canSave =
    !!host.trim() && !!port.trim() && !!user.trim() && (!!password.trim() || initial.hasPassword);
  const canTest =
    !!host.trim() && !!port.trim() && !!user.trim() && !!password.trim() && !!testTo.trim();

  const handleTest = () => {
    if (!canTest) {
      toast.warning(
        "Champs manquants",
        "Renseignez serveur, port, identifiant, mot de passe et adresse de test.",
      );
      return;
    }
    startTransition(async () => {
      const res = await testSmtpConfig({
        host: host.trim(),
        port: port.trim(),
        secure,
        user: user.trim(),
        password: password.trim(),
        fromEmail: fromEmail.trim() || undefined,
        fromName: fromName.trim() || undefined,
        testTo: testTo.trim(),
      });
      if (res.valid) {
        setLastTest({
          ok: true,
          message: `Email envoyé à ${testTo.trim()} — vérifiez votre boîte (aussi les indésirables).`,
        });
        toast.success("Email envoyé", "Vérifiez votre boîte de réception.");
      } else {
        setLastTest({ ok: false, message: res.error ?? "Échec du test." });
        toast.error("Échec", res.error ?? "Impossible d'envoyer.");
      }
    });
  };

  const handleSave = () => {
    if (!canSave) {
      toast.warning(
        "Champs manquants",
        "Renseignez au moins le serveur, le port, l'identifiant et le mot de passe.",
      );
      return;
    }
    startTransition(async () => {
      const res = await updateSmtpConfig({
        host: host.trim(),
        port: port.trim(),
        secure: secure ? "true" : "false",
        user: user.trim(),
        password: password.trim() || undefined,
        fromEmail: fromEmail.trim() || user.trim(),
        fromName: fromName.trim() || undefined,
      });
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Impossible d'enregistrer.");
        return;
      }
      const step = await markStepCompleted("email");
      if (!step.success) {
        toast.warning("Enregistré", "Mais l'étape n'a pas pu être marquée.");
      } else {
        toast.success("Messagerie branchée", "On passe à l'étape suivante.");
      }
      router.push("/admin/bienvenue/livraison");
    });
  };

  const input =
    "w-full rounded-xl border border-border bg-white px-4 py-2.5 text-[15px] focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20";
  const label = "text-sm font-medium text-text-primary mb-1.5 block";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label className={label}>
            Serveur SMTP <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.gmail.com"
            className={input}
          />
        </div>
        <div>
          <label className={label}>
            Port <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="587"
            className={input}
          />
        </div>
      </div>

      <div>
        <label className={label}>Chiffrement</label>
        <CustomSelect
          value={secure ? "true" : "false"}
          onChange={(v) => setSecure(v === "true")}
          options={[
            { value: "false", label: "STARTTLS (port 587 recommandé)" },
            { value: "true", label: "TLS implicite (port 465)" },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>
            Identifiant <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="contact@ma-boutique.fr"
            autoComplete="off"
            className={input}
          />
        </div>
        <div>
          <label className={label}>
            Mot de passe {!initial.hasPassword && <span className="text-rose-500">*</span>}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={passwordPlaceholder}
            autoComplete="new-password"
            className={input}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>Adresse expéditeur</label>
          <input
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="Par défaut : identique à l'identifiant"
            className={input}
          />
        </div>
        <div>
          <label className={label}>Nom expéditeur</label>
          <input
            type="text"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Ma Boutique"
            className={input}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-sky-50/60 border border-sky-200 p-4 space-y-3">
        <p className="text-sm font-semibold text-sky-900">
          🧪 Testez avant de sauvegarder
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="Adresse où recevoir le test"
            className={input + " flex-1"}
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={!canTest || isPending}
            className="px-4 py-2.5 rounded-xl border border-sky-300 bg-white text-sky-800 text-sm font-semibold hover:bg-sky-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Envoi…" : "Envoyer un test"}
          </button>
        </div>
        {lastTest && (
          <p
            className={`text-sm ${
              lastTest.ok ? "text-emerald-700" : "text-rose-600"
            }`}
          >
            {lastTest.ok ? "✓ " : "✗ "}
            {lastTest.message}
          </p>
        )}
      </div>

      <div className="rounded-2xl bg-slate-50/60 border border-slate-200 p-4 text-sm text-slate-700">
        <p className="font-semibold mb-1">🔐 Vos identifiants sont chiffrés</p>
        <p className="text-slate-700/80">
          Le mot de passe SMTP est chiffré en base de données. Il ne peut plus
          être relu en clair une fois sauvegardé.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || isPending}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-sky-500 to-blue-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Enregistrement…" : "Enregistrer et continuer"}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
