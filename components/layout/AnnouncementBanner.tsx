"use client";

interface AnnouncementBannerProps {
  messages: string[];
  bgColor: string;
  textColor: string;
}

export default function AnnouncementBanner({ messages, bgColor, textColor }: AnnouncementBannerProps) {
  if (messages.length === 0) return null;

  // Duplicate messages to create seamless loop
  const repeated = [...messages, ...messages];

  return (
    <div
      className="w-full overflow-hidden py-2 text-sm font-body"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <div className="animate-marquee flex whitespace-nowrap">
        {repeated.map((msg, i) => (
          <span key={i} className="mx-8 inline-block">
            {msg}
          </span>
        ))}
      </div>
    </div>
  );
}
