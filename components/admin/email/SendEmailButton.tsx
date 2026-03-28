"use client";

import { useEmailCompose, type EmailRecipient } from "./EmailComposeProvider";

interface SendEmailButtonProps {
  recipient: EmailRecipient;
  variant?: "icon" | "button";
  className?: string;
}

export default function SendEmailButton({ recipient, variant = "button", className = "" }: SendEmailButtonProps) {
  const { openCompose } = useEmailCompose();

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => openCompose(recipient)}
        className={`w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors ${className}`}
        title={`Envoyer un email à ${recipient.name || recipient.email}`}
        aria-label={`Envoyer un email à ${recipient.name || recipient.email}`}
      >
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openCompose(recipient)}
      className={`inline-flex items-center gap-2 bg-bg-dark text-text-inverse text-sm font-medium font-body px-4 py-2 rounded-lg hover:opacity-90 transition-opacity ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
      Envoyer un email
    </button>
  );
}
