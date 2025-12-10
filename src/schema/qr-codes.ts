import { pgTable, text, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { profiles } from './profiles';

export const qrCodeStatusEnum = pgEnum('qr_code_status', ['generated', 'assigned', 'active', 'deactivated']);

export const QrCodeStatus = {
  GENERATED: 'generated',
  ASSIGNED: 'assigned',
  ACTIVE: 'active',
  DEACTIVATED: 'deactivated',
} as const;

export const qrCodes = pgTable('qr_codes', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .notNull(),
  short_code: text('short_code').notNull().unique(),
  status: qrCodeStatusEnum('status').notNull().default('generated'),
  assigned_to: uuid('assigned_to').references(/* c8 ignore next */ () => profiles.id, {
    onDelete: 'set null',
  }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type QrCode = typeof qrCodes.$inferSelect;
export type NewQrCode = typeof qrCodes.$inferInsert;
