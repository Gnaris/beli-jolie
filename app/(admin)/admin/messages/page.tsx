import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getAdminConversations } from "@/app/actions/admin/messages";
import AdminMessagesList from "./AdminMessagesList";

export const metadata = { title: "Messages — Admin" };

export default async function AdminMessagesPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const conversations = await getAdminConversations();

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold text-text-primary">Messages</h1>
      <AdminMessagesList initialConversations={conversations} />
    </div>
  );
}
