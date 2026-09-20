import { Link } from "@/i18n/navigation";

type Variant = "beliandjolie" | "issyma";

interface Props {
  variant: Variant;
  shopName: string;
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  addressLine1: string;
  addressLine2: string;
  welcomeLabel: string;
  welcomeValue: string;
  hoursLabel: string;
  hoursValue: string;
  description: string;
  ctaDirections: string;
  ctaContact: string;
  /** Latitude du point (embed OpenStreetMap sans clé API). */
  lat: number;
  /** Longitude du point. */
  lon: number;
  /** Adresse texte utilisée pour le bouton « Itinéraire » (Google Maps). */
  mapsQuery: string;
  /** Texte court affiché sur la pastille au centre de la carte */
  pinLabel: string;
}

const ISSYMA = {
  bg: "#ffffff",
  wine700: "#7a2a3c",
  wine800: "#4d1b28",
  cream: "#f4ead9",
  ink: "#2a1418",
  inkSoft: "#6b5d5d",
  muted: "#8a7460",
  borderSoft: "#e9dcd6",
} as const;

const BJ = {
  accent: "#0f172a",
} as const;

export default function ShowroomSection({
  variant,
  eyebrow,
  titleLine1,
  titleLine2,
  addressLine1,
  addressLine2,
  welcomeLabel,
  welcomeValue,
  hoursLabel,
  hoursValue,
  description,
  ctaDirections,
  ctaContact,
  lat,
  lon,
  mapsQuery,
  pinLabel,
  shopName,
}: Props) {
  const isIssyma = variant === "issyma";

  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsQuery)}`;

  // Zoom rue (bbox ~600 m). OpenStreetMap embed ne demande pas de clé API,
  // contrairement à Google Maps embed qui bloque sans /maps/embed?pb= signé.
  const span = 0.004;
  const bbox = [lon - span, lat - span * 0.6, lon + span, lat + span * 0.6].join(",");
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;

  // ── Variante Issyma ────────────────────────────────────────────────────────
  if (isIssyma) {
    return (
      <section style={{ background: ISSYMA.bg }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20 lg:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* Texte */}
            <div>
              <p className="eyebrow mb-5">
                <span className="wine-underline" />
                {eyebrow}
              </p>
              <h2 className="serif text-3xl sm:text-4xl lg:text-5xl leading-tight font-bold" style={{ color: ISSYMA.ink }}>
                {titleLine1}
                <br />
                {titleLine2}
              </h2>

              <p
                className="text-[11px] tracking-[0.24em] uppercase font-semibold mt-6"
                style={{ color: ISSYMA.wine700 }}
              >
                {shopName}
              </p>
              <p className="mt-2 text-[15px] leading-relaxed" style={{ color: ISSYMA.ink }}>
                {addressLine1}
                <br />
                {addressLine2}
              </p>

              <div className="mt-8">
                <div className="info-row">
                  <span className="label">{welcomeLabel}</span>
                  <span className="value">{welcomeValue}</span>
                </div>
                <div className="info-row">
                  <span className="label">{hoursLabel}</span>
                  <span className="value">{hoursValue}</span>
                </div>
              </div>

              <p
                className="mt-6 text-[14px] leading-relaxed max-w-md"
                style={{ color: ISSYMA.muted }}
              >
                {description}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-wine inline-flex items-center gap-3 px-7 py-3.5 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold"
                >
                  {ctaDirections}
                  <span aria-hidden="true">→</span>
                </a>
                <Link
                  href="/nous-contacter"
                  className="btn-outline-wine inline-flex items-center gap-3 px-7 py-3.5 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold"
                >
                  {ctaContact}
                </Link>
              </div>
            </div>

            {/* Carte */}
            <div
              className="relative overflow-hidden aspect-[4/3] lg:aspect-[5/4]"
              style={{
                borderRadius: 20,
                border: `1px solid ${ISSYMA.borderSoft}`,
                boxShadow:
                  "0 30px 60px -30px rgba(50,15,25,.25), 0 8px 20px -12px rgba(50,15,25,.15)",
              }}
            >
              <div
                className="absolute z-10 flex items-center gap-3 rounded-2xl"
                style={{
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  padding: "10px 14px 10px 12px",
                  background: "#fff",
                  border: `1px solid ${ISSYMA.borderSoft}`,
                  boxShadow: "0 12px 24px -10px rgba(50,15,25,.35)",
                }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: ISSYMA.wine700,
                    color: ISSYMA.cream,
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <span
                  className="text-[12px] font-medium leading-tight"
                  style={{ color: ISSYMA.ink }}
                >
                  {pinLabel}
                </span>
              </div>
              <iframe
                src={embedSrc}
                width="100%"
                height="100%"
                style={{ border: 0, filter: "saturate(.9)" }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title={`${shopName} — carte du showroom`}
              />
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ── Variante Beliandjolie (ardoise) ────────────────────────────────────────
  return (
    <section className="bg-bg-secondary">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20 lg:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Texte */}
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-secondary font-semibold flex items-center gap-3 mb-5">
              <span className="inline-block w-8 h-px bg-text-primary" />
              {eyebrow}
            </p>
            <h2
              className="font-heading font-bold leading-tight text-text-primary"
              style={{ fontSize: "clamp(1.9rem, 3.4vw, 3rem)", letterSpacing: "-0.02em" }}
            >
              {titleLine1}
              <br />
              {titleLine2}
            </h2>

            <p className="text-[11px] uppercase tracking-[0.24em] text-text-secondary font-semibold mt-6">
              {shopName}
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-text-primary">
              {addressLine1}
              <br />
              {addressLine2}
            </p>

            <div className="mt-8 border-y border-border">
              <div className="grid grid-cols-[130px_1fr] gap-5 py-3.5 items-center border-b border-border">
                <span className="text-[11px] uppercase tracking-[0.22em] font-medium text-text-muted">
                  {welcomeLabel}
                </span>
                <span className="text-sm text-text-primary">{welcomeValue}</span>
              </div>
              <div className="grid grid-cols-[130px_1fr] gap-5 py-3.5 items-center">
                <span className="text-[11px] uppercase tracking-[0.22em] font-medium text-text-muted">
                  {hoursLabel}
                </span>
                <span className="text-sm text-text-primary">{hoursValue}</span>
              </div>
            </div>

            <p className="mt-6 text-sm leading-relaxed max-w-md text-text-muted">
              {description}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={directionsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 px-7 py-3.5 rounded-full bg-bg-dark text-text-inverse text-[11px] tracking-[0.22em] uppercase font-semibold font-heading hover:opacity-90 transition"
              >
                {ctaDirections}
                <span aria-hidden="true">→</span>
              </a>
              <Link
                href="/nous-contacter"
                className="inline-flex items-center gap-3 px-7 py-3.5 rounded-full border border-border bg-bg-primary text-text-primary text-[11px] tracking-[0.22em] uppercase font-semibold font-heading hover:bg-bg-secondary transition"
              >
                {ctaContact}
              </Link>
            </div>
          </div>

          {/* Carte */}
          <div
            className="relative overflow-hidden aspect-[4/3] lg:aspect-[5/4] rounded-2xl border border-border bg-bg-primary"
            style={{
              boxShadow: "0 30px 60px -30px rgba(15,23,42,.25), 0 8px 20px -12px rgba(15,23,42,.10)",
            }}
          >
            <div
              className="absolute z-10 flex items-center gap-3 rounded-2xl bg-bg-primary border border-border"
              style={{
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
                padding: "10px 14px 10px 12px",
                boxShadow: "0 12px 24px -10px rgba(15,23,42,.35)",
              }}
            >
              <span
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: BJ.accent,
                  color: "#fff",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <span className="text-[12px] font-medium leading-tight text-text-primary">
                {pinLabel}
              </span>
            </div>
            <iframe
              src={embedSrc}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title={`${shopName} — carte du showroom`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
