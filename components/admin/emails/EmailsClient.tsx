"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import type { EmailScenarioKey } from "@prisma/client";
import {
  toggleScenario,
  updateAbandonedCartReminders,
  sendAbandonedCartTest,
  sendBackInStockTest,
  sendWelcomeTest,
  triggerAbandonedCartScanNow,
  dispatchBackInStockNow,
  sendNewsletterTestAction,
  launchNewsletterCampaign,
  searchProductsForNewsletter,
} from "@/app/actions/admin/email-scenarios";

interface RecentSend {
  id: string;
  scenarioKey: EmailScenarioKey;
  recipientEmail: string;
  subject: string;
  sentAt: string;
  openedAt: string | null;
  clickedAt: string | null;
}

interface PendingRestockProduct {
  productId: string;
  productName: string;
  reference: string;
  priceLabel: string;
  imageUrl: string | null;
  colors: string[];
  variantsCount: number;
  favoritedBy: number;
  occurredAt: string;
}

interface Props {
  scenarios: {
    abandonedCart: { enabled: boolean; reminders: { afterHours: number }[] };
    backInStock: {
      enabled: boolean;
      pendingSummary: { events: number; distinctProducts: number; eligibleClients: number };
      pendingProducts: PendingRestockProduct[];
    };
    welcome: { enabled: boolean };
    newsletter: { enabled: boolean };
  };
  audienceCount: number;
  recentSends: RecentSend[];
  stats30d: { sent: number; opened: number; clicked: number; byScenario: Record<string, number> };
}

type Tab = "abandonedCart" | "backInStock" | "welcome" | "newsletter";

const TAB_LABEL: Record<Tab, string> = {
  abandonedCart: "Panier abandonné",
  backInStock: "Retour en stock",
  welcome: "Bienvenue",
  newsletter: "Newsletter",
};

const KEY_BY_TAB: Record<Tab, EmailScenarioKey> = {
  abandonedCart: "ABANDONED_CART",
  backInStock: "BACK_IN_STOCK",
  welcome: "WELCOME",
  newsletter: "NEWSLETTER",
};

const SCENARIO_LABEL: Record<string, string> = {
  ABANDONED_CART: "Panier abandonné",
  BACK_IN_STOCK: "Retour en stock",
  WELCOME: "Bienvenue",
  NEWSLETTER: "Newsletter",
};

