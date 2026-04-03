import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getClientConversation } from "@/app/actions/client/messages";
import ClientConversationView from "./ClientConversationView";

export const metadata = { title: "Conversation" };

export default async function ClientConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") redirect("/connexion");

  const { id } = await params;
  const conversation = await getClientConversation(id);
  if (!conversation) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4">
        <Link href="/espace-pro/messages" className="text-sm text-text-muted hover:text-text-primary font-body transition-colors">
          &larr; Retour aux messages
        </Link>
      </div>
      <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden" style={{ height: "calc(100vh - 200px)" }}>
        <ClientConversationView conversation={conversation} />
      </div>
    </div>
  );
}
