import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getAdminConversation } from "@/app/actions/admin/messages";
import AdminConversationView from "./AdminConversationView";

export const metadata = { title: "Conversation — Admin" };

export default async function AdminConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;
  const conversation = await getAdminConversation(id);
  if (!conversation) notFound();

  return (
    <div className="space-y-4">
      <Link href="/admin/messages" className="text-sm text-text-muted hover:text-text-primary font-body transition-colors">
        &larr; Retour aux messages
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Conversation thread */}
        <div className="lg:col-span-2 bg-bg-primary border border-border rounded-2xl overflow-hidden" style={{ height: "calc(100vh - 200px)" }}>
          <AdminConversationView conversation={conversation} />
        </div>

        {/* Client info sidebar */}
        <div className="bg-bg-primary border border-border rounded-2xl p-6 h-fit space-y-4">
          <h3 className="font-heading font-bold text-text-primary">Client</h3>
          <div className="space-y-2 text-sm font-body">
            <p className="text-text-primary font-semibold">
              {conversation.user.firstName} {conversation.user.lastName}
            </p>
            {conversation.user.company && (
              <p className="text-text-muted">{conversation.user.company}</p>
            )}
            <p className="text-text-muted">{conversation.user.email}</p>
          </div>
          <div className="pt-2 border-t border-border">
            <Link
              href={`/admin/utilisateurs/${conversation.user.id}`}
              className="text-sm text-text-muted hover:text-text-primary font-body transition-colors underline"
            >
              Voir le profil
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
