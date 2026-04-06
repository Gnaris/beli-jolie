"use client";

import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import type { BusinessHoursSchedule } from "@/lib/business-hours";

const ChatWidget = dynamic(() => import("@/components/client/ChatWidget"), { ssr: false });

interface Props {
  businessHours: BusinessHoursSchedule | null;
}

export default function ChatWidgetLoader({ businessHours }: Props) {
  const { data: session } = useSession();

  // Only show for approved clients
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return null;
  }

  return <ChatWidget businessHours={businessHours} />;
}
