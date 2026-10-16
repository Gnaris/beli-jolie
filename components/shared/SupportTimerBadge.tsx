"use client";

/**
 * Badge dev-only affichant l'état du chronomètre « 1 mail par tour »
 * pour une conversation Service Client. Monté dans les 4 vues conversation
 * (chat admin + client, claim admin + client). N'apparaît JAMAIS en prod :
 * le parent le rend uniquement si `process.env.NODE_ENV === "development"`.
 *
 * Poll une fois par seconde pour un affichage fluide du compte à rebours.
 */

import { useEffect, useState } from "react";
import {
  getActiveSupportTimer,
  type ActiveSupportTimer,
} from "@/app/actions/support-notify-debug";

interface Props {
  conversationId: string | null;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m} min ${s.toString().padStart(2, "0")}s`;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `il y a ${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `il y a ${m} min ${s.toString().padStart(2, "0")}s`;
}

export default function SupportTimerBadge({ conversationId }: Props) {
  const [timer, setTimer] = useState<ActiveSupportTimer | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!conversationId) {
      setTimer(null);
      return;
    }
    let cancelled = false;
    const fetchOnce = () => {
      getActiveSupportTimer(conversationId)
        .then((t) => {
          if (!cancelled) setTimer(t);
        })
        .catch(() => {
          /* dev-only widget, on reste silencieux */
        });
    };
    fetchOnce();
    const pollId = setInterval(fetchOnce, 3000);
    // Tick local 1 fois / s pour animer le compte à rebours sans ré-interroger
    // le serveur chaque seconde.
    const tickId = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, [conversationId]);

  if (!conversationId) return null;

  const now = Date.now();
  let label = "Aucun chronomètre actif";
  let tone: "idle" | "running" | "sent" = "idle";

  if (timer) {
    const dueAt = new Date(timer.dueAtIso).getTime();
    const target =
      timer.recipientRole === "CLIENT" ? "mail au client" : "mail à l'admin";

    if (timer.status === "PENDING") {
      const remaining = dueAt - now;
      if (remaining > 0) {
        label = `${target} dans ${formatRemaining(remaining)}`;
        tone = "running";
      } else {
        label = `${target} imminent (worker tick 30s)`;
        tone = "running";
      }
    } else {
      // SENT
      const sentAt = timer.sentAtIso ? new Date(timer.sentAtIso).getTime() : dueAt;
      label = `${target} envoyé ${formatElapsed(now - sentAt)}`;
      tone = "sent";
    }
  }

  const toneClass =
    tone === "running"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : tone === "sent"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-slate-50 text-slate-500 border-slate-200";

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono rounded-md border ${toneClass}`}
      title="Debug local — système de notification Service Client"
    >
      <span>⏱</span>
      <span>{label}</span>
    </div>
  );
}
