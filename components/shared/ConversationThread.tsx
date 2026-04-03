"use client";

import { useEffect, useRef } from "react";
import type { Role } from "@prisma/client";

export interface ThreadMessage {
  id: string;
  content: string;
  senderRole: Role;
  sender: { firstName: string; lastName: string; role: Role };
  source?: string;
  readAt?: Date | string | null;
  createdAt: Date | string;
  attachments?: { id: string; fileName: string; filePath: string; mimeType: string }[];
}

interface ConversationThreadProps {
  messages: ThreadMessage[];
  currentUserRole: Role;
  subject?: string | null;
}

export default function ConversationThread({
  messages,
  currentUserRole,
  subject,
}: ConversationThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full">
      {subject && (
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-heading text-lg font-bold text-text-primary">{subject}</h2>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => {
          const isSelf = msg.senderRole === currentUserRole;
          return (
            <div key={msg.id} className={`flex ${isSelf ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] ${isSelf ? "order-last" : ""}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-text-muted font-body">
                    {msg.sender.firstName} {msg.sender.lastName}
                  </span>
                  {msg.source === "EMAIL" && (
                    <span className="badge badge-neutral text-[10px]">par email</span>
                  )}
                </div>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm font-body ${
                    isSelf
                      ? "bg-[#1A1A1A] text-white rounded-br-md"
                      : "bg-bg-secondary text-text-primary rounded-bl-md"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>

                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {msg.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.filePath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-text-muted hover:text-text-primary transition-colors font-body"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                        </svg>
                        {att.fileName}
                      </a>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-text-muted font-body">
                    {new Date(msg.createdAt).toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {isSelf && msg.readAt && (
                    <svg className="w-3 h-3 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
