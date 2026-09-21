"use client";

import { useState, useTransition } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { confirmEmailChange } from "@/app/actions/client/change-email";

interface Props {
  token: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "success"; newEmail: string }
  | { kind: "error"; message: string };

export default function ConfirmEmailChangeClient({ token }: Props) {
  const t = useTranslations("auth.changeEmail");
  const { data: session } = useSession();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

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

  function handleConfirm() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await confirmEmailChange(token);
      if (res.success) {
        setStatus({ kind: "success", newEmail: res.newEmail });
      } else {
        setStatus({ kind: "error", message: res.error });
      }
    });
  }

  if (status.kind === "success") {
    const isLoggedIn = Boolean(session?.user?.id);
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-4">
          <svg
            className="w-6 h-6 text-emerald-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="font-heading text-xl font-semibold text-text-primary text-center">
          {t("successTitle")}
        </h1>
        <p className="text-sm text-text-secondary font-body text-center mt-2">
          {t.rich("successDesc", {
            email: () => (
              <strong className="text-text-primary">{status.newEmail}</strong>
            ),
          })}
        </p>
        <button
          type="button"
          onClick={() =>
            signOut({ callbackUrl: "/connexion?email-changed=1" })
          }
          className="btn-primary w-full mt-6"
        >
          {isLoggedIn ? t("reloginButton") : t("goToLoginButton")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h1 className="font-heading text-2xl font-bold text-text-primary mb-2">
        {t("confirmTitle")}
      </h1>
      <p className="text-sm text-text-secondary font-body mb-6">
        {t("confirmSubtitle")}
      </p>

      {status.kind === "error" && (
        <p className="text-sm text-[#EF4444] font-body mb-4">
          {status.message}
        </p>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={isPending}
        className="btn-primary w-full"
      >
        {isPending ? t("confirmLoading") : t("confirmButton")}
      </button>
    </div>
  );
}
