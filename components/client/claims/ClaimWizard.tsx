"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRouter as useI18nRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  createClaim,
  listOrdersForClaim,
  getOrderForClaim,
} from "@/app/actions/client/claims";

type ClaimType = "ORDER_RELATED" | "OTHER";

type OrderSummary = {
  id: string;
  orderNumber: string;
  status: "PENDING" | "SHIPPED";
  createdAt: string;
  totalTTC: number;
  totalArticles: number;
};

type OrderItemForClaim = {
  id: string;
  productName: string;
  productRef: string;
  colorName: string;
  imagePath: string | null;
  saleType: string;
  packQty: number | null;
  size: string | null;
  sizesJson: string | null;
  quantity: number;
};

type Attachment = { fileName: string; filePath: string; fileSize: number; mimeType: string };

const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default function ClaimWizard({ initialOrderId }: { initialOrderId?: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const i18nRouter = useI18nRouter();
  const toast = useToast();

  // Un query param `?order=xxx` (ex : lien depuis la fiche commande) pré-sélectionne
  // le flux ORDER_RELATED et amène directement à l'étape 3A.
  const seedOrderId = initialOrderId ?? searchParams.get("order") ?? null;

  const [type, setType] = useState<ClaimType | null>(seedOrderId ? "ORDER_RELATED" : null);
  const [step, setStep] = useState<number>(seedOrderId ? 3 : 1);
  const [orderId, setOrderId] = useState<string | null>(seedOrderId);
  const [orderItems, setOrderItems] = useState<Record<string, number>>({});
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderDetail, setOrderDetail] = useState<{ id: string; orderNumber: string; items: OrderItemForClaim[] } | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, startSubmit] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOrderFlow = type === "ORDER_RELATED";
  const totalSteps = isOrderFlow ? 4 : 2;

  // Charge la liste des commandes quand on entre en étape 2A.
  useEffect(() => {
    if (isOrderFlow && step === 2 && orders === null && !ordersLoading) {
      setOrdersLoading(true);
      listOrdersForClaim()
        .then((res) => {
          if (res.success) setOrders(res.orders);
          else toast.error("Chargement impossible", res.error);
        })
        .finally(() => setOrdersLoading(false));
    }
  }, [isOrderFlow, step, orders, ordersLoading, toast]);

  // Charge le détail commande quand on entre en étape 3A (ou dès le seed).
  useEffect(() => {
    if (isOrderFlow && step === 3 && orderId && orderDetail?.id !== orderId && !orderDetailLoading) {
      setOrderDetailLoading(true);
      getOrderForClaim(orderId)
        .then((res) => {
          if (res.success) {
            setOrderDetail(res.order);
            // Réinit les quantités quand on change de commande
            setOrderItems({});
          } else {
            toast.error("Chargement impossible", res.error);
            // Si le seed est invalide, retombe sur l'étape 1
            setStep(1);
            setType(null);
            setOrderId(null);
          }
        })
        .finally(() => setOrderDetailLoading(false));
    }
  }, [isOrderFlow, step, orderId, orderDetail?.id, orderDetailLoading, toast]);

  function pickType(next: ClaimType) {
    setType(next);
    setStep(2);
  }

  function pickOrder(id: string) {
    setOrderId(id);
    setStep(3);
  }

  function setItemQty(orderItemId: string, qty: number, maxQty: number) {
    const clamped = Math.max(0, Math.min(qty, maxQty));
    setOrderItems((prev) => {
      const next = { ...prev };
      if (clamped === 0) delete next[orderItemId];
      else next[orderItemId] = clamped;
      return next;
    });
  }

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    const kept: File[] = [];
    for (const f of arr) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`Fichier trop lourd : ${f.name}`, "10 Mo maximum par fichier.");
        continue;
      }
      kept.push(f);
    }
    setFiles((prev) => [...prev, ...kept]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function uploadAttachments(): Promise<Attachment[]> {
    if (files.length === 0) return [];
    setIsUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/chat/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Échec de l'upload.");
      }
      const data = (await res.json()) as { attachments: Attachment[] };
      return data.attachments;
    } finally {
      setIsUploading(false);
    }
  }

  function goBack() {
    if (isOrderFlow) {
      if (step === 4) setStep(3);
      else if (step === 3) setStep(2);
      else if (step === 2) { setStep(1); setType(null); setOrderId(null); setOrderDetail(null); setOrderItems({}); }
    } else {
      if (step === 2) { setStep(1); setType(null); }
    }
  }

  function submit() {
    const s = subject.trim();
    const m = message.trim();
    if (!s) return toast.error("Sujet requis", "Résumez votre demande en quelques mots.");
    if (!m) return toast.error("Message requis", "Décrivez votre demande.");
    if (isOrderFlow) {
      const totalQty = Object.values(orderItems).reduce((a, b) => a + b, 0);
      if (totalQty === 0) return toast.error("Aucun article signalé", "Indiquez une quantité pour au moins un article.");
    }

    startSubmit(async () => {
      let attachments: Attachment[] = [];
      try {
        attachments = await uploadAttachments();
      } catch (err) {
        toast.error("Échec de l'envoi", err instanceof Error ? err.message : undefined);
        return;
      }

      const res = await createClaim({
        subject: s,
        message: m,
        attachments,
        type: type ?? "OTHER",
        orderId: isOrderFlow ? orderId ?? undefined : undefined,
        orderItems: isOrderFlow
          ? Object.entries(orderItems).map(([orderItemId, quantity]) => ({ orderItemId, quantity }))
          : undefined,
      });

      if (!res.success) {
        toast.error("Échec de l'envoi", res.error);
        return;
      }
      toast.success("Demande envoyée", "Nous vous répondrons dans les meilleurs délais.");
      i18nRouter.push(`/espace-pro/service-client/${res.claimId}`);
    });
  }

  const disabled = isSubmitting || isUploading;

  return (
    <div className="space-y-6">
      {/* Barre de progression */}
      <ProgressBar current={step} total={totalSteps} />

      {step > 1 && (
        <button
          type="button"
          onClick={goBack}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary font-body transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Retour
        </button>
      )}

      {step === 1 && <StepType onPick={pickType} />}

      {isOrderFlow && step === 2 && (
        <StepPickOrder
          orders={orders}
          loading={ordersLoading}
          onPick={pickOrder}
          onSwitchToOther={() => { setType("OTHER"); setStep(2); }}
        />
      )}

      {isOrderFlow && step === 3 && (
        <StepPickItems
          order={orderDetail}
          loading={orderDetailLoading}
          selected={orderItems}
          onChange={setItemQty}
          onContinue={() => setStep(4)}
        />
      )}

      {((isOrderFlow && step === 4) || (!isOrderFlow && step === 2)) && (
        <StepForm
          subject={subject}
          setSubject={setSubject}
          message={message}
          setMessage={setMessage}
          files={files}
          onAddFiles={addFiles}
          onRemoveFile={removeFile}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          fileInputRef={fileInputRef}
          onSubmit={submit}
          submitting={isSubmitting || isUploading}
          uploading={isUploading}
        />
      )}
    </div>
  );
}

