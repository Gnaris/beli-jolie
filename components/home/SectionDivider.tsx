interface SectionDividerProps {
  from?: string;
  to?: string;
  flip?: boolean;
}

export default function SectionDivider({
  from = "var(--color-bg-secondary)",
  to = "var(--color-bg-primary)",
  flip,
}: SectionDividerProps) {
  return (
    <div className={`w-full overflow-hidden leading-[0] ${flip ? "rotate-180" : ""}`} style={{ background: to }}>
      <svg
        viewBox="0 0 1440 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-6 sm:h-8 md:h-[60px]"
        preserveAspectRatio="none"
      >
        <path
          d="M0 0h1440v20c-200 28-400 40-720 40S200 48 0 20V0z"
          fill={from}
        />
      </svg>
    </div>
  );
}
