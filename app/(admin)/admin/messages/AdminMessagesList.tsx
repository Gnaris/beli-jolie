"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { getAdminConversations } from "@/app/actions/admin/messages";
import { useChatStream } from "@/hooks/useChatStream";

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

  // Real-time: refresh list when a new message arrives
  const handleChatEvent = useCallback(
    (event: { type: string }) => {
      if (event.type === "NEW_MESSAGE") {
        startTransition(async () => {
          const data = await getAdminConversations(filter);
          setConversations(data);
        });
      }
    },
    [filter]
  );
  useChatStream(handleChatEvent);

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
        <div className="border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Client</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Sujet</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Dernier message</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Non lus</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Statut</th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((conv) => {
                  const lastMsg = conv.messages[0];
                  const unread = conv._count.messages;
                  return (
                    <tr key={conv.id} className="hover:bg-bg-secondary/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/admin/messages/${conv.id}`} className="hover:underline">
                          <span className="font-semibold text-text-primary">
                            {conv.user.firstName} {conv.user.lastName}
                          </span>
                          {conv.user.company && (
                            <span className="text-xs text-text-muted ml-1">({conv.user.company})</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/messages/${conv.id}`} className="font-heading font-medium text-text-primary hover:underline">
                          {conv.subject || "Sans sujet"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 max-w-[250px]">
                        {lastMsg && (
                          <p className="text-xs text-text-muted truncate">
                            {lastMsg.senderRole === "ADMIN" ? "Vous : " : ""}{lastMsg.content}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {unread > 0 && <span className="badge badge-info">{unread}</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`badge ${conv.status === "OPEN" ? "badge-success" : "badge-neutral"}`}>
                          {conv.status === "OPEN" ? "Ouvert" : "Fermé"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-text-muted whitespace-nowrap">
                        {lastMsg && new Date(lastMsg.createdAt).toLocaleDateString("fr-FR", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
