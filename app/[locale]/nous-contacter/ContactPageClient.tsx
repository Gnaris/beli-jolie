"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

interface ContactPageClientProps {
  shopName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  isOpen: boolean;
  nextSlot: { day: string; time: string } | null;
  schedule: { day: string; hours: string }[];
}

function IconPhone() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}

function IconClaim() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconMapPin() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  );
}

/** Format phone for tel: link (strip spaces, dots, dashes) */
function formatPhoneLink(phone: string): string {
  return phone.replace(/[\s.\-()]/g, "");
}

/** Format phone for WhatsApp link */
function formatWhatsAppLink(phone: string): string {
  const cleaned = phone.replace(/[\s.\-()]/g, "").replace(/^\+/, "");
  return `https://wa.me/${cleaned}`;
}

export default function ContactPageClient({
  shopName,
  phone,
  whatsapp,
  email,
  address,
  city,
  postalCode,
  isOpen,
  nextSlot,
  schedule,
}: ContactPageClientProps) {
  const t = useTranslations("contact");
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;
  const isApproved = session?.user?.status === "APPROVED";

  return (
    <div className="container-site py-8 md:py-12">
      {/* Page title */}
      <div className="text-center mb-10">
        <h1 className="font-heading text-2xl md:text-3xl font-bold text-text-primary">
          {t("title")}
        </h1>
        <p className="mt-2 text-text-secondary font-body max-w-xl mx-auto">
          {t("subtitle", { shopName })}
        </p>
      </div>

      {/* Order problem banner */}
      <div className="bg-warning/5 border border-warning/20 rounded-2xl p-5 md:p-6 mb-8">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center shrink-0 text-warning">
            <IconClaim />
          </div>
          <div className="flex-1">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              {t("orderProblem")}
            </h2>
            <p className="mt-1 text-sm text-text-secondary font-body">
              {t("orderProblemDesc")}
            </p>
            {isApproved ? (
              <Link
                href="/espace-pro/reclamations/nouveau"
                className="inline-flex items-center gap-2 mt-3 btn-primary text-sm py-2 px-4"
              >
                {t("openClaim")}
              </Link>
            ) : (
              <p className="mt-2 text-xs text-text-muted font-body">
                {t("loginToClaim")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Main contact options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

        {/* Chat / Messagerie */}
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
              <IconChat />
            </div>
            <div>
              <h2 className="font-heading text-base font-semibold text-text-primary">
                {t("chatTitle")}
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${isOpen ? "bg-success animate-pulse" : "bg-text-muted"}`} />
                <span className="text-xs font-body text-text-muted">
                  {isOpen ? t("statusOpen") : t("statusClosed")}
                </span>
              </div>
            </div>
          </div>
          <p className="text-sm text-text-secondary font-body mb-4">
            {isOpen ? t("chatDescOpen") : t("chatDescClosed")}
          </p>
          {!isOpen && nextSlot && (
            <p className="text-xs text-text-muted font-body mb-4">
              {t("nextOpen", { day: nextSlot.day, time: nextSlot.time })}
            </p>
          )}
          {isApproved ? (
            <Link
              href="/espace-pro"
              className="inline-flex items-center gap-2 btn-primary text-sm py-2 px-4"
            >
              {t("goToMessages")}
            </Link>
          ) : isLoggedIn ? (
            <p className="text-xs text-text-muted font-body">
              {t("accountPending")}
            </p>
          ) : (
            <Link href="/connexion" className="inline-flex items-center gap-2 btn-primary text-sm py-2 px-4">
              {t("loginToChat")}
            </Link>
          )}
        </div>

        {/* Phone & WhatsApp */}
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center text-success">
              <IconPhone />
            </div>
            <h2 className="font-heading text-base font-semibold text-text-primary">
              {t("phoneTitle")}
            </h2>
          </div>
          <p className="text-sm text-text-secondary font-body mb-4">
            {t("phoneDesc")}
          </p>

          <div className="space-y-3">
            {phone && (
              <a
                href={`tel:${formatPhoneLink(phone)}`}
                className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl hover:bg-bg-tertiary transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-bg-primary border border-border flex items-center justify-center text-text-secondary group-hover:text-text-primary transition-colors">
                  <IconPhone />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary font-body">{phone}</p>
                  <p className="text-xs text-text-muted font-body">{t("callUs")}</p>
                </div>
              </a>
            )}
            {whatsapp && (
              <a
                href={formatWhatsAppLink(whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl hover:bg-bg-tertiary transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-[#25D366]/10 border border-[#25D366]/20 flex items-center justify-center text-[#25D366]">
                  <IconWhatsApp />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary font-body">{whatsapp}</p>
                  <p className="text-xs text-text-muted font-body">WhatsApp</p>
                </div>
              </a>
            )}
            {email && (
              <a
                href={`mailto:${email}`}
                className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl hover:bg-bg-tertiary transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-bg-primary border border-border flex items-center justify-center text-text-secondary group-hover:text-text-primary transition-colors">
                  <IconMail />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary font-body">{email}</p>
                  <p className="text-xs text-text-muted font-body">{t("emailUs")}</p>
                </div>
              </a>
            )}
            {!phone && !whatsapp && !email && (
              <p className="text-sm text-text-muted font-body">{t("noContactInfo")}</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: Business hours + Address */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Business hours */}
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-bg-secondary flex items-center justify-center text-text-secondary">
              <IconClock />
            </div>
            <h2 className="font-heading text-base font-semibold text-text-primary">
              {t("hoursTitle")}
            </h2>
          </div>
          <div className="space-y-2">
            {schedule.map((s) => (
              <div key={s.day} className="flex items-center justify-between text-sm font-body">
                <span className="text-text-secondary">{s.day}</span>
                <span className={s.hours === "Fermé" ? "text-text-muted" : "text-text-primary font-medium"}>
                  {s.hours}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Address */}
        {(address || city) && (
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-bg-secondary flex items-center justify-center text-text-secondary">
                <IconMapPin />
              </div>
              <h2 className="font-heading text-base font-semibold text-text-primary">
                {t("addressTitle")}
              </h2>
            </div>
            <div className="text-sm text-text-secondary font-body space-y-1">
              {address && <p>{address}</p>}
              {(postalCode || city) && (
                <p>{[postalCode, city].filter(Boolean).join(" ")}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
