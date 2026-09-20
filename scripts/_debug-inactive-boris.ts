import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  const tenant = await p.tenant.findFirst({
    where: { slug: "beliandjolie" },
    select: { id: true },
  });
  if (!tenant) throw new Error("tenant not found");

  const user = await p.user.findFirst({
    where: { tenantId: tenant.id, email: "borischen91@gmail.com" },
    select: {
      id: true,
      email: true,
      createdAt: true,
      lastSeenAt: true,
      lastLoginAt: true,
      acceptsNewsletter: true,
      inactiveClientOptOut: true,
      status: true,
      role: true,
    },
  });
  console.log("USER:", user);
  if (!user) return;

  const job = await p.inactiveClientJob.findFirst({ where: { userId: user.id } });
  console.log("JOB:", job);

  const stages = await p.inactiveClientStage.findMany({
    where: { tenantId: tenant.id },
    orderBy: { stageIndex: "asc" },
    select: { stageIndex: true, delaySeconds: true, templateId: true },
  });
  console.log("STAGES:", stages);

  const lastOrder = await p.order.findFirst({
    where: { userId: user.id, tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  console.log("LAST ORDER:", lastOrder);

  const auto = await p.siteConfig.findFirst({
    where: { tenantId: tenant.id, key: "inactive_client_automation_enabled" },
  });
  console.log("AUTOMATION_ENABLED:", auto?.value);

  const now = Date.now();
  const ref = Math.max(
    user.createdAt.getTime(),
    user.lastSeenAt?.getTime() ?? 0,
    lastOrder?.createdAt?.getTime() ?? 0,
  );
  console.log("referenceAt =", new Date(ref).toISOString());
  console.log("elapsed seconds since ref =", Math.floor((now - ref) / 1000));

  // Recent EmailSend for this user, scenario INACTIVE_CLIENT
  const emails = await p.emailSend.findMany({
    where: { userId: user.id, scenarioKey: "INACTIVE_CLIENT" },
    orderBy: { sentAt: "desc" },
    take: 10,
    select: { id: true, sentAt: true, status: true, subject: true, metadata: true, errorMessage: true },
  });
  console.log("RECENT INACTIVE_CLIENT EMAILS:", emails);

  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
