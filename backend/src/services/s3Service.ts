import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

const BUCKET_NAME = process.env.S3_BUCKET_NAME || "kyru-scans";

export const s3Service = {
  /**
   * Upload a scan image to S3, keyed by restaurant + job so objects never
   * collide and can be located without a DB round-trip during debugging.
   */
  async uploadImage(
    imageBuffer: Buffer,
    mimeType: string,
    scanType: "invoice" | "inventory",
    restaurantId: string,
    jobId: string
  ): Promise<string> {
    const ext = mimeType.split("/")[1] || "png";
    const key = `${scanType}/${restaurantId}/${jobId}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: imageBuffer,
      ContentType: mimeType,
      Metadata: {
        "job-id": jobId,
        "restaurant-id": restaurantId,
        "scan-type": scanType,
      },
    });

    try {
      await s3Client.send(command);
      return `s3://${BUCKET_NAME}/${key}`;
    } catch (error) {
      throw new Error(`S3 upload failed: ${(error as Error).message}`);
    }
  },

  /** Fetch an image back out of S3 given the s3://bucket/key URL we stored. */
  async fetchImage(s3Url: string): Promise<Buffer> {
    const match = s3Url.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Invalid S3 URL: ${s3Url}`);
    const [, bucket, key] = match;

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });

    try {
      const response = await s3Client.send(command);
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      return new Promise((resolve, reject) => {
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    } catch (error) {
      throw new Error(`S3 fetch failed: ${(error as Error).message}`);
    }
  },
};
