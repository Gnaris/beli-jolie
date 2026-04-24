"use client";

import { useState, useTransition } from "react";
import { updateSmtpConfig, validateSmtpConnection } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  hasConfig: boolean;
}

const DEFAULT_PORT = "587";

export default function SmtpConfig({ hasConfig }: Props) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState(DEFAULT_PORT);
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [status, setStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasConfig ? "valid" : "none"
  );
  const [isSaving, startSaving] = useTransition();
  const [isValidating, startValidating] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [editing, setEditing] = useState(!hasConfig);

  function handlePortChange(next: string) {
    setPort(next);
    if (next === "465" && !secure) setSecure(true);
    if (next === "587" && secure) setSecure(false);
    if (status === "valid" || status === "invalid") setStatus("none");
  }

  function handleValidate() {
    if (!host.trim() || !user.trim() || !password) return;
    const testTo = fromEmail.trim() || user.trim();
    showLoading();
    startValidating(async () => {
      try {
        setStatus("checking");
        const result = await validateSmtpConnection({
          host: host.trim(),
          port: port.trim(),
          secure,
          user: user.trim(),
          password,
          testTo,
          fromEmail: fromEmail.trim() || user.trim(),
          fromName: fromName.trim(),
        });
        if (result.valid) {
          setStatus("valid");
          toast.success(
            "Email de test envoyé",
            `Vérifiez la boîte de réception de ${testTo} — si le message est bien arrivé, vous pouvez enregistrer la configuration.`
          );
        } else {
          setStatus("invalid");
          toast.error(
            "Connexion échouée",
            result.error ?? "Identifiants SMTP invalides."
          );
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleSave() {
    showLoading();
    startSaving(async () => {
      try {
        const result = await updateSmtpConfig({
          host: host.trim(),
          port: port.trim(),
          secure,
          user: user.trim(),
          password,
          fromEmail: fromEmail.trim(),
          fromName: fromName.trim(),
          notifyEmail: notifyEmail.trim(),
        });
        if (result.success) {
          toast.success("Enregistré", "Configuration email sauvegardée.");
          setEditing(false);
          setHost("");
          setPort(DEFAULT_PORT);
          setSecure(false);
          setUser("");
          setPassword("");
          setFromEmail("");
          setFromName("");
          setNotifyEmail("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  const isPending = isSaving || isValidating;
  const canValidate = host.trim() && port.trim() && user.trim() && password;
  const canSave = canValidate && fromEmail.trim() && status === "valid";

  return (
    <div className="space-y-4">
      {/* Aide non-technique */}
      <div className="rounded-lg bg-bg-secondary border border-border px-4 py-3 text-sm font-body text-text-secondary">
        <p className="mb-1">
          <strong className="text-text-primary">Comment trouver ces informations ?</strong>
        </p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Chez votre hébergeur (Hostinger, OVH, Gmail…), créez une adresse email (ex. <em>contact@maboutique.com</em>).</li>
          <li>Votre hébergeur vous donne les informations SMTP (serveur, port, nom d&apos;utilisateur, mot de passe).</li>
          <li>Exemple Hostinger : serveur <code>smtp.hostinger.com</code>, port <code>465</code>, TLS coché.</li>
          <li>Exemple Gmail : serveur <code>smtp.gmail.com</code>, port <code>587</code>, TLS décoché — nécessite un mot de passe d&apos;application.</li>
          <li>Cliquez &laquo; Tester la connexion &raquo; : un vrai email de test est envoyé à votre adresse d&apos;envoi — vérifiez votre boîte de réception.</li>
        </ol>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            status === "valid" ? "bg-[#22C55E]" :
            status === "invalid" ? "bg-[#EF4444]" :
            status === "checking" ? "bg-[#F59E0B] animate-pulse" :
            "bg-[#D1D1D1]"
          }`}
        />
        <span className="font-body text-sm text-text-secondary">
          {status === "valid" && "Envoi d'emails actif (SMTP) — email de test envoyé"}
          {status === "invalid" && "Connexion SMTP échouée"}
          {status === "checking" && "Envoi d'un email de test..."}
          {status === "none" && "Non configuré"}
        </span>
      </div>

      {!editing && hasConfig ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
            ••••••••••••••••
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-body text-text-secondary hover:text-text-primary underline"
          >
            Modifier
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-body text-text-secondary mb-1">
                Serveur SMTP (ex. smtp.hostinger.com)
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  if (status === "valid" || status === "invalid") setStatus("none");
                }}
                placeholder="smtp.hostinger.com"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Port (465 ou 587)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={port}
                onChange={(e) => handlePortChange(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="587"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 h-10 text-sm font-body text-text-primary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={secure}
                  onChange={(e) => {
                    setSecure(e.target.checked);
                    if (status === "valid" || status === "invalid") setStatus("none");
                  }}
                  disabled={isPending}
                  className="w-4 h-4 rounded border-border"
                />
                Connexion sécurisée (TLS) — cochez pour le port 465
              </label>
            </div>
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Identifiant SMTP (souvent l&apos;adresse email)
              </label>
              <input
                type="text"
                value={user}
                onChange={(e) => {
                  setUser(e.target.value);
                  if (status === "valid" || status === "invalid") setStatus("none");
                }}
                placeholder="contact@maboutique.com"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Mot de passe SMTP
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (status === "valid" || status === "invalid") setStatus("none");
                }}
                placeholder="••••••••"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="new-password"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-body text-text-secondary mb-1">
                Adresse d&apos;envoi (affichée aux destinataires)
              </label>
              <input
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="contact@votredomaine.com"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Nom affiché (optionnel — défaut : nom de la boutique)
              </label>
              <input
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Ma Boutique"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Email de notifications admin (optionnel)
              </label>
              <input
                type="email"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="admin@votredomaine.com"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleValidate}
              disabled={isPending || !canValidate}
              className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {isValidating ? "Vérification..." : "Tester la connexion"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !canSave}
              className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {hasConfig && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setHost("");
                  setPort(DEFAULT_PORT);
                  setSecure(false);
                  setUser("");
                  setPassword("");
                  setFromEmail("");
                  setFromName("");
                  setNotifyEmail("");
                  setStatus("valid");
                }}
                disabled={isPending}
                className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
              >
                Annuler
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
