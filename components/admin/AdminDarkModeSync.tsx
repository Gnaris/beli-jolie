"use client";

import { useEffect } from "react";

/**
 * Syncs the `admin-dark` class onto `document.documentElement` so that
 * portaled modals (rendered outside #admin-theme-wrapper) inherit dark styles.
 */
export default function AdminDarkModeSync({ isDark }: { isDark: boolean }) {
  useEffect(() => {
    const el = document.documentElement;
    if (isDark) {
      el.classList.add("admin-dark");
    } else {
      el.classList.remove("admin-dark");
    }
    // Clear inline styles set by the early head script (CSS is loaded by now)
    el.style.removeProperty("background-color");
    el.style.removeProperty("color");
    el.style.removeProperty("color-scheme");
    return () => {
      el.classList.remove("admin-dark");
      el.style.removeProperty("background-color");
      el.style.removeProperty("color");
      el.style.removeProperty("color-scheme");
    };
  }, [isDark]);

  return null;
}
