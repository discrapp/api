import { pgTable, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { discs } from './discs';
import { profiles } from './profiles';

export const recoveryEventStatusEnum = pgEnum('recovery_event_status', [
  'found',
  'contact_made',
  'meetup_scheduled',
  'returned',
  'kept',
]);

export const RecoveryEventStatus = {
  FOUND: 'found',
  CONTACT_MADE: 'contact_made',
  MEETUP_SCHEDULED: 'meetup_scheduled',
  RETURNED: 'returned',
  KEPT: 'kept',
} as const;

export const recoveryEvents = pgTable('recovery_events', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .notNull(),
  disc_id: uuid('disc_id')
    .references(/* c8 ignore next */ () => discs.id, { onDelete: 'cascade' })
    .notNull(),
  finder_id: uuid('finder_id')
    .references(/* c8 ignore next */ () => profiles.id, { onDelete: 'cascade' })
    .notNull(),
  status: recoveryEventStatusEnum('status').notNull().default('found'),
  found_at: timestamp('found_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type RecoveryEvent = typeof recoveryEvents.$inferSelect;
export type NewRecoveryEvent = typeof recoveryEvents.$inferInsert;
