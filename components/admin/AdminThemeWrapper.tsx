"use client";

import { useEffect, useState } from "react";

function getThemeFromCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === "bj_admin_theme=dark");
}

export default function AdminThemeWrapper({
  children,
  initialDark,
}: {
  children: React.ReactNode;
  initialDark: boolean;
}) {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    // Sync with actual cookie on mount
    setIsDark(getThemeFromCookie());
  }, []);

  // Listen for theme changes (from DarkModeToggle direct DOM manipulation)
  useEffect(() => {
    const wrapper = document.getElementById("admin-theme-wrapper");
    if (!wrapper) return;
    const observer = new MutationObserver(() => {
      setIsDark(wrapper.classList.contains("admin-dark"));
    });
    observer.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Use server value until client effect runs — guarantees SSR/client match
  const dark = isDark ?? initialDark;

  return (
    <div
      id="admin-theme-wrapper"
      suppressHydrationWarning
      className={`min-h-screen bg-bg-secondary flex${dark ? " admin-dark" : ""}`}
    >
      {children}
    </div>
  );
}
