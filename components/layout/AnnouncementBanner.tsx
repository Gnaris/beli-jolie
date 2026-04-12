"use client";

import { usePathname } from "next/navigation";

interface AnnouncementBannerProps {
  messages: string[];
  bgColor: string;
  textColor: string;
  preview?: boolean;
}

export default function AnnouncementBanner({ messages, bgColor, textColor, preview }: AnnouncementBannerProps) {
  const pathname = usePathname();
  if (messages.length === 0) return null;
  if (!preview && pathname.startsWith("/admin")) return null;

  // Duplicate messages to create seamless loop
  const repeated = [...messages, ...messages];

  return (
    <div
      className="w-full overflow-hidden py-2 text-sm font-body relative z-[60]"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <div
        className="animate-marquee flex"
        style={{ animationDuration: `${messages.length * 8}s` }}
      >
        {repeated.map((msg, i) => (
          <span
            key={i}
            className="w-full shrink-0 text-center"
          >
            {msg}
          </span>
        ))}
      </div>
    </div>
  );
}
