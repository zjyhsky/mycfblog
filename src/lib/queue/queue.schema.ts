import { z } from "zod";
import { notificationEventSchema } from "@/features/notification/notification.schema";
import { EMAIL_UNSUBSCRIBE_TYPES, POST_STATUSES } from "@/lib/db/schema";

const emailMessageSchema = z.object({
  type: z.literal("EMAIL"),
  data: z.object({
    to: z.string(),
    subject: z.string(),
    html: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    idempotencyKey: z.string().optional(),
    unsubscribe: z
      .object({
        userId: z.string(),
        type: z.enum(EMAIL_UNSUBSCRIBE_TYPES),
      })
      .optional(),
  }),
});

const webhookMessageSchema = z.object({
  type: z.literal("WEBHOOK"),
  data: z.object({
    url: z.url(),
    secret: z.string(),
    event: notificationEventSchema,
  }),
});

const importExportMessageSchema = z.object({
  type: z.literal("IMPORT_EXPORT"),
  data: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("export"),
      taskId: z.string(),
      status: z.enum(POST_STATUSES).optional(),
      includeMedia: z.boolean(),
    }),
    z.object({
      kind: z.literal("import"),
      taskId: z.string(),
      mode: z.enum(["native", "markdown"]),
      restoreComments: z.boolean(),
    }),
  ]),
});

export const queueMessageSchema = z.discriminatedUnion("type", [
  emailMessageSchema,
  webhookMessageSchema,
  importExportMessageSchema,
]);

export type QueueMessage = z.infer<typeof queueMessageSchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type WebhookMessage = z.infer<typeof webhookMessageSchema>;
export type ImportExportMessage = z.infer<typeof importExportMessageSchema>;
