"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { loginSchema } from "@/lib/validations/auth";

type Mode = "password" | "otp";
type OtpStep = "email" | "code";

const RESEND_COOLDOWN_SEC = 60;
const OTP_EXPIRY_SEC = 10 * 60;

export default function LoginForm() {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [mode, setMode] = useState<Mode>("password");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPermanentLock, setIsPermanentLock] = useState(false);
  const [unlockSent, setUnlockSent] = useState(false);

  const [otpStep, setOtpStep] = useState<OtpStep>("email");
  const [otpCode, setOtpCode] = useState("");
  const [otpInfo, setOtpInfo] = useState("");
  const [otpResendSec, setOtpResendSec] = useState(0);
  const [otpExpirySec, setOtpExpirySec] = useState(0);

  useEffect(() => {
    if (otpResendSec <= 0) return;
    const id = setInterval(() => setOtpResendSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [otpResendSec]);

  useEffect(() => {
    if (otpExpirySec <= 0) return;
    const id = setInterval(() => setOtpExpirySec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [otpExpirySec]);

  function resetError() {
    setError("");
    setIsPermanentLock(false);
  }

  function switchMode(next: Mode) {
    setMode(next);
    resetError();
  }

  async function redirectAfterLogin() {
    const sessionRes = await fetch("/api/auth/session");
    const session = await sessionRes.json();
    if (session?.user?.role === "ADMIN") {
      router.push("/admin");
    } else {
      router.push(callbackUrl === "/connexion" ? "/" : callbackUrl);
    }
    router.refresh();
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetError();

    const validation = loginSchema.safeParse({ email, password });
    if (!validation.success) {
      setError(validation.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email: email.toLowerCase().trim(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error);
        setIsPermanentLock(result.error.includes("définitivement"));
        return;
      }

      await redirectAfterLogin();
    } catch {
      setError(t("submit"));
    } finally {
      setLoading(false);
    }
  }

  async function requestOtp() {
    resetError();
    setOtpInfo("");

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(t("email") + " : format invalide.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login-otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Impossible d'envoyer le code.");
        if (typeof data?.retryAfterMs === "number") {
          setOtpResendSec(Math.ceil(data.retryAfterMs / 1000));
        }
        return;
      }

      setOtpStep("code");
      setOtpCode("");
      setOtpResendSec(RESEND_COOLDOWN_SEC);
      setOtpExpirySec(OTP_EXPIRY_SEC);
      setOtpInfo(
        t("otpSentTo", { email: email.toLowerCase().trim() }) +
          " " +
          t("otpSentNotice")
      );
    } catch {
      setError("Erreur réseau. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetError();

    const code = otpCode.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      setError("Le code doit contenir 6 chiffres.");
      return;
    }

    setLoading(true);
    try {
      const result = await signIn("otp", {
        email: email.toLowerCase().trim(),
        code,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error);
        setIsPermanentLock(result.error.includes("définitivement"));
        return;
      }

      await redirectAfterLogin();
    } catch {
      setError(t("otpVerifyButton"));
    } finally {
      setLoading(false);
    }
  }

  const expiryLabel = useMemo(() => {
    const minutes = Math.floor(otpExpirySec / 60);
    const seconds = otpExpirySec % 60;
    return t("otpExpiresIn", { minutes, seconds });
  }, [otpExpirySec, t]);

  return (
    <div className="w-full max-w-sm mx-auto bg-bg-primary rounded-xl border border-border p-6 md:p-8 shadow-lg">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-text-primary tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1.5 font-body text-sm text-text-muted">
          {t("subtitle")}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Mode de connexion"
        className="flex gap-1 mb-6 p-1 bg-bg-secondary rounded-lg"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          onClick={() => switchMode("password")}
          className={`flex-1 text-sm font-body font-medium py-2 rounded-md transition-colors ${
            mode === "password"
              ? "bg-bg-primary text-text-primary shadow-sm"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {t("tabPassword")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "otp"}
          onClick={() => switchMode("otp")}
          className={`flex-1 text-sm font-body font-medium py-2 rounded-md transition-colors ${
            mode === "otp"
              ? "bg-bg-primary text-text-primary shadow-sm"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {t("tabOtp")}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 bg-red-50 border border-red-200 text-error px-4 py-3 text-sm font-body rounded-lg"
        >
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span>{error}</span>
          </div>
          {isPermanentLock && !unlockSent && (
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/auth/unlock-request", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: email.toLowerCase().trim() }),
                });
                setUnlockSent(true);
              }}
              className="mt-3 w-full text-center text-xs font-medium text-text-primary bg-bg-primary border border-border rounded-lg px-3 py-2 hover:bg-bg-secondary transition-colors"
            >
              Demander le déblocage par email
            </button>
          )}
          {unlockSent && (
            <p className="mt-3 text-xs text-success font-medium text-center">
              Demande envoyée. Notre équipe vous contactera par email.
            </p>
          )}
        </div>
      )}

      {mode === "password" && (
        <form onSubmit={handlePasswordSubmit} noValidate className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5"
            >
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="votre@email.com"
              autoComplete="email"
              required
              className="field-input"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="password"
                className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide"
              >
                {t("password")}
              </label>
              <Link
                href="/mot-de-passe-oublie"
                className="text-xs font-body text-text-muted hover:text-text-primary transition-colors"
              >
                {t("forgotPassword")}
              </Link>
            </div>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="field-input pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                aria-label={showPassword ? t("hide") : t("show")}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t("loading")}
              </>
            ) : (
              t("submit")
            )}
          </button>
        </form>
      )}

      {mode === "otp" && otpStep === "email" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            requestOtp();
          }}
          noValidate
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="otp-email"
              className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5"
            >
              {t("email")}
            </label>
            <input
              id="otp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="votre@email.com"
              autoComplete="email"
              required
              className="field-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t("otpRequesting") : t("otpRequestButton")}
          </button>
        </form>
      )}

      {mode === "otp" && otpStep === "code" && (
        <form onSubmit={handleOtpSubmit} noValidate className="space-y-5">
          {otpInfo && (
            <div
              role="status"
              className="bg-bg-secondary border border-border text-text-secondary px-4 py-3 text-xs font-body rounded-lg"
            >
              {otpInfo}
            </div>
          )}

          <div>
            <label
              htmlFor="otp-code"
              className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5"
            >
              {t("otpCodeLabel")}
            </label>
            <input
              id="otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={otpCode}
              onChange={(e) =>
                setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder={t("otpCodePlaceholder")}
              required
              className="field-input tracking-[0.5em] text-center font-mono text-lg"
            />
            <p className="mt-2 text-xs text-text-muted">
              {otpExpirySec > 0 ? expiryLabel : t("otpExpired")}
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || otpExpirySec <= 0}
            className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t("otpVerifying") : t("otpVerifyButton")}
          </button>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setOtpStep("email");
                setOtpCode("");
                setOtpInfo("");
                resetError();
              }}
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              {t("otpBack")}
            </button>
            <button
              type="button"
              onClick={requestOtp}
              disabled={loading || otpResendSec > 0}
              className="font-medium text-text-primary disabled:text-text-muted disabled:cursor-not-allowed"
            >
              {otpResendSec > 0
                ? t("otpResendIn", { seconds: otpResendSec })
                : t("otpResend")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
