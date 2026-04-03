import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getClientConversations } from "@/app/actions/client/messages";
import ClientNewConversation from "./ClientNewConversation";

export const metadata = { title: "Messages" };

export default async function ClientMessagesPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") redirect("/connexion");

  const conversations = await getClientConversations();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold text-text-primary">Messages</h1>
        <ClientNewConversation />
      </div>

      {conversations.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center">
          <p className="text-text-muted font-body">Vous n&apos;avez pas encore de messages.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => {
            const lastMsg = conv.messages[0];
            const unread = conv._count.messages;
            return (
              <Link
                key={conv.id}
                href={`/espace-pro/messages/${conv.id}`}
                className="block bg-bg-primary border border-border rounded-2xl p-4 hover:border-[#1A1A1A]/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-heading font-semibold text-text-primary truncate">
                        {conv.subject || "Sans sujet"}
                      </h3>
                      {unread > 0 && (
                        <span className="badge badge-info">{unread}</span>
                      )}
                      <span className={`badge ${conv.status === "OPEN" ? "badge-success" : "badge-neutral"}`}>
                        {conv.status === "OPEN" ? "Ouvert" : "Ferme"}
                      </span>
                    </div>
                    {lastMsg && (
                      <p className="text-sm text-text-muted font-body mt-1 truncate">
                        {lastMsg.senderRole === "CLIENT" ? "Vous : " : "Admin : "}
                        {lastMsg.content}
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
