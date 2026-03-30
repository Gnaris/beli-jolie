/**
 * Quick R2 connectivity test.
 * Usage: npx tsx scripts/test-r2.ts
 */

import "dotenv/config";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

async function main() {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    console.error("Missing R2 env vars. Check .env");
    process.exit(1);
  }

  console.log(`Bucket: ${bucket}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Public URL: ${publicUrl}`);
  console.log("");

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  // 1. Upload
  console.log("1. Upload test...");
  const testData = Buffer.from("Hello R2! " + new Date().toISOString());
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: "test/hello.txt",
    Body: testData,
    ContentType: "text/plain",
  }));
  console.log("   Upload OK");

  // 2. Download
  console.log("2. Download test...");
  const res = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: "test/hello.txt",
  }));
  const chunks: Uint8Array[] = [];
  const stream = res.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const downloaded = Buffer.concat(chunks).toString();
  console.log(`   Download OK: "${downloaded}"`);

  // 3. Public URL check
  if (publicUrl) {
    console.log("3. Public URL test...");
    const publicRes = await fetch(`${publicUrl}/test/hello.txt`);
    if (publicRes.ok) {
      console.log(`   Public URL OK: ${publicUrl}/test/hello.txt`);
    } else {
      console.log(`   Public URL FAILED (${publicRes.status}) — check R2.dev subdomain is enabled`);
    }
  }

  // 4. Delete
  console.log("4. Delete test...");
  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: "test/hello.txt",
  }));
  console.log("   Delete OK");

  console.log("\nR2 is working correctly!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
