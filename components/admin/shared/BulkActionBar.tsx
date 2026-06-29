"use client";
import React, { Fragment } from "react";

export interface BulkAction {
  id: string;
  label: string;
  icon: string;
  group: "status" | "sync" | "edit" | "danger";
  disabled?: boolean;
  danger?: boolean;
}

interface Props {
  count: number;
  subLabel?: string;
  partial?: boolean;
  actions: BulkAction[];
  onAction: (id: string) => void;
  onDeselect: () => void;
}

const GROUP_ORDER: BulkAction["group"][] = ["status", "sync", "edit", "danger"];

export default function BulkActionBar({ count, subLabel, partial, actions, onAction, onDeselect }: Props) {
  const grouped = GROUP_ORDER
    .map((g) => actions.filter((a) => a.group === g))
    .filter((g) => g.length > 0);

  return (
    <div className="bg-ink text-text-inverse px-4 py-3 rounded-2xl flex items-center gap-3.5 flex-wrap shadow-[var(--shadow-pop)]">
      <div className="flex items-center gap-3 pr-3.5 border-r border-white/10">
        <div className="w-4 h-4 rounded bg-white relative" aria-hidden>
          {partial ? (
            <div className="absolute left-1 top-[7px] w-2.5 h-0.5 bg-ink rounded-sm" />
          ) : (
            <div className="absolute left-[5px] top-px w-1.5 h-2.5 border-r-[1.5px] border-b-[1.5px] border-ink rotate-45" />
          )}
        </div>
        <div>
          <div className="text-[13px] font-bold">{count} sélectionnés</div>
          {subLabel && <div className="text-[11px] text-white/55 font-medium">{subLabel}</div>}
        </div>
      </div>

      <div className="flex gap-1 flex-wrap items-center">
        {grouped.map((group, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <span className="text-white/20 text-base px-1" aria-hidden>·</span>}
            {group.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => !a.disabled && onAction(a.id)}
                disabled={a.disabled}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 leading-none transition-colors ${
                  a.disabled
                    ? "bg-white/5 text-white/30 cursor-not-allowed"
                    : a.danger
                    ? "bg-error/20 text-[#fecaca] hover:bg-error hover:text-white"
                    : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                <span className="text-[13px] opacity-85" aria-hidden>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </Fragment>
        ))}
      </div>

      <button
        type="button"
        onClick={onDeselect}
        className="ml-auto text-[11px] text-white/55 px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white"
      >
        ✕ Désélectionner
      </button>
    </div>
  );
}
