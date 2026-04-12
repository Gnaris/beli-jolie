"use client";

import { usePathname } from "next/navigation";

interface AnnouncementBannerProps {
  messages: string[];
  bgColor: string;
  textColor: string;
}

export default function AnnouncementBanner({ messages, bgColor, textColor }: AnnouncementBannerProps) {
  const pathname = usePathname();
  if (messages.length === 0) return null;
  if (pathname.startsWith("/admin")) return null;

  // Duplicate messages to create seamless loop
  const repeated = [...messages, ...messages];

  return (
    <div
      className="w-full overflow-hidden py-2 text-sm font-body relative z-[60]"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <div className="animate-marquee flex whitespace-nowrap">
        {repeated.map((msg, i) => (
          <span key={i} className="mx-8 inline-block">
            {msg}
          </span>
        ))}
      </div>
    </div>
  );
}
