import { z } from "zod";

export const notificationCategorySchema = z.enum([
  "TRADING",
  "SETUPS",
  "AI",
  "RISK",
  "NEWS",
  "SYSTEM",
]);
export const notificationPrioritySchema = z.enum([
  "INFO",
  "IMPORTANT",
  "HIGH",
  "CRITICAL",
]);
export const notificationStatusSchema = z.enum([
  "ACTIVE",
  "RESOLVED",
  "INVALIDATED",
  "EXPIRED",
]);
export const notificationActionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  href: z.string().max(500).optional(),
  intent: z.enum(["NAVIGATE", "ACKNOWLEDGE", "COMMAND"]).default("NAVIGATE"),
  command: z.string().max(100).optional(),
  confirm: z.boolean().default(false),
});
export const notificationSchema = z.object({
  id: z.string().uuid(),
  event_key: z.string(),
  category: notificationCategorySchema,
  priority: notificationPrioritySchema,
  symbol: z.string().nullable(),
  timeframe: z.string().nullable(),
  setup_id: z.string().nullable(),
  trade_id: z.string().nullable(),
  agent_source: z.string(),
  title: z.string(),
  message: z.string(),
  evidence: z.array(z.record(z.unknown())).default([]),
  lifecycle_state: z.string().nullable(),
  recommended_action: z.string().nullable(),
  actions: z.array(notificationActionSchema).default([]),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  read_at: z.string().datetime({ offset: true }).nullable(),
  acknowledged_at: z.string().datetime({ offset: true }).nullable(),
  voice_spoken_at: z.string().datetime({ offset: true }).nullable(),
  push_sent_at: z.string().datetime({ offset: true }).nullable(),
  status: notificationStatusSchema,
});
export type OnkarNotification = z.infer<typeof notificationSchema>;
export type NotificationAction = z.infer<typeof notificationActionSchema>;

export const notificationPreferencesSchema = z.object({
  channels: z.record(z.record(z.boolean())).default({}),
  category_overrides: z.record(z.record(z.boolean())).default({}),
  voice_enabled: z.boolean().default(true),
  voice_volume: z.number().min(0).max(1).default(0.8),
  push_enabled: z.boolean().default(false),
  sound_enabled: z.boolean().default(true),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
