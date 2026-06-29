"use client";
import React from "react";

interface Props {
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (val: string) => void;
  children?: React.ReactNode;
}

export default function Toolbar({ searchPlaceholder, searchValue, onSearchChange, children }: Props) {
  return (
    <div className="flex gap-2.5 items-center flex-wrap">
      <div className="flex-1 min-w-[240px] relative">
        <svg
          className="absolute left-3 top-2.5 w-4 h-4 text-text-muted opacity-50"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full bg-bg-primary border border-border-strong rounded-lg pl-10 pr-3.5 py-2.5 text-[13px] text-text-primary shadow-[var(--shadow-card)] focus:border-ink focus:ring-2 focus:ring-ink/10 focus:outline-none"
        />
      </div>
      {children && <div className="flex gap-1.5 flex-wrap">{children}</div>}
    </div>
  );
}
