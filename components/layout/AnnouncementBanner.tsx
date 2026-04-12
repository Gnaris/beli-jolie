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
  const isHidden = messages.length === 0 || (!preview && pathname !== "/");

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
  // Total width = number of items × 100% of container
  // translateX(-50%) of total = exactly the original messages set
  const totalWidthPercent = repeated.length * 100;

  return (
    <div
      ref={ref}
      className="w-full overflow-hidden py-2 text-sm font-body relative z-[60]"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <div
        className="animate-marquee"
        style={{
          display: "flex",
          width: `${totalWidthPercent}%`,
          animationDuration: `${messages.length * speed}s`,
        }}
      >
        {repeated.map((msg, i) => (
          <span
            key={i}
            className="shrink-0 text-center font-semibold"
            style={{ width: `${100 / repeated.length}%` }}
          >
            {msg}
          </span>
        ))}
      </div>
    </div>
  );
}
