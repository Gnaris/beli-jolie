/**
 * Tests for lib/storage.ts — local filesystem image storage.
 *
 * Each test uses a temporary directory rooted under public/ to exercise the
 * real fs codepath (no mocks). The temp folder is cleaned up after each test.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  uploadFile,
  readFile,
  deleteFile,
  deleteFiles,
  copyFile,
  moveFile,
  listFiles,
  assertFileExists,
  getPublicUrl,
  keyFromDbPath,
  keyPrefixFromDestDir,
} from "@/lib/storage";

const TEST_PREFIX = "uploads/__test__";
const TEST_DIR_ABS = path.resolve(process.cwd(), "public", TEST_PREFIX);

beforeEach(async () => {
  await fs.rm(TEST_DIR_ABS, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR_ABS, { recursive: true, force: true });
});

describe("lib/storage — pure helpers", () => {
  it("getPublicUrl returns a leading-slash URL", () => {
    expect(getPublicUrl("uploads/products/abc.webp")).toBe("/uploads/products/abc.webp");
  });

  it("getPublicUrl strips redundant leading slashes", () => {
    expect(getPublicUrl("/uploads/products/abc.webp")).toBe("/uploads/products/abc.webp");
    expect(getPublicUrl("///uploads/x.webp")).toBe("/uploads/x.webp");
  });

  it("keyFromDbPath strips the leading slash", () => {
    expect(keyFromDbPath("/uploads/products/abc.webp")).toBe("uploads/products/abc.webp");
  });

  it("keyPrefixFromDestDir strips the leading 'public/'", () => {
    expect(keyPrefixFromDestDir("public/uploads/products")).toBe("uploads/products");
    expect(keyPrefixFromDestDir("uploads/products")).toBe("uploads/products");
  });
});

describe("lib/storage — write / read", () => {
  it("uploadFile writes a file under public/ and creates parent dirs", async () => {
    const key = `${TEST_PREFIX}/sub/nested/file.bin`;
    await uploadFile(key, Buffer.from("hello"));
    const onDisk = await fs.readFile(path.join(TEST_DIR_ABS, "sub/nested/file.bin"));
    expect(onDisk.toString()).toBe("hello");
  });

  it("readFile returns the bytes that were written", async () => {
    const key = `${TEST_PREFIX}/round-trip.bin`;
    await uploadFile(key, Buffer.from([1, 2, 3, 4, 5]));
    const buf = await readFile(key);
    expect(Array.from(buf)).toEqual([1, 2, 3, 4, 5]);
  });

  it("uploadFile overwrites an existing file", async () => {
    const key = `${TEST_PREFIX}/overwrite.bin`;
    await uploadFile(key, Buffer.from("first"));
    await uploadFile(key, Buffer.from("second"));
    const buf = await readFile(key);
    expect(buf.toString()).toBe("second");
  });

  it("readFile rejects when the file is missing", async () => {
    await expect(readFile(`${TEST_PREFIX}/missing.bin`)).rejects.toThrow();
  });
});

describe("lib/storage — delete", () => {
  it("deleteFile removes an existing file", async () => {
    const key = `${TEST_PREFIX}/to-delete.bin`;
    await uploadFile(key, Buffer.from("x"));
    await deleteFile(key);
    await expect(readFile(key)).rejects.toThrow();
  });

  it("deleteFile is silent when the file does not exist (idempotent)", async () => {
    await expect(deleteFile(`${TEST_PREFIX}/never-existed.bin`)).resolves.toBeUndefined();
  });

  it("deleteFiles removes a batch and ignores missing entries", async () => {
    const a = `${TEST_PREFIX}/a.bin`;
    const b = `${TEST_PREFIX}/b.bin`;
    const c = `${TEST_PREFIX}/c.bin`;
    await uploadFile(a, Buffer.from("a"));
    await uploadFile(b, Buffer.from("b"));
    // c is intentionally never created
    await deleteFiles([a, b, c]);
    await expect(readFile(a)).rejects.toThrow();
    await expect(readFile(b)).rejects.toThrow();
  });

  it("deleteFiles is a no-op when the list is empty", async () => {
    await expect(deleteFiles([])).resolves.toBeUndefined();
  });
});

describe("lib/storage — copy / move", () => {
  it("copyFile duplicates content and leaves the source intact", async () => {
    const src = `${TEST_PREFIX}/src.bin`;
    const dst = `${TEST_PREFIX}/dst.bin`;
    await uploadFile(src, Buffer.from("payload"));
    await copyFile(src, dst);
    expect((await readFile(src)).toString()).toBe("payload");
    expect((await readFile(dst)).toString()).toBe("payload");
  });

  it("moveFile relocates content and removes the source", async () => {
    const src = `${TEST_PREFIX}/move-src.bin`;
    const dst = `${TEST_PREFIX}/sub/move-dst.bin`;
    await uploadFile(src, Buffer.from("payload"));
    await moveFile(src, dst);
    await expect(readFile(src)).rejects.toThrow();
    expect((await readFile(dst)).toString()).toBe("payload");
  });
});

describe("lib/storage — exists / list", () => {
  it("assertFileExists resolves for a present file and rejects for a missing one", async () => {
    const key = `${TEST_PREFIX}/present.bin`;
    await uploadFile(key, Buffer.from("ok"));
    await expect(assertFileExists(key)).resolves.toBeUndefined();
    await expect(assertFileExists(`${TEST_PREFIX}/absent.bin`)).rejects.toThrow();
  });

  it("listFiles returns every file under the prefix (recursively, sorted by key)", async () => {
    await uploadFile(`${TEST_PREFIX}/a.bin`, Buffer.from("1"));
    await uploadFile(`${TEST_PREFIX}/sub/b.bin`, Buffer.from("2"));
    await uploadFile(`${TEST_PREFIX}/sub/deep/c.bin`, Buffer.from("3"));

    const keys = (await listFiles(TEST_PREFIX)).sort();
    expect(keys).toEqual([
      `${TEST_PREFIX}/a.bin`,
      `${TEST_PREFIX}/sub/b.bin`,
      `${TEST_PREFIX}/sub/deep/c.bin`,
    ]);
  });

  it("listFiles returns [] for a missing prefix", async () => {
    expect(await listFiles(`${TEST_PREFIX}/never-created`)).toEqual([]);
  });
});

describe("lib/storage — security", () => {
  it("uploadFile refuses keys that escape the storage root", async () => {
    await expect(uploadFile("../escape.bin", Buffer.from("x"))).rejects.toThrow(
      /storage root/,
    );
  });

  it("readFile refuses keys that escape the storage root", async () => {
    await expect(readFile("../../etc/passwd")).rejects.toThrow(/storage root/);
  });
});
