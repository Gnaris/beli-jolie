"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

interface AnnouncementBannerProps {
  messages: string[];
  bgColor: string;
  textColor: string;
  speed?: number; // seconds per message (default 8)
  preview?: boolean;
}

export default function AnnouncementBanner({ messages, bgColor, textColor, speed = 8, preview }: AnnouncementBannerProps) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const isHidden = messages.length === 0 || (!preview && pathname.startsWith("/admin"));

  // Set CSS variable so the fixed header can offset itself
  useEffect(() => {
    if (preview) return;
    if (isHidden) {
      document.documentElement.style.setProperty("--announcement-height", "0px");
    } else if (ref.current) {
      const h = ref.current.offsetHeight;
      document.documentElement.style.setProperty("--announcement-height", `${h}px`);
    }
    return () => {
      document.documentElement.style.setProperty("--announcement-height", "0px");
    };
  }, [isHidden, preview, messages]);

  if (isHidden) return null;

  // Duplicate messages to create seamless loop
  const repeated = [...messages, ...messages];

  return (
    <div
      ref={ref}
      className="w-full overflow-hidden py-2 text-sm font-body relative z-[60]"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <div
        className="animate-marquee flex"
        style={{ animationDuration: `${messages.length * speed}s` }}
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
