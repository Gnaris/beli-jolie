"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { getAdminConversations } from "@/app/actions/admin/messages";

type Conversation = Awaited<ReturnType<typeof getAdminConversations>>[number];

const FILTERS = [
  { key: "all", label: "Toutes" },
  { key: "unread", label: "Non lues" },
  { key: "open", label: "Ouvertes" },
  { key: "closed", label: "Fermees" },
] as const;

export default function AdminMessagesList({ initialConversations }: { initialConversations: Conversation[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [filter, setFilter] = useState<"all" | "unread" | "open" | "closed">("all");
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleFilter(f: typeof filter) {
    setFilter(f);
    startTransition(async () => {
      const data = await getAdminConversations(f);
      setConversations(data);
    });
  }

  const filtered = search
    ? conversations.filter((c) => {
        const s = search.toLowerCase();
        return (
          c.user.firstName.toLowerCase().includes(s) ||
          c.user.lastName.toLowerCase().includes(s) ||
          (c.user.company || "").toLowerCase().includes(s) ||
          (c.subject || "").toLowerCase().includes(s)
        );
      })
    : conversations;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-bg-secondary rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => handleFilter(f.key)}
              className={`px-3 py-1.5 text-sm font-body rounded-md transition-colors ${
                filter === f.key
                  ? "bg-bg-primary text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un client..."
          className="border border-border bg-bg-primary px-3 py-1.5 text-sm rounded-lg focus:outline-none focus:border-[#1A1A1A] text-text-primary font-body w-64"
        />
      </div>

      {isPending ? (
        <p className="text-sm text-text-muted font-body py-8 text-center">Chargement...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center">
          <p className="text-text-muted font-body">Aucune conversation.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((conv) => {
            const lastMsg = conv.messages[0];
            const unread = conv._count.messages;
            return (
              <Link
                key={conv.id}
                href={`/admin/messages/${conv.id}`}
                className={`block bg-bg-primary border rounded-2xl p-4 hover:border-[#1A1A1A]/30 transition-colors ${
                  unread > 0 ? "border-accent/40" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text-primary font-body">
                        {conv.user.firstName} {conv.user.lastName}
                      </span>
                      {conv.user.company && (
                        <span className="text-xs text-text-muted font-body">({conv.user.company})</span>
                      )}
                      {unread > 0 && <span className="badge badge-info">{unread}</span>}
                      <span className={`badge ${conv.status === "OPEN" ? "badge-success" : "badge-neutral"}`}>
                        {conv.status === "OPEN" ? "Ouvert" : "Ferme"}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-text-primary mt-1 font-heading">
                      {conv.subject || "Sans sujet"}
                    </p>
                    {lastMsg && (
                      <p className="text-xs text-text-muted font-body mt-1 truncate">
                        {lastMsg.senderRole === "ADMIN" ? "Vous : " : ""}{lastMsg.content}
                      </p>
                    )}
                  </div>
                  {lastMsg && (
                    <span className="text-xs text-text-muted font-body whitespace-nowrap">
                      {new Date(lastMsg.createdAt).toLocaleDateString("fr-FR", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