/* ────────────────────────── Barre de progression ────────────────────────── */
function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
        let cls = "bg-bg-tertiary";
        if (n < current) cls = "bg-text-secondary";
        if (n === current) cls = "bg-text-primary";
        return <span key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${cls}`} aria-hidden />;
      })}
    </div>
  );
}

/* ─────────────────────── Étape 1 — Type de demande ─────────────────────── */
function StepType({ onPick }: { onPick: (t: ClaimType) => void }) {
  return (
    <div className="space-y-4">
      <h2 className="font-heading text-xl font-bold text-text-primary">De quoi souhaitez-vous nous parler ?</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TypeCard
          title="Rapport à une commande"
          desc="J'ai un souci avec des articles d'une commande précise (manquants, défectueux, erreur…)."
          icon={
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25l-9-4.5-9 4.5m18 0l-9 4.5m9-4.5v9l-9 4.5M3 8.25l9 4.5m-9-4.5v9l9 4.5m0-13.5v13.5" />
            </svg>
          }
          onClick={() => onPick("ORDER_RELATED")}
        />
        <TypeCard
          title="Autre demande"
          desc="Question générale, compte, tarif, informations produits, ou tout autre sujet."
          icon={
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          }
          onClick={() => onPick("OTHER")}
        />
      </div>
    </div>
  );
}

function TypeCard({ title, desc, icon, onClick }: { title: string; desc: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-bg-primary p-6 text-left shadow-sm hover:border-text-primary hover:shadow-md transition-all"
    >
      <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-bg-secondary text-text-primary group-hover:bg-text-primary group-hover:text-text-inverse transition-colors">
        {icon}
      </span>
      <span className="font-heading text-lg font-bold text-text-primary">{title}</span>
      <span className="text-sm text-text-secondary font-body leading-relaxed">{desc}</span>
    </button>
  );
}

/* ─────────────────────── Étape 2A — Choix de commande ─────────────────────── */
function StepPickOrder({
  orders,
  loading,
  onPick,
  onSwitchToOther,
}: {
  orders: OrderSummary[] | null;
  loading: boolean;
  onPick: (id: string) => void;
  onSwitchToOther: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-bg-primary p-8 text-center text-sm text-text-muted">
        Chargement de vos commandes…
      </div>
    );
  }
  if (!orders || orders.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-bg-primary p-8 text-center space-y-4">
        <p className="text-sm text-text-secondary">Vous n'avez pas encore de commande éligible.</p>
        <button
          type="button"
          onClick={onSwitchToOther}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-dark text-text-inverse text-sm font-semibold hover:bg-primary-hover"
        >
          Faire une autre demande
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h2 className="font-heading text-xl font-bold text-text-primary">Sur quelle commande porte votre demande ?</h2>
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onPick(o.id)}
              className="w-full flex items-center justify-between gap-4 rounded-2xl border border-border bg-bg-primary px-5 py-4 text-left hover:border-text-primary hover:shadow-sm transition-all"
            >
              <div className="min-w-0">
                <p className="font-heading font-bold text-text-primary">{o.orderNumber}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {new Date(o.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                  {" · "}
                  {o.totalArticles} article{o.totalArticles > 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-heading font-bold text-text-primary tabular-nums">{o.totalTTC.toFixed(2)} €</span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${o.status === "SHIPPED" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                  {o.status === "SHIPPED" ? "Expédiée" : "En cours"}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────── Étape 3A — Sélection des articles ─────────────────────── */
function StepPickItems({
  order,
  loading,
  selected,
  onChange,
  onContinue,
}: {
  order: { id: string; orderNumber: string; items: OrderItemForClaim[] } | null;
  loading: boolean;
  selected: Record<string, number>;
  onChange: (orderItemId: string, qty: number, maxQty: number) => void;
  onContinue: () => void;
}) {
  if (loading || !order) {
    return (
      <div className="rounded-2xl border border-border bg-bg-primary p-8 text-center text-sm text-text-muted">
        Chargement de la commande…
      </div>
    );
  }
  if (order.items.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center space-y-2">
        <p className="text-sm font-semibold text-amber-900">Cette commande ne contient aucun article.</p>
        <p className="text-xs text-amber-800">
          Impossible de faire un rapport lié à cette commande. Cliquez sur Retour pour choisir une autre commande, ou faites une demande libre depuis l'étape 1.
        </p>
      </div>
    );
  }
  const totalSelected = Object.values(selected).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-bold text-text-primary">Quels articles souhaitez-vous signaler ?</h2>
        <p className="text-sm text-text-secondary mt-1">
          Commande {order.orderNumber}. Indiquez pour chaque ligne la quantité concernée par votre demande. Laissez à 0 pour ignorer.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-bg-primary overflow-hidden shadow-sm">
        {/* Table desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-secondary border-b border-border">
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Article</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Couleur / Taille</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Qté commandée</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-primary bg-amber-50/50">Qté à signaler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.map((it) => {
                const value = selected[it.id] ?? 0;
                return (
                  <tr key={it.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {it.imagePath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imagePath} alt="" className="w-12 h-12 rounded-lg object-cover border border-border shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-bg-secondary shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-text-primary text-sm line-clamp-2">{it.productName}</p>
                          <p className="text-[11px] text-text-muted font-mono mt-0.5">{it.productRef}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      <span>{it.colorName || "—"}</span>
                      <ItemSizes sizesJson={it.sizesJson} legacySize={it.size} />
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-text-primary tabular-nums">{it.quantity}</td>
                    <td className="px-4 py-3 bg-amber-50/30">
                      <Stepper value={value} min={0} max={it.quantity} onChange={(n) => onChange(it.id, n, it.quantity)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Cards mobile */}
        <div className="md:hidden divide-y divide-border">
          {order.items.map((it) => {
            const value = selected[it.id] ?? 0;
            return (
              <div key={it.id} className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  {it.imagePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imagePath} alt="" className="w-14 h-14 rounded-lg object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-bg-secondary shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-primary text-sm line-clamp-2">{it.productName}</p>
                    <p className="text-[11px] text-text-muted font-mono mt-0.5">{it.productRef}</p>
                    <p className="text-xs text-text-secondary mt-1">
                      {it.colorName || "—"}
                      <ItemSizes sizesJson={it.sizesJson} legacySize={it.size} inline />
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-text-muted">
                    Commandé : <strong className="text-text-primary">{it.quantity}</strong>
                  </span>
                  <Stepper value={value} min={0} max={it.quantity} onChange={(n) => onChange(it.id, n, it.quantity)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
        <p className="text-xs text-text-muted">
          {totalSelected === 0
            ? "Aucun article signalé pour l'instant."
            : `${totalSelected} article${totalSelected > 1 ? "s" : ""} à signaler.`}
        </p>
        <button
          type="button"
          onClick={onContinue}
          disabled={totalSelected === 0}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-dark text-text-inverse text-sm font-semibold shadow-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continuer
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ItemSizes({ sizesJson, legacySize, inline }: { sizesJson: string | null; legacySize: string | null; inline?: boolean }) {
  const sizes = parseSizes(sizesJson);
  if (sizes.length > 0) {
    return (
      <span className={inline ? " · " + sizes.map((s) => `${s.name} × ${s.quantity}`).join(", ") : undefined}>
        {!inline && (
          <>
            {" · "}
            {sizes.map((s) => `${s.name} × ${s.quantity}`).join(", ")}
          </>
        )}
      </span>
    );
  }
  if (legacySize) {
    return <span className={inline ? " · " + legacySize : undefined}>{!inline && ` · ${legacySize}`}</span>;
  }
  return null;
}

function parseSizes(json: string | null): { name: string; quantity: number }[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as { name: string; quantity: number }[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-border bg-white overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label="Diminuer"
        className="w-9 h-9 flex items-center justify-center text-text-primary hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-12 text-center font-semibold text-sm bg-transparent focus:outline-none tabular-nums appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="Augmenter"
        className="w-9 h-9 flex items-center justify-center text-text-primary hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        +
      </button>
    </div>
  );
}

/* ─────────────────────── Étape finale — Formulaire ─────────────────────── */
function StepForm({
  subject,
  setSubject,
  message,
  setMessage,
  files,
  onAddFiles,
  onRemoveFile,
  isDragging,
  setIsDragging,
  fileInputRef,
  onSubmit,
  submitting,
  uploading,
}: {
  subject: string;
  setSubject: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
  files: File[];
  onAddFiles: (f: FileList | File[]) => void;
  onRemoveFile: (i: number) => void;
  isDragging: boolean;
  setIsDragging: (b: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  submitting: boolean;
  uploading: boolean;
}) {
  return (
    <div className="space-y-5">
      <h2 className="font-heading text-xl font-bold text-text-primary">Détails de votre demande</h2>

      <div>
        <label htmlFor="claim-subject" className="block text-sm font-semibold text-text-primary mb-1.5">
          Sujet
        </label>
        <input
          id="claim-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value.slice(0, MAX_SUBJECT))}
          disabled={submitting}
          placeholder="Résumez votre demande en quelques mots"
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-text-primary focus:ring-4 focus:ring-black/5 disabled:bg-zinc-50"
          required
        />
        <p className="text-[11px] text-text-muted mt-1">{subject.length}/{MAX_SUBJECT}</p>
      </div>

      <div>
        <label htmlFor="claim-message" className="block text-sm font-semibold text-text-primary mb-1.5">
          Votre message
        </label>
        <textarea
          id="claim-message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
          disabled={submitting}
          placeholder="Décrivez votre demande. Plus vous serez précis(e), plus vite nous pourrons vous répondre."
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-text-primary focus:ring-4 focus:ring-black/5 disabled:bg-zinc-50 resize-y"
          required
        />
        <p className="text-[11px] text-text-muted mt-1">{message.length}/{MAX_MESSAGE}</p>
      </div>

      <div
        className={`rounded-xl border-2 border-dashed p-4 transition-colors ${isDragging ? "border-text-primary bg-bg-secondary" : "border-border bg-bg-secondary"}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length > 0) onAddFiles(e.dataTransfer.files); }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-text-primary">Pièces jointes (optionnel)</p>
            <p className="text-[11px] text-text-muted mt-0.5">Images ou PDF, 10 Mo max par fichier. Aucune limite de nombre.</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-border text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            Ajouter
          </button>
        </div>

        {files.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-border text-xs">
                <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                <span className="max-w-[180px] truncate">{f.name}</span>
                <span className="text-text-muted">{formatSize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(i)}
                  className="text-text-muted hover:text-red-600 text-base leading-none"
                  aria-label="Retirer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !subject.trim() || !message.trim()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-dark text-text-inverse text-sm font-semibold shadow-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? "Envoi des pièces jointes…" : submitting ? "Envoi…" : "Envoyer ma demande"}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
