"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";

interface DeleteButtonProps {
  action: () => Promise<void>;
  confirmMessage: string;
  disabled?: boolean;
  disabledTitle?: string;
}

export default function DeleteButton({
  action,
  confirmMessage,
  disabled,
  disabledTitle,
}: DeleteButtonProps) {
  const { confirm } = useConfirm();

  async function handleClick() {
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ?",
      message: confirmMessage,
      confirmLabel: "Supprimer",
    });
    if (ok) await action();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={disabled ? disabledTitle : "Supprimer"}
      className="p-1 text-text-muted hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    </button>
  );
}