export default function EmailsClient({ scenarios, audienceCount, recentSends, stats30d }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("abandonedCart");

  // État local pour chaque scénario
  const [enabled, setEnabled] = useState({
    abandonedCart: scenarios.abandonedCart.enabled,
    backInStock: scenarios.backInStock.enabled,
    welcome: scenarios.welcome.enabled,
    newsletter: scenarios.newsletter.enabled,
  });
  const [reminders, setReminders] = useState<number[]>(
    scenarios.abandonedCart.reminders.map((r) => r.afterHours),
  );
  const [testEmail, setTestEmail] = useState("");

  // Newsletter
  const [nlSubject, setNlSubject] = useState("Les nouveautés de la semaine sont arrivées");
  const [nlEyebrow, setNlEyebrow] = useState("Nouveautés");
  const [nlTitle, setNlTitle] = useState("Notre sélection de la semaine");
  const [nlIntro, setNlIntro] = useState(
    "Voici notre sélection coup de cœur. Le reste vous attend sur le site.",
  );
  const [nlBrowseUrl, setNlBrowseUrl] = useState("/fr/produits");
  const [nlProducts, setNlProducts] = useState<
    { id: string; name: string; reference: string; priceLabel: string; thumbUrl: string | null }[]
  >([]);
  const [nlSearch, setNlSearch] = useState("");
  const [nlSearchResults, setNlSearchResults] = useState<typeof nlProducts>([]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      if (nlSearch.trim().length < 2 && nlSearch.length !== 0) {
        setNlSearchResults([]);
        return;
      }
      try {
        const results = await searchProductsForNewsletter(nlSearch);
        setNlSearchResults(results);
      } catch {
        setNlSearchResults([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [nlSearch]);

  // ─── Actions ────────────────────────────────────────────────

  function onToggle(t: Tab, next: boolean) {
    setEnabled((prev) => ({ ...prev, [t]: next }));
    startTransition(async () => {
      const res = await toggleScenario(KEY_BY_TAB[t], next);
      if (!res.success) {
        toast.error(`Échec : ${res.error}`);
        setEnabled((prev) => ({ ...prev, [t]: !next }));
      } else {
        toast.success(next ? "Scénario activé" : "Scénario mis en pause");
        router.refresh();
      }
    });
  }

  function onSaveReminders() {
    startTransition(async () => {
      const res = await updateAbandonedCartReminders(reminders);
      if (!res.success) toast.error(`Échec : ${res.error}`);
      else {
        toast.success("Délais mis à jour");
        router.refresh();
      }
    });
  }

  function onScanNow(t: Tab) {
    startTransition(async () => {
      if (t === "abandonedCart") {
        const res = await triggerAbandonedCartScanNow();
        if (!res.success) toast.error(`Échec : ${res.error}`);
        else {
          toast.success(
            `Scan terminé — ${res.sent ?? 0} envoyé(s), ${res.skipped ?? 0} ignoré(s), ${res.errors ?? 0} erreur(s)`,
          );
          router.refresh();
        }
      } else if (t === "backInStock") {
        const res = await dispatchBackInStockNow();
        if (!res.success) toast.error(`Échec : ${res.error}`);
        else {
          toast.success(
            `${res.emailsSent ?? 0} email(s) envoyé(s) à ${res.clientsNotified ?? 0} client(s)`,
          );
          router.refresh();
        }
      }
    });
  }

  function onSendTest(t: Tab) {
    if (!testEmail.trim()) {
      toast.error("Renseignez une adresse email de test");
      return;
    }
    startTransition(async () => {
      let res;
      if (t === "abandonedCart") res = await sendAbandonedCartTest(testEmail.trim());
      else if (t === "backInStock") res = await sendBackInStockTest(testEmail.trim());
      else if (t === "welcome") res = await sendWelcomeTest(testEmail.trim());
      else {
        res = await sendNewsletterTestAction(testEmail.trim(), {
          subject: nlSubject,
          eyebrow: nlEyebrow,
          title: nlTitle,
          intro: nlIntro,
          browseAllUrl: nlBrowseUrl,
          browseAllLabel: "Voir toutes les nouveautés →",
          productIds: nlProducts.map((p) => p.id),
        });
      }
      if (!res.success) toast.error(`Échec : ${res.error}`);
      else toast.success(`Email test envoyé à ${testEmail}`);
    });
  }

  function onSendCampaign() {
    if (nlProducts.length === 0) {
      toast.error("Choisissez au moins 1 produit avant d'envoyer la campagne");
      return;
    }
    if (!confirm(`Envoyer cette newsletter à ${audienceCount} client(s) approuvé(s) ? Cette action est irréversible.`)) {
      return;
    }
    startTransition(async () => {
      const res = await launchNewsletterCampaign({
        subject: nlSubject,
        eyebrow: nlEyebrow,
        title: nlTitle,
        intro: nlIntro,
        browseAllUrl: nlBrowseUrl,
        browseAllLabel: "Voir toutes les nouveautés →",
        productIds: nlProducts.map((p) => p.id),
      });
      if (!res.success) toast.error(`Échec : ${res.error}`);
      else {
        toast.success(
          `Campagne envoyée — ${res.sent ?? 0} envoyé(s), ${res.skipped ?? 0} ignoré(s), ${res.errors ?? 0} erreur(s)`,
        );
        router.refresh();
      }
    });
  }

  const openRate = stats30d.sent === 0 ? 0 : Math.round((stats30d.opened / stats30d.sent) * 100);
  const clickRate = stats30d.sent === 0 ? 0 : Math.round((stats30d.clicked / stats30d.sent) * 100);
  const activeCount = Object.values(enabled).filter(Boolean).length;

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-8 space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-50 via-bg-primary to-bg-primary border border-border p-8 md:p-10">
        <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl bg-violet-200/40" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border">
            <span className="w-2 h-2 rounded-full bg-violet-500" />
            <span className="uppercase tracking-[0.18em] text-xs font-semibold text-text-secondary">
              Marketing automatique
            </span>
          </div>
          <h1 className="font-heading font-bold text-2xl md:text-3xl mt-4 text-text-primary">
            Emails automatiques
          </h1>
          <p className="mt-2 text-text-secondary max-w-2xl">
            {"Configurez vos 4 scénarios d'emails (panier abandonné, retour en stock, bienvenue, newsletter). Chaque scénario peut être activé, pausé et testé indépendamment."}
          </p>
        </div>
      </div>

      {/* KPI 30j */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile label="Envoyés (30 j)" value={stats30d.sent} accent="violet" />
        <KpiTile label="Ouverts" value={`${stats30d.opened} · ${openRate}%`} accent="emerald" />
        <KpiTile label="Cliqués" value={`${stats30d.clicked} · ${clickRate}%`} accent="sky" />
        <KpiTile label="Scénarios actifs" value={`${activeCount}/4`} accent="amber" />
      </div>

      {/* Tabs */}
      <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden">
        <div className="border-b border-border flex gap-1 p-1 overflow-x-auto">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${
                tab === t
                  ? "bg-bg-dark text-text-inverse"
                  : "text-text-secondary hover:bg-bg-secondary"
              }`}
            >
              <span
                className={`inline-block w-2 h-2 rounded-full mr-2 ${
                  enabled[t] ? "bg-emerald-400" : "bg-slate-300"
                }`}
              />
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="p-6 md:p-8">
          {/* Tabs contents */}
          {tab === "abandonedCart" && (
            <ScenarioBody
              title="Relance les clients qui ont laissé un panier en plan"
              description={"Un email automatique est envoyé après un délai configuré (24 h, 72 h…) si le client n'a pas finalisé sa commande. Chaque relance n'est envoyée qu'une seule fois par panier."}
              accent="violet"
              enabled={enabled.abandonedCart}
              onToggle={(n) => onToggle("abandonedCart", n)}
              disabled={pending}
            >
              <div className="mt-8">
                <div className="uppercase tracking-[0.18em] text-xs font-semibold text-text-muted">
                  Délais entre relances
                </div>
                <div className="mt-3 space-y-2">
                  {reminders.map((h, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center text-sm font-semibold text-text-primary">
                        {idx + 1}
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={2160}
                        value={h}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          setReminders((prev) => prev.map((x, i) => (i === idx ? (Number.isFinite(v) ? v : x) : x)));
                        }}
                        className="w-24 px-3 py-2 rounded-lg border border-border bg-bg-primary text-text-primary"
                      />
                      <span className="text-sm text-text-secondary">{"heures après l'abandon"}</span>
                      {reminders.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setReminders((prev) => prev.filter((_, i) => i !== idx))}
                          className="ml-auto text-xs text-text-muted hover:text-text-primary underline"
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setReminders((prev) => [...prev, 168])}
                    className="text-sm text-violet-600 hover:text-violet-700 font-medium"
                  >
                    + Ajouter une relance
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={onSaveReminders}
                    disabled={pending}
                    className="bg-bg-dark text-text-inverse px-5 py-2.5 rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    Enregistrer les délais
                  </button>
                  <button
                    type="button"
                    onClick={() => onScanNow("abandonedCart")}
                    disabled={pending || !enabled.abandonedCart}
                    className="border border-border text-text-primary px-5 py-2.5 rounded-xl font-medium hover:bg-bg-secondary disabled:opacity-50"
                  >
                    Scanner maintenant
                  </button>
                </div>
              </div>
              <TestEmailBox
                testEmail={testEmail}
                setTestEmail={setTestEmail}
                onSend={() => onSendTest("abandonedCart")}
                disabled={pending}
              />
            </ScenarioBody>
          )}

          {tab === "backInStock" && (
            <ScenarioBody
              title="Prévient les clients quand leurs favoris repassent en stock"
              description={"Chaque fois qu'une variante repasse de 0 à un stock positif, l'événement est enregistré dans une file d'attente. Vous décidez du moment d'envoi via le widget flottant ou le bouton ci-dessous — chaque client reçoit UN SEUL email récapitulatif avec tous ses favoris qui viennent d'être réapprovisionnés."}
              accent="emerald"
              enabled={enabled.backInStock}
              onToggle={(n) => onToggle("backInStock", n)}
              disabled={pending}
            >
              <div className="mt-8 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="uppercase tracking-[0.18em] text-xs font-semibold text-emerald-700">
                      {"File d'attente"}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-heading font-bold text-3xl text-emerald-700">
                        {scenarios.backInStock.pendingSummary.distinctProducts}
                      </span>
                      <span className="text-sm text-text-secondary">
                        {`produit${scenarios.backInStock.pendingSummary.distinctProducts > 1 ? "s" : ""} · ${scenarios.backInStock.pendingSummary.eligibleClients} client${scenarios.backInStock.pendingSummary.eligibleClients > 1 ? "s" : ""} recevront un email`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onScanNow("backInStock")}
                    disabled={pending || !enabled.backInStock || scenarios.backInStock.pendingSummary.distinctProducts === 0}
                    className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Envoyer maintenant
                  </button>
                </div>
              </div>

              {/* Liste des produits en file d'attente */}
              {scenarios.backInStock.pendingProducts.length > 0 && (
                <div className="mt-6 border border-border rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-bg-secondary">
                    <div className="uppercase tracking-[0.18em] text-xs font-semibold text-text-muted">
                      {`Produits remis en stock (${scenarios.backInStock.pendingProducts.length})`}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-bg-secondary text-text-muted uppercase tracking-wider text-xs">
                        <tr>
                          <th className="text-left px-4 py-2">Produit</th>
                          <th className="text-left px-4 py-2">Couleurs</th>
                          <th className="text-left px-4 py-2">Prix</th>
                          <th className="text-left px-4 py-2">Favoris</th>
                          <th className="text-left px-4 py-2">Enregistré</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scenarios.backInStock.pendingProducts.map((p) => (
                          <tr key={p.productId} className="border-t border-border">
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded bg-bg-tertiary overflow-hidden flex items-center justify-center shrink-0">
                                  {p.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-text-muted">◆</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-text-primary font-medium truncate">{p.productName}</div>
                                  <div className="text-xs text-text-muted">{p.reference}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-text-secondary">
                              {p.colors.length > 0 ? p.colors.join(", ") : "—"}
                            </td>
                            <td className="px-4 py-2 text-text-primary font-medium tabular-nums">
                              {p.priceLabel}
                            </td>
                            <td className="px-4 py-2 text-text-secondary tabular-nums">
                              {p.favoritedBy}
                            </td>
                            <td className="px-4 py-2 text-text-muted text-xs">
                              {formatDate(p.occurredAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <TestEmailBox
                testEmail={testEmail}
                setTestEmail={setTestEmail}
                onSend={() => onSendTest("backInStock")}
                disabled={pending}
              />
            </ScenarioBody>
          )}

          {tab === "welcome" && (
            <ScenarioBody
              title="Accueille chaque nouveau compte client validé"
              description={"Envoyé automatiquement quand vous approuvez un nouveau client dans /admin/utilisateurs (PENDING → APPROVED)."}
              accent="sky"
              enabled={enabled.welcome}
              onToggle={(n) => onToggle("welcome", n)}
              disabled={pending}
            >
              <TestEmailBox
                testEmail={testEmail}
                setTestEmail={setTestEmail}
                onSend={() => onSendTest("welcome")}
                disabled={pending}
              />
            </ScenarioBody>
          )}

          {tab === "newsletter" && (
            <ScenarioBody
              title="Envoi manuel de nouveautés à tous vos clients"
              description={`Sélectionnez les produits à mettre en avant, saisissez un objet et un intro, puis envoyez à vos ${audienceCount} client(s) approuvé(s). Un délai automatique entre chaque envoi évite la saturation du serveur mail.`}
              accent="amber"
              enabled={enabled.newsletter}
              onToggle={(n) => onToggle("newsletter", n)}
              disabled={pending}
            >
              <div className="mt-6 space-y-4">
                <Field label="Objet du mail">
                  <input
                    type="text"
                    value={nlSubject}
                    onChange={(e) => setNlSubject(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary"
                  />
                </Field>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Sur-titre (petit texte au-dessus du titre)">
                    <input
                      type="text"
                      value={nlEyebrow}
                      onChange={(e) => setNlEyebrow(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary"
                    />
                  </Field>
                  <Field label="Titre principal (dans le mail)">
                    <input
                      type="text"
                      value={nlTitle}
                      onChange={(e) => setNlTitle(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary"
                    />
                  </Field>
                </div>
                <Field label="Introduction (2-3 phrases)">
                  <textarea
                    value={nlIntro}
                    onChange={(e) => setNlIntro(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary"
                  />
                </Field>
                <Field label="URL du bouton « Voir toutes les nouveautés »">
                  <input
                    type="text"
                    value={nlBrowseUrl}
                    onChange={(e) => setNlBrowseUrl(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary"
                  />
                </Field>

                {/* Sélection de produits */}
                <div>
                  <div className="uppercase tracking-[0.18em] text-xs font-semibold text-text-muted mb-2">
                    Produits mis en avant ({nlProducts.length})
                  </div>
                  {nlProducts.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                      {nlProducts.map((p, idx) => (
                        <div
                          key={p.id}
                          className="border border-border rounded-xl p-2 flex flex-col items-center text-center relative"
                        >
                          <div className="text-xs text-text-muted absolute top-1 left-1">#{idx + 1}</div>
                          <button
                            type="button"
                            onClick={() => setNlProducts((prev) => prev.filter((x) => x.id !== p.id))}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-bg-tertiary text-text-secondary hover:bg-red-100 hover:text-red-600 text-sm"
                          >
                            ×
                          </button>
                          <div className="w-16 h-16 rounded-lg bg-bg-tertiary flex items-center justify-center overflow-hidden">
                            {p.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.thumbUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-text-muted">◆</span>
                            )}
                          </div>
                          <div className="text-xs mt-1 font-medium truncate w-full">{p.name}</div>
                          <div className="text-xs text-text-muted">{p.priceLabel}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Rechercher un produit à ajouter…"
                      value={nlSearch}
                      onChange={(e) => setNlSearch(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary"
                    />
                    {nlSearchResults.length > 0 && nlSearch.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full max-h-80 overflow-y-auto bg-bg-primary border border-border rounded-xl shadow-lg">
                        {nlSearchResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setNlProducts((prev) => {
                                if (prev.find((x) => x.id === p.id)) return prev;
                                return [...prev, p];
                              });
                              setNlSearch("");
                              setNlSearchResults([]);
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-secondary text-left"
                          >
                            <div className="w-10 h-10 rounded bg-bg-tertiary flex items-center justify-center overflow-hidden shrink-0">
                              {p.thumbUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.thumbUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-text-muted">◆</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{p.name}</div>
                              <div className="text-xs text-text-muted">{p.reference} · {p.priceLabel}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-border flex flex-wrap gap-3 items-center">
                  <button
                    type="button"
                    onClick={onSendCampaign}
                    disabled={pending || !enabled.newsletter || nlProducts.length === 0}
                    className="bg-bg-dark text-text-inverse px-5 py-2.5 rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    Envoyer la campagne à {audienceCount} client(s)
                  </button>
                  <span className="text-xs text-text-muted">
                    {"L'envoi peut prendre plusieurs minutes selon le nombre de destinataires."}
                  </span>
                </div>
              </div>
              <TestEmailBox
                testEmail={testEmail}
                setTestEmail={setTestEmail}
                onSend={() => onSendTest("newsletter")}
                disabled={pending}
              />
            </ScenarioBody>
          )}
        </div>
      </div>

      {/* Historique */}
      <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden">
        <div className="p-6 md:p-8 border-b border-border">
          <div className="uppercase tracking-[0.18em] text-xs font-semibold text-text-muted">
            Historique
          </div>
          <h2 className="font-heading font-bold text-xl mt-2 text-text-primary">
            30 derniers envois (tous scénarios)
          </h2>
        </div>
        {recentSends.length === 0 ? (
          <div className="p-10 text-center text-text-secondary">Aucun email envoyé pour le moment.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary text-text-muted uppercase tracking-wider text-xs">
                <tr>
                  <th className="text-left px-6 py-3">Scénario</th>
                  <th className="text-left px-6 py-3">Destinataire</th>
                  <th className="text-left px-6 py-3">Envoyé</th>
                  <th className="text-left px-6 py-3">Ouvert</th>
                  <th className="text-left px-6 py-3">Cliqué</th>
                </tr>
              </thead>
              <tbody>
                {recentSends.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-6 py-3 text-text-secondary">
                      {SCENARIO_LABEL[s.scenarioKey] ?? s.scenarioKey}
                    </td>
                    <td className="px-6 py-3 text-text-primary">{s.recipientEmail}</td>
                    <td className="px-6 py-3 text-text-secondary">{formatDate(s.sentAt)}</td>
                    <td className="px-6 py-3">
                      {s.openedAt ? <StatusPill color="emerald">Oui</StatusPill> : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-6 py-3">
                      {s.clickedAt ? <StatusPill color="sky">Oui</StatusPill> : <span className="text-text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="text-center text-sm text-text-muted">
        <Link href="/admin" className="hover:text-text-primary underline">
          {"← Retour à l'accueil admin"}
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Sous-composants
// ─────────────────────────────────────────────

function ScenarioBody({
  title,
  description,
  accent,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  title: string;
  description: string;
  accent: "violet" | "emerald" | "sky" | "amber";
  enabled: boolean;
  onToggle: (n: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const accentText = {
    violet: "text-violet-600",
    emerald: "text-emerald-600",
    sky: "text-sky-600",
    amber: "text-amber-600",
  }[accent];
  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className={`uppercase tracking-[0.18em] text-xs font-semibold ${accentText}`}>
            Scénario
          </div>
          <h2 className="font-heading font-bold text-xl mt-2 text-text-primary">{title}</h2>
          <p className="text-text-secondary mt-1 max-w-2xl">{description}</p>
        </div>
        <ToggleSwitch enabled={enabled} onChange={onToggle} disabled={disabled} accent={accent} />
      </div>
      {children}
    </div>
  );
}

function TestEmailBox({
  testEmail,
  setTestEmail,
  onSend,
  disabled,
}: {
  testEmail: string;
  setTestEmail: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-8 p-4 rounded-xl bg-bg-secondary border border-border">
      <div className="uppercase tracking-[0.18em] text-xs font-semibold text-text-muted">
        Envoyer un email de test
      </div>
      <p className="text-sm text-text-secondary mt-1">
        {"Envoie un exemple à l'adresse indiquée pour visualiser le rendu réel."}
      </p>
      <div className="mt-3 flex gap-2 flex-wrap">
        <input
          type="email"
          placeholder="votre.email@exemple.com"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2.5 rounded-lg border border-border bg-bg-primary text-text-primary"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled}
          className="bg-bg-dark text-text-inverse px-5 py-2.5 rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
        >
          Envoyer un test
        </button>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: "violet" | "emerald" | "sky" | "amber";
}) {
  const map = {
    violet: "text-violet-700 bg-violet-50 border-violet-100",
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-100",
    sky: "text-sky-700 bg-sky-50 border-sky-100",
    amber: "text-amber-700 bg-amber-50 border-amber-100",
  } as const;
  return (
    <div className={`relative rounded-2xl border p-4 md:p-5 ${map[accent]}`}>
      <div className="uppercase tracking-[0.18em] text-xs font-semibold opacity-80">{label}</div>
      <div className="font-heading font-bold text-2xl md:text-3xl mt-2">{value}</div>
    </div>
  );
}

function ToggleSwitch({
  enabled,
  onChange,
  disabled,
  accent = "violet",
}: {
  enabled: boolean;
  onChange: (n: boolean) => void;
  disabled?: boolean;
  accent?: "violet" | "emerald" | "sky" | "amber";
}) {
  const onColor = {
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    amber: "bg-amber-500",
  }[accent];
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
        enabled ? onColor : "bg-bg-tertiary"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      aria-pressed={enabled}
    >
      <span
        className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-7" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function StatusPill({
  color,
  children,
}: {
  color: "emerald" | "sky";
  children: React.ReactNode;
}) {
  const map = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    sky: "bg-sky-50 text-sky-700 border-sky-100",
  } as const;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${map[color]}`}>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-[0.18em] font-semibold text-text-muted mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
