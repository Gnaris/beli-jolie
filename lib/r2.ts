/**
 * Cloudflare R2 Storage Client
 *
 * S3-compatible client for uploading, downloading, and deleting files on R2.
 * Used by image-processor.ts and all image upload routes.
 *
 * Env vars required:
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT,
 *   R2_BUCKET_NAME, NEXT_PUBLIC_R2_URL
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

// ─────────────────────────────────────────────
// Client singleton
// ─────────────────────────────────────────────

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "R2 credentials missing. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env"
      );
    }

    _client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _client;
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME missing in .env");
  return bucket;
}

// ─────────────────────────────────────────────
// Public URL helper
// ─────────────────────────────────────────────

/**
 * Get the public URL for an R2 object key.
 * e.g. key "uploads/products/abc.webp" → "https://pub-xxx.r2.dev/uploads/products/abc.webp"
 */
export function getR2PublicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "";
  return `${base}/${key}`;
}

/**
 * Convert a DB path (e.g. "/uploads/products/abc.webp") to an R2 object key.
 * Strips leading slash: "uploads/products/abc.webp"
 */
export function r2KeyFromDbPath(dbPath: string): string {
  return dbPath.replace(/^\//, "");
}

/**
 * Convert a destDir like "public/uploads/products" to an R2 key prefix.
 * Strips "public/" prefix: "uploads/products"
 */
export function r2PrefixFromDestDir(destDir: string): string {
  return destDir.replace(/^public\//, "");
}

// ─────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────

export async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string = "image/webp",
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

// ─────────────────────────────────────────────
// Download
// ─────────────────────────────────────────────

export async function downloadFromR2(key: string): Promise<Buffer> {
  const res = await getClient().send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );

  if (!res.Body) throw new Error(`R2: empty body for key ${key}`);

  // Convert readable stream to Buffer
  const chunks: Uint8Array[] = [];
  const stream = res.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ─────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────

export async function deleteFromR2(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
}

export async function deleteMultipleFromR2(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  // S3 DeleteObjects supports max 1000 keys per request
  const BATCH_SIZE = 1000;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    await getClient().send(
      new DeleteObjectsCommand({
        Bucket: getBucket(),
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
  }
}

// ─────────────────────────────────────────────
// Head (check if object exists)
// ─────────────────────────────────────────────

export async function headObjectInR2(key: string): Promise<void> {
  await getClient().send(
    new HeadObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
}

// ─────────────────────────────────────────────
// Copy (used for staging → final move)
// ─────────────────────────────────────────────

export async function copyInR2(sourceKey: string, destKey: string): Promise<void> {
  const bucket = getBucket();
  await getClient().send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destKey,
    })
  );
}

/**
 * Move an object in R2 (copy + delete source).
 */
export async function moveInR2(sourceKey: string, destKey: string): Promise<void> {
  await copyInR2(sourceKey, destKey);
  await deleteFromR2(sourceKey);
}

// ─────────────────────────────────────────────
// List (used by clear-products script)
// ─────────────────────────────────────────────

export async function listR2Keys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await getClient().send(
      new ListObjectsV2Command({
        Bucket: getBucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    if (res.Contents) {
      for (const obj of res.Contents) {
        if (obj.Key) keys.push(obj.Key);
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}
