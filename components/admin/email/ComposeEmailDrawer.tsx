"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useEmailCompose } from "./EmailComposeProvider";
import RichTextEditor from "./RichTextEditor";
import { useToast } from "@/components/ui/Toast";

interface UserSuggestion {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
}

interface AttachmentFile {
  id: string;
  file: File;
}

export default function ComposeEmailDrawer() {
  const { isOpen, isMinimized, recipient, closeCompose, toggleMinimize } = useEmailCompose();
  const toast = useToast();

  const [toEmail, setToEmail] = useState("");
  const [toName, setToName] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [sending, setSending] = useState(false);

  // Autocomplete
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // Pre-fill recipient
  useEffect(() => {
    if (recipient) {
      setToEmail(recipient.email);
      setToName(recipient.name || "");
      setUserId(recipient.userId || null);
    }
  }, [recipient]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setToEmail("");
      setToName("");
      setUserId(null);
      setSubject("");
      setHtmlBody("");
      setAttachments([]);
      setSuggestions([]);
    }
  }, [isOpen]);

  // Close suggestions on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          toInputRef.current && !toInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.users);
        setShowSuggestions(data.users.length > 0);
      }
    } catch {
      // Silently ignore search errors
    }
  }, []);

  const handleToChange = useCallback(
    (value: string) => {
      setToEmail(value);
      setUserId(null);
      setToName("");
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => searchUsers(value), 300);
    },
    [searchUsers]
  );

  const selectSuggestion = useCallback((user: UserSuggestion) => {
    setToEmail(user.email);
    setToName(`${user.firstName} ${user.lastName}`);
    setUserId(user.id);
    setShowSuggestions(false);
    setSuggestions([]);
  }, []);

  const handleAddAttachments = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: AttachmentFile[] = [];
    for (let i = 0; i < files.length; i++) {
      newAttachments.push({
        id: crypto.randomUUID(),
        file: files[i],
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    // Reset input so same file can be added again
    e.target.value = "";
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleSend = useCallback(async () => {
    if (!toEmail.trim()) {
      toast.error("Destinataire requis");
      return;
    }
    if (!subject.trim()) {
      toast.error("Objet requis");
      return;
    }
    if (!htmlBody.trim() || htmlBody === "<br>") {
      toast.error("Message requis");
      return;
    }

    setSending(true);
    try {
      const formData = new FormData();
      formData.append("toEmail", toEmail.trim());
      if (toName) formData.append("toName", toName);
      if (userId) formData.append("userId", userId);
      formData.append("subject", subject.trim());
      formData.append("htmlBody", htmlBody);

      for (const att of attachments) {
        formData.append("attachments", att.file);
      }

      const res = await fetch("/api/admin/emails/send", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error("Erreur", data.error || "Impossible d'envoyer l'email");
        return;
      }

      toast.success("Email envoyé", `Email envoyé à ${toName || toEmail}`);
      closeCompose();
    } catch {
      toast.error("Erreur", "Impossible d'envoyer l'email");
    } finally {
      setSending(false);
    }
  }, [toEmail, toName, userId, subject, htmlBody, attachments, toast, closeCompose]);

  const totalAttachmentSize = attachments.reduce((sum, a) => sum + a.file.size, 0);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed z-50 transition-all duration-300 ease-in-out ${
        isMinimized
          ? "bottom-0 right-4 w-72"
          : "bottom-0 right-4 w-[min(560px,calc(100vw-2rem))]"
      }`}
      style={{ maxHeight: isMinimized ? "auto" : "calc(100vh - 2rem)" }}
    >
      <div
        className={`bg-bg-primary border border-border rounded-t-xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden ${
          isMinimized ? "" : "max-h-[calc(100vh-2rem)]"
        }`}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 bg-bg-dark cursor-pointer select-none shrink-0"
          onClick={toggleMinimize}
        >
          <h3 className="text-sm font-medium text-text-inverse font-heading truncate">
            {isMinimized && subject ? subject : "Nouveau message"}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {/* Minimize / Maximize */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMinimize();
              }}
              className="w-9 h-9 flex items-center justify-center text-text-inverse/70 hover:text-text-inverse rounded transition-colors"
              aria-label={isMinimized ? "Agrandir" : "Réduire"}
            >
              {isMinimized ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeCompose();
              }}
              className="w-9 h-9 flex items-center justify-center text-text-inverse/70 hover:text-text-inverse rounded transition-colors"
              aria-label="Fermer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body (hidden when minimized) */}
        {!isMinimized && (
          <div className="flex flex-col overflow-hidden flex-1">
            {/* To field */}
            <div className="relative px-4 py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-text-muted shrink-0 w-6">À</label>
                <div className="flex-1 relative">
                  {userId && toName ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 bg-bg-secondary border border-border rounded-full px-2.5 py-0.5 text-sm font-body">
                        <span className="text-text-primary">{toName}</span>
                        <span className="text-text-muted text-xs">({toEmail})</span>
                        <button
                          type="button"
                          onClick={() => {
                            setToEmail("");
                            setToName("");
                            setUserId(null);
                            toInputRef.current?.focus();
                          }}
                          className="ml-0.5 w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary"
                          aria-label="Supprimer le destinataire"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    </div>
                  ) : (
                    <input
                      ref={toInputRef}
                      type="email"
                      value={toEmail}
                      onChange={(e) => handleToChange(e.target.value)}
                      onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                      placeholder="Rechercher un client ou saisir une adresse..."
                      className="w-full bg-transparent text-sm text-text-primary font-body placeholder:text-text-muted focus:outline-none"
                      autoComplete="off"
                    />
                  )}

                  {/* Suggestions dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div
                      ref={suggestionsRef}
                      className="absolute top-full left-0 right-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto"
                    >
                      {suggestions.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => selectSuggestion(user)}
                          className="w-full text-left px-3 py-2.5 hover:bg-bg-secondary transition-colors flex items-center gap-3"
                        >
                          <div className="w-8 h-8 rounded-full bg-bg-dark flex items-center justify-center shrink-0">
                            <span className="text-text-inverse text-[10px] font-bold">
                              {user.firstName[0]}{user.lastName[0]}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary truncate font-body">
                              {user.firstName} {user.lastName}
                              <span className="text-text-muted font-normal ml-1">({user.company})</span>
                            </p>
                            <p className="text-xs text-text-muted truncate">{user.email}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Subject field */}
            <div className="px-4 py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-text-muted shrink-0 w-6">Obj.</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Objet du message"
                  className="flex-1 bg-transparent text-sm text-text-primary font-body placeholder:text-text-muted focus:outline-none"
                />
              </div>
            </div>

            {/* Rich text editor */}
            <div className="flex-1 overflow-y-auto">
              <RichTextEditor onChange={setHtmlBody} />
            </div>

            {/* Attachments list */}
            {attachments.length > 0 && (
              <div className="px-4 py-2 border-t border-border bg-bg-secondary">
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-1.5 bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-xs font-body max-w-[200px]"
                    >
                      <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                      </svg>
                      <span className="truncate text-text-primary">{att.file.name}</span>
                      <span className="text-text-muted shrink-0">
                        ({(att.file.size / 1024).toFixed(0)} Ko)
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-[var(--color-error)] shrink-0 ml-0.5"
                        aria-label={`Supprimer ${att.file.name}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-text-muted mt-1">
                  Total : {(totalAttachmentSize / (1024 * 1024)).toFixed(1)} Mo / 25 Mo
                </p>
              </div>
            )}

            {/* Footer: actions */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border shrink-0">
              <div className="flex items-center gap-1">
                {/* Attach button */}
                <button
                  type="button"
                  onClick={handleAddAttachments}
                  className="w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors"
                  title="Joindre un fichier"
                  aria-label="Joindre un fichier"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFilesSelected}
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv"
                />
              </div>

              {/* Send button */}
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !toEmail || !subject}
                className="inline-flex items-center gap-2 bg-bg-dark text-text-inverse text-sm font-medium font-body px-5 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Envoi...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                    Envoyer
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
