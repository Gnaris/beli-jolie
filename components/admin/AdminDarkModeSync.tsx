"use client";

import { useEffect } from "react";

/**
 * Syncs the `admin-dark` class onto `document.documentElement` so that
 * portaled modals (rendered outside #admin-theme-wrapper) inherit dark styles.
 */
export default function AdminDarkModeSync({ isDark }: { isDark: boolean }) {
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("admin-dark");
    } else {
      document.documentElement.classList.remove("admin-dark");
    }
    return () => {
      document.documentElement.classList.remove("admin-dark");
    };
  }, [isDark]);

  return null;
}
