import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the route
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("sharp", () => {
  const mockSharp = () => ({
    rotate: () => mockSharp(),
    resize: () => mockSharp(),
    webp: () => mockSharp(),
    toBuffer: () => Promise.resolve(Buffer.from("fake-webp")),
  });
  return { default: mockSharp };
});

vi.mock("@/lib/storage", () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { getServerSession } from "next-auth";
import { POST } from "@/app/api/client/claims/upload/route";
import { uploadFile } from "@/lib/storage";

function createMockFile(name: string, size: number, type: string): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

function createRequest(files: File[]): Request {
  const formData = new FormData();
  for (const file of files) {
    formData.append("images", file);
  }
  return new Request("http://localhost/api/client/claims/upload", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/client/claims/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const req = createRequest([createMockFile("test.jpg", 100, "image/jpeg")]);
    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBeDefined();
  });

  it("rejects non-CLIENT users", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "1", role: "ADMIN", status: "APPROVED" },
    } as any);

    const req = createRequest([createMockFile("test.jpg", 100, "image/jpeg")]);
    const res = await POST(req as any);

    expect(res.status).toBe(401);
  });

  it("rejects empty file list", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "1", role: "CLIENT", status: "APPROVED" },
    } as any);

    const formData = new FormData();
    const req = new Request("http://localhost/api/client/claims/upload", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });

  it("rejects unsupported file types", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "1", role: "CLIENT", status: "APPROVED" },
    } as any);

    const req = createRequest([createMockFile("test.pdf", 100, "application/pdf")]);
    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Format non supporté");
  });

  it("rejects files exceeding 5 Mo", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "1", role: "CLIENT", status: "APPROVED" },
    } as any);

    const req = createRequest([createMockFile("big.jpg", 6 * 1024 * 1024, "image/jpeg")]);
    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("5 Mo");
  });

  it("rejects more than 5 files", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "1", role: "CLIENT", status: "APPROVED" },
    } as any);

    const files = Array.from({ length: 6 }, (_, i) =>
      createMockFile(`img${i}.jpg`, 100, "image/jpeg")
    );
    const req = createRequest(files);
    const res = await POST(req as any);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Maximum 5");
  });

  it("uploads valid images and returns paths", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "1", role: "CLIENT", status: "APPROVED" },
    } as any);

    const files = [
      createMockFile("photo1.jpg", 100, "image/jpeg"),
      createMockFile("photo2.png", 200, "image/png"),
    ];
    const req = createRequest(files);
    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.paths).toHaveLength(2);
    expect(body.paths[0]).toMatch(/^\/uploads\/claims\/claim-.*\.webp$/);
    expect(body.paths[1]).toMatch(/^\/uploads\/claims\/claim-.*\.webp$/);
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });
});
