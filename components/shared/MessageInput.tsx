"use client";

import { useState, useRef, useTransition } from "react";
import Image from "next/image";

export interface ChatAttachment {
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

interface MessageInputProps {
  onSend: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  onTyping?: () => void;
}

interface FilePreview {
  file: File;
  url: string;
}

const MAX_FILES = 5;

export default function MessageInput({ onSend, placeholder, disabled, onTyping }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    if ((!content.trim() && files.length === 0) || isPending || disabled) return;
    const msg = content.trim();
    const filesToUpload = [...files];
    setContent("");
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    startTransition(async () => {
      let attachments: ChatAttachment[] | undefined;

      if (filesToUpload.length > 0) {
        const formData = new FormData();
        for (const f of filesToUpload) {
          formData.append("files", f.file);
        }
        const res = await fetch("/api/chat/upload", { method: "POST", body: formData });
        if (res.ok) {
          const data = await res.json();
          attachments = data.attachments;
        }
        // Revoke preview URLs
        for (const f of filesToUpload) URL.revokeObjectURL(f.url);
      }

      await onSend(msg, attachments);
    });
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    const remaining = MAX_FILES - files.length;
    const toAdd = selected.slice(0, remaining);
    setFiles((prev) => [
      ...prev,
      ...toAdd.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].url);
      copy.splice(index, 1);
      return copy;
    });
  }

  return (
    <div className="border-t border-border px-4 py-3">
      {/* File previews */}
      {files.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {files.map((f, i) => (
            <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border bg-bg-secondary group">
              <Image src={f.url} alt={f.file.name} fill className="object-cover" unoptimized />
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-[#1A1A1A]/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending || disabled || files.length >= MAX_FILES}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border border-border text-text-muted hover:text-text-primary hover:border-[#1A1A1A]/30 disabled:opacity-40 transition-colors"
          title="Joindre une image"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => { setContent(e.target.value); handleInput(); onTyping?.(); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Écrivez votre message..."}
          disabled={isPending || disabled}
          rows={1}
          className="flex-1 resize-none border border-border bg-bg-primary rounded-xl px-4 py-2.5 text-sm text-text-primary font-body placeholder:text-text-muted focus:outline-none focus:border-[#1A1A1A] disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={(!content.trim() && files.length === 0) || isPending || disabled}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-[#1A1A1A] text-white hover:bg-[#333] disabled:opacity-40 transition-colors"
        >
          {isPending ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
