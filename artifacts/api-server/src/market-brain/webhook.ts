import { createHash, timingSafeEqual } from "node:crypto";
import { webhookSchema } from "@workspace/api-zod";
export const secretHash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
export function verifyWebhook(input: unknown, hash: string, now: number) {
  const parsed = webhookSchema.safeParse(input);
  if (!parsed.success || !/^[a-f0-9]{64}$/.test(hash)) return null;
  if (
    !timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(secretHash(parsed.data.secret), "hex"),
    )
  )
    return null;
  if (Math.abs(now - Date.parse(parsed.data.timestamp)) > 5 * 60_000)
    return null;
  const { secret: _secret, ...event } = parsed.data;
  return event;
}
