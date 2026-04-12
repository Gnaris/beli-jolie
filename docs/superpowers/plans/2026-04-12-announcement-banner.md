# Announcement Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable announcement banner that displays scrolling messages at the top of the public site, managed from admin settings.

**Architecture:** Single SiteConfig JSON key (`announcement_banner`) stores messages + colors. Server action for CRUD. Public banner component with CSS marquee animation rendered above the header in root layout. Admin config component in the General settings tab.

**Tech Stack:** Next.js 16, Prisma SiteConfig, Tailwind v4, CSS keyframes

---

### Task 1: Server Action — `updateAnnouncementBanner()`

**Files:**
- Modify: `app/actions/admin/site-config.ts` (append at end)

- [ ] **Step 1: Add the server action**

Add this at the end of `app/actions/admin/site-config.ts`:

```typescript
// ─── Announcement Banner ────────────────────────────────────────────────────

export interface AnnouncementBannerData {
  messages: string[];
  bgColor: string;
  textColor: string;
}

export async function updateAnnouncementBanner(
  data: AnnouncementBannerData
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const filtered = data.messages.map(m => m.trim()).filter(Boolean);
    const payload: AnnouncementBannerData = {
      messages: filtered,
      bgColor: data.bgColor || "#1a1a1a",
      textColor: data.textColor || "#ffffff",
    };
    if (filtered.length === 0) {
      await prisma.siteConfig.deleteMany({ where: { key: "announcement_banner" } });
    } else {
      await prisma.siteConfig.upsert({
        where: { key: "announcement_banner" },
        update: { value: JSON.stringify(payload) },
        create: { key: "announcement_banner", value: JSON.stringify(payload) },
      });
    }
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in `site-config.ts`

- [ ] **Step 3: Commit**

```bash
git add app/actions/admin/site-config.ts
git commit -m "feat: add updateAnnouncementBanner server action"
```

---

### Task 2: Public Banner Component — `AnnouncementBanner.tsx`

**Files:**
- Create: `components/layout/AnnouncementBanner.tsx`

- [ ] **Step 1: Create the component**

Create `components/layout/AnnouncementBanner.tsx`:

```tsx
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
```

- [ ] **Step 2: Add the marquee keyframes to globals.css**

In `app/globals.css`, inside the `@theme inline {}` block (or after it), add the marquee animation utility. Find the existing `@theme inline {}` block and add after it:

```css
@keyframes marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

@utility animate-marquee {
  animation: marquee 20s linear infinite;
}
```

Note: The `20s` duration gives a comfortable reading speed. With the duplicated messages array, translating -50% creates a seamless loop.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add components/layout/AnnouncementBanner.tsx app/globals.css
git commit -m "feat: add AnnouncementBanner component with CSS marquee"
```

---

### Task 3: Render Banner in Root Layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Import and fetch announcement data**

In `app/layout.tsx`, add the import at the top with the other imports:

```typescript
import AnnouncementBanner from "@/components/layout/AnnouncementBanner";
```

Update the import line for cached-data to include `getCachedSiteConfig`:

```typescript
import { getCachedShopName, getCachedBusinessHours, getCachedSiteConfig } from "@/lib/cached-data";
```

- [ ] **Step 2: Fetch the config in the layout function**

In the `RootLayout` function, add `getCachedSiteConfig("announcement_banner")` to the existing `Promise.all`:

```typescript
const [locale, messages, shopName, businessHours, session, announcementRow] = await Promise.all([
  getLocale(),
  getMessages(),
  getCachedShopName(),
  getCachedBusinessHours(),
  getServerSession(authOptions),
  getCachedSiteConfig("announcement_banner"),
]);

// Parse announcement banner
let announcement: { messages: string[]; bgColor: string; textColor: string } | null = null;
if (announcementRow?.value) {
  try {
    const parsed = JSON.parse(announcementRow.value);
    if (parsed.messages?.length > 0) {
      announcement = parsed;
    }
  } catch { /* ignore invalid JSON */ }
}
```

- [ ] **Step 3: Render the banner before GuestBanner**

Inside the `<body>` tag, add the banner right after the `<script>` JSON-LD block and before the `<NextIntlClientProvider>`:

```tsx
{announcement && (
  <AnnouncementBanner
    messages={announcement.messages}
    bgColor={announcement.bgColor}
    textColor={announcement.textColor}
  />
)}
<NextIntlClientProvider messages={messages}>
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: render announcement banner in root layout"
```

---

### Task 4: Admin Config Component — `AnnouncementBannerConfig.tsx`

**Files:**
- Create: `components/admin/settings/AnnouncementBannerConfig.tsx`

- [ ] **Step 1: Create the admin config component**

Create `components/admin/settings/AnnouncementBannerConfig.tsx`:

