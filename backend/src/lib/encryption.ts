import crypto from "crypto";

const ALGO = "aes-256-gcm" as const;
const IV_BYTES = 16;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (hex.length < 64) {
    console.warn(
      "[encryption] ENCRYPTION_KEY is missing or shorter than 32 bytes — " +
        "generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  // Pad or truncate to exactly 32 bytes (256 bits).
  return Buffer.from(hex.padEnd(64, "0").slice(0, 64), "hex");
}

/** AES-256-GCM encrypt. Returns `iv:tag:ciphertext` (all hex). */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

/** AES-256-GCM decrypt. Throws on tampered ciphertext (auth tag mismatch). */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  if (tag.length !== TAG_BYTES) throw new Error("Invalid auth tag length");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
