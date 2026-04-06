"use client";

import { useState } from "react";
import { useChatStream } from "@/hooks/useChatStream";

interface Props {
  initialCount: number;
}

export default function AdminChatBadge({ initialCount }: Props) {
  const [count, setCount] = useState(initialCount);

  useChatStream((event) => {
    if (event.type === "NEW_MESSAGE" && event.messageData?.senderRole === "CLIENT") {
      setCount((c) => c + 1);
    }
  });

  if (count <= 0) return null;

  return (
    <span className="flex items-center justify-center text-[11px] bg-blue-100 text-blue-700 border border-blue-200 rounded-full min-w-[22px] h-[22px] px-1.5 font-semibold">
      {count}
    </span>
  );
}
