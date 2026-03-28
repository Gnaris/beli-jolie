"use client";

import { useState, useTransition } from "react";
import { updateGmailConfig, validateGmailConfig } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  hasConfig: boolean;
}

export default function GmailConfig({ hasConfig }: Props) {
  const [gmailUser, setGmailUser] = useState("");
  const [gmailPassword, setGmailPassword] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [status, setStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasConfig ? "valid" : "none"
  );
  const [isSaving, startSaving] = useTransition();
  const [isValidating, startValidating] = useTransition();
  const toast = useToast();
  const [editing, setEditing] = useState(!hasConfig);

  function handleValidate() {
    if (!gmailUser.trim() || !gmailPassword.trim()) return;
    startValidating(async () => {
      setStatus("checking");
      const result = await validateGmailConfig({
        gmailUser: gmailUser.trim(),
        gmailPassword: gmailPassword.trim(),
      });
      if (result.valid) {
        setStatus("valid");
        toast.success("Connexion réussie", "Les identifiants Gmail sont valides.");
      } else {
        setStatus("invalid");
        toast.error("Connexion échouée", result.error ?? "Identifiants invalides.");
      }
    });
  }

  function handleSave() {
    startSaving(async () => {
      const result = await updateGmailConfig({
        gmailUser: gmailUser.trim(),
        gmailPassword: gmailPassword.trim(),
        notifyEmail: notifyEmail.trim(),
      });
      if (result.success) {
        toast.success("Enregistré", "Configuration Gmail sauvegardée.");
        setEditing(false);
        setGmailUser("");
        setGmailPassword("");
        setNotifyEmail("");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  const isPending = isSaving || isValidating;
  const canSave = gmailUser.trim() && gmailPassword.trim() && status === "valid";

  return (
    <div className="space-y-3">
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
        <span className="font-[family-name:var(--font-roboto)] text-sm text-text-secondary">
          {status === "valid" && "Configuration Gmail active"}
          {status === "invalid" && "Identifiants invalides"}
          {status === "checking" && "Vérification..."}
          {status === "none" && "Non configuré"}
        </span>
      </div>

      {!editing && hasConfig ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 font-[family-name:var(--font-roboto)] text-sm text-text-secondary tracking-widest">
            ••••••••••••••••
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary underline"
          >
            Modifier
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <input
              type="email"
              value={gmailUser}
              onChange={(e) => {
                setGmailUser(e.target.value);
                if (status === "valid" || status === "invalid") setStatus("none");
              }}
              placeholder="Adresse Gmail (expéditeur)"
              className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isPending}
              autoComplete="off"
            />
            <input
              type="password"
              value={gmailPassword}
              onChange={(e) => {
                setGmailPassword(e.target.value);
                if (status === "valid" || status === "invalid") setStatus("none");
              }}
              placeholder="Mot de passe d'application Gmail"
              className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isPending}
              autoComplete="off"
            />
            <input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="Email destinataire notifications (optionnel, défaut : email société)"
              className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isPending}
              autoComplete="off"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleValidate}
              disabled={isPending || !gmailUser.trim() || !gmailPassword.trim()}
              className="h-9 px-4 rounded-lg border border-border text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {isValidating ? "Vérification..." : "Vérifier"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !canSave}
              className="h-9 px-4 rounded-lg bg-[#1A1A1A] text-white text-sm font-[family-name:var(--font-roboto)] font-medium hover:bg-[#333] transition-colors disabled:opacity-50"
            >
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {hasConfig && (
              <button
                type="button"
                onClick={() => { setEditing(false); setGmailUser(""); setGmailPassword(""); setNotifyEmail(""); setStatus("valid"); }}
                disabled={isPending}
                className="h-9 px-3 text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary"
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
