export function parseUserAgent(ua: string | null | undefined): string {
  const raw = (ua ?? "").trim();
  if (!raw || raw === "inconnu") return "inconnu";

  const os =
    /Windows NT/i.test(raw) ? "Windows"
    : /iPhone|iPad|iPod/i.test(raw) ? (raw.includes("iPhone") ? "iPhone" : raw.includes("iPad") ? "iPad" : "iPod")
    : /Android/i.test(raw) ? "Android"
    : /Mac OS X/i.test(raw) ? "macOS"
    : /Linux/i.test(raw) ? "Linux"
    : null;

  const browser =
    /Edg\//i.test(raw) ? "Edge"
    : /OPR\/|Opera/i.test(raw) ? "Opera"
    : /Firefox\//i.test(raw) ? "Firefox"
    : /Chrome\//i.test(raw) && !/Edg\//i.test(raw) ? "Chrome"
    : /Safari\//i.test(raw) && !/Chrome\//i.test(raw) ? "Safari"
    : null;

  if (browser && os) return `${browser} sur ${os}`;
  return raw.slice(0, 100);
}
