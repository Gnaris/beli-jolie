"use client";

import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";

const AdminChatWidget = dynamic(() => import("@/components/admin/AdminChatWidget"), { ssr: false });

export default function AdminChatWidgetLoader() {
  const { data: session } = useSession();

  // Only show for admin users
  if (!session || session.user.role !== "ADMIN") {
    return null;
  }

  return <AdminChatWidget />;
}
