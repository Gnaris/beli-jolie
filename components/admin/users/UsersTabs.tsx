import Link from "next/link";

interface UsersTabsProps {
  currentTab: "inscrits" | "fiches";
  registeredCount: number;
  cardsCount: number;
}

export default function UsersTabs({ currentTab, registeredCount, cardsCount }: UsersTabsProps) {
  const tabs = [
    { key: "inscrits" as const, label: "Clients inscrits", count: registeredCount, href: "/admin/clients", badge: "bg-bg-secondary text-text-secondary" },
    { key: "fiches" as const, label: "Mes fiches clients", count: cardsCount, href: "/admin/clients?tab=fiches", badge: "bg-violet-100 text-violet-700" },
  ];

  return (
    <div className="flex items-center justify-center sm:justify-start gap-1 border-b border-border overflow-x-auto">
      {tabs.map((t) => {
        const active = t.key === currentTab;
        return (
          <Link
            key={t.key}
            href={t.href}
            prefetch={false}
            className={`relative px-4 sm:px-5 py-3 text-[13px] font-body font-semibold flex items-center gap-2 whitespace-nowrap transition-colors ${
              active ? "text-text-primary" : "text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
            <span className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-semibold ${t.badge}`}>
              {t.count}
            </span>
            {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-text-primary rounded-full" />}
          </Link>
        );
      })}
    </div>
  );
}
