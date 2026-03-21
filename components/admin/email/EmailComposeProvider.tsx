"use client";

import { createContext, useContext, useState, useCallback } from "react";

export interface EmailRecipient {
  email: string;
  name?: string;
  userId?: string;
}

interface EmailComposeContextValue {
  isOpen: boolean;
  isMinimized: boolean;
  recipient: EmailRecipient | null;
  openCompose: (recipient?: EmailRecipient) => void;
  closeCompose: () => void;
  toggleMinimize: () => void;
}

const EmailComposeContext = createContext<EmailComposeContextValue | null>(null);

export function useEmailCompose(): EmailComposeContextValue {
  const ctx = useContext(EmailComposeContext);
  if (!ctx) throw new Error("useEmailCompose must be used within <EmailComposeProvider>");
  return ctx;
}

export default function EmailComposeProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [recipient, setRecipient] = useState<EmailRecipient | null>(null);

  const openCompose = useCallback((r?: EmailRecipient) => {
    setRecipient(r ?? null);
    setIsOpen(true);
    setIsMinimized(false);
  }, []);

  const closeCompose = useCallback(() => {
    setIsOpen(false);
    setIsMinimized(false);
    setRecipient(null);
  }, []);

  const toggleMinimize = useCallback(() => {
    setIsMinimized((prev) => !prev);
  }, []);

  return (
    <EmailComposeContext.Provider
      value={{ isOpen, isMinimized, recipient, openCompose, closeCompose, toggleMinimize }}
    >
      {children}
    </EmailComposeContext.Provider>
  );
}
