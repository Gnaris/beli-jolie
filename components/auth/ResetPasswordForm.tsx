"use client";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

interface Props {
  token: string;
}

export default function ResetPasswordForm({ token }: Props) {
  const t = useTranslations("auth.resetPassword");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!token) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h1 className="font-heading text-2xl font-bold text-text-primary mb-4">
          {t("invalidToken")}
        </h1>
        <p className="text-sm text-text-secondary font-body">
          {t("invalidTokenDesc")}
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError(t("passwordHint"));
      return;
    }
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("error"));
        setLoading(false);
      } else {
        router.push("/connexion?reset=success");
      }
    } catch {
      setError(t("networkError"));
      setLoading(false);
    }
  }

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h1 className="font-heading text-2xl font-bold text-text-primary mb-2">
        {t("title")}
      </h1>
      <p className="text-sm text-text-secondary font-body mb-6">
        {t("subtitle")}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="field-label">
            {t("password")}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
            placeholder={t("passwordPlaceholder")}
            disabled={loading}
            minLength={8}
            required
          />
        </div>

        <div>
          <label htmlFor="confirm" className="field-label">
            {t("confirm")}
          </label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field-input"
            placeholder={t("confirmPlaceholder")}
            disabled={loading}
            minLength={8}
            required
          />
        </div>

        {error && (
          <p className="text-sm text-[#EF4444] font-body">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? t("loading") : t("submit")}
        </button>
      </form>
    </div>
  );
}
