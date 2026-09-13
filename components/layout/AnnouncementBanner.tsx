"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { stripLocalePrefix } from "@/lib/locale-path";

export type AnnouncementBannerMode = "scroll" | "static";

interface AnnouncementBannerProps {
  messages: string[];
  bgColor: string;
  textColor: string;
  speed?: number; // seconds per message (default 8), only used when mode = "scroll"
  mode?: AnnouncementBannerMode;
  preview?: boolean;
}

export default function AnnouncementBanner({
  messages,
  bgColor,
  textColor,
  speed = 8,
  mode = "scroll",
  preview,
}: AnnouncementBannerProps) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const isHome = stripLocalePrefix(pathname) === "/";
  const isHidden = messages.length === 0 || (!preview && !isHome);

  // Set CSS variable so the fixed header can offset itself.
  // When the banner scrolls out of view, reset to 0 so the header slides up.
  useEffect(() => {
    if (preview || isHidden) {
      if (!preview) document.documentElement.style.setProperty("--announcement-height", "0px");
      return;
    }
    const el = ref.current;
    if (!el) return;

    // En mode statique, la hauteur peut varier (wrap sur mobile). ResizeObserver
    // suit toute variation ; IntersectionObserver gère le scroll hors vue.
    const applyHeight = () => {
      const h = el.offsetHeight;
      document.documentElement.style.setProperty("--announcement-height", `${h}px`);
    };
    applyHeight();

    const resizeObs = new ResizeObserver(applyHeight);
    resizeObs.observe(el);

    const intersectionObs = new IntersectionObserver(
      ([entry]) => {
        document.documentElement.style.setProperty(
          "--announcement-height",
          entry.isIntersecting ? `${el.offsetHeight}px` : "0px",
        );
      },
      { threshold: 0 },
    );
    intersectionObs.observe(el);

    return () => {
      resizeObs.disconnect();
      intersectionObs.disconnect();
      document.documentElement.style.setProperty("--announcement-height", "0px");
    };
  }, [isHidden, preview, messages, mode]);

  if (isHidden) return null;

  if (mode === "static") {
    return (
      <div
        ref={ref}
        className="w-full py-2 text-sm font-body relative z-[60]"
        style={{ backgroundColor: bgColor, color: textColor }}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 px-4">
          {messages.map((msg, i) => (
            <span key={i} className="inline-flex items-center gap-x-6 text-center font-semibold">
              {i > 0 && (
                <span aria-hidden className="opacity-60 select-none">•</span>
              )}
              <span>{msg}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

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