```tsx
"use client";

import { useState } from "react";
import { updateAnnouncementBanner } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import AnnouncementBanner from "@/components/layout/AnnouncementBanner";

interface AnnouncementBannerConfigProps {
  initialMessages: string[];
  initialBgColor: string;
  initialTextColor: string;
}

export default function AnnouncementBannerConfig({
  initialMessages,
  initialBgColor,
  initialTextColor,
}: AnnouncementBannerConfigProps) {
  const [messages, setMessages] = useState<string[]>(
    initialMessages.length > 0 ? initialMessages : [""]
  );
  const [bgColor, setBgColor] = useState(initialBgColor);
  const [textColor, setTextColor] = useState(initialTextColor);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function addMessage() {
    setMessages((prev) => [...prev, ""]);
  }

  function removeMessage(index: number) {
    setMessages((prev) => prev.filter((_, i) => i !== index));
  }

  function updateMessage(index: number, value: string) {
    setMessages((prev) => prev.map((m, i) => (i === index ? value : m)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateAnnouncementBanner({
        messages,
        bgColor,
        textColor,
      });
      if (result.success) {
        toast({ type: "success", title: "Succes", message: "Bandeau mis a jour." });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de la sauvegarde." });
    } finally {
      setSaving(false);
    }
  }

  const activeMessages = messages.filter((m) => m.trim().length > 0);

  return (
    <div className="space-y-5">
      {/* Messages list */}
      <div className="space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={msg}
              onChange={(e) => updateMessage(i, e.target.value)}
              placeholder={`Message ${i + 1}`}
              className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm font-body text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {messages.length > 1 && (
              <button
                type="button"
                onClick={() => removeMessage(i)}
                className="p-2 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/5"
                title="Supprimer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add button */}
      <button
        type="button"
        onClick={addMessage}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition-colors font-body"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Ajouter une annonce
      </button>

      {/* Color pickers */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-body text-text-secondary">Fond :</label>
          <input
            type="color"
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
            className="w-8 h-8 rounded border border-border cursor-pointer"
          />
          <span className="text-xs font-mono text-text-secondary">{bgColor}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-body text-text-secondary">Texte :</label>
          <input
            type="color"
            value={textColor}
            onChange={(e) => setTextColor(e.target.value)}
            className="w-8 h-8 rounded border border-border cursor-pointer"
          />
          <span className="text-xs font-mono text-text-secondary">{textColor}</span>
        </div>
      </div>

      {/* Live preview */}
      {activeMessages.length > 0 && (
        <div>
          <p className="text-xs font-body text-text-secondary mb-2">Apercu :</p>
          <div className="rounded-lg overflow-hidden border border-border">
            <AnnouncementBanner
              messages={activeMessages}
              bgColor={bgColor}
              textColor={textColor}
            />
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-bg-dark text-text-inverse hover:bg-primary-hover transition-colors disabled:opacity-50 font-body"
      >
        {saving && (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        Enregistrer
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add components/admin/settings/AnnouncementBannerConfig.tsx
git commit -m "feat: add AnnouncementBannerConfig admin component"
```

---

### Task 5: Wire Admin Config into Settings Page

**Files:**
- Modify: `app/(admin)/admin/parametres/page.tsx`

- [ ] **Step 1: Add import**

Add this import at the top of `app/(admin)/admin/parametres/page.tsx` with the other imports:

```typescript
import AnnouncementBannerConfig from "@/components/admin/settings/AnnouncementBannerConfig";
```

- [ ] **Step 2: Fetch announcement data in GeneralTab**

In the `GeneralTab()` function, update the `Promise.all` to also fetch the announcement config:

```typescript
async function GeneralTab() {
  const [minConfig, bannerImageConfig, announcementConfig] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } }),
    prisma.siteConfig.findUnique({ where: { key: "banner_image" } }),
    prisma.siteConfig.findUnique({ where: { key: "announcement_banner" } }),
  ]);

  const currentMinHT = minConfig ? parseFloat(minConfig.value) : 0;

  let announcementMessages: string[] = [];
  let announcementBgColor = "#1a1a1a";
  let announcementTextColor = "#ffffff";
  if (announcementConfig?.value) {
    try {
      const parsed = JSON.parse(announcementConfig.value);
      announcementMessages = parsed.messages || [];
      announcementBgColor = parsed.bgColor || "#1a1a1a";
      announcementTextColor = parsed.textColor || "#ffffff";
    } catch { /* ignore */ }
  }
```

- [ ] **Step 3: Add the announcement section to the JSX**

In the `GeneralTab` return, add a new card section **before** the existing "Banniere d'accueil" section:

```tsx
return (
  <div className="space-y-6">
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
      <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Bandeau d&apos;annonces</h3>
      <p className="text-sm text-text-secondary font-body mb-4">Messages defilants en haut du site.</p>
      <AnnouncementBannerConfig
        initialMessages={announcementMessages}
        initialBgColor={announcementBgColor}
        initialTextColor={announcementTextColor}
      />
    </div>

    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
      <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Banniere d&apos;accueil</h3>
      {/* ... rest of existing banner image section ... */}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/(admin)/admin/parametres/page.tsx
git commit -m "feat: wire announcement banner config into admin settings"
```

---

### Task 6: Manual Testing

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test admin settings**

1. Navigate to `/admin/parametres?tab=general`
2. Verify the "Bandeau d'annonces" section appears at the top
3. Add 2-3 messages, pick colors
4. Verify the live preview shows the marquee animation
5. Click "Enregistrer" — verify success toast

- [ ] **Step 3: Test public banner**

1. Navigate to the homepage `/`
2. Verify the announcement banner appears at the very top, above the header
3. Verify messages scroll from right to left continuously
4. Verify the colors match what was configured

- [ ] **Step 4: Test empty state**

1. Go back to admin, remove all messages
2. Click "Enregistrer"
3. Go to homepage — verify the banner is NOT shown

- [ ] **Step 5: Final commit**

If any adjustments were needed during testing, commit them:

```bash
git add -A
git commit -m "fix: announcement banner adjustments from testing"
```
