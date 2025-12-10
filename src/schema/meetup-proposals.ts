import { pgTable, text, timestamp, uuid, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { recoveryEvents } from './recovery-events';
import { profiles } from './profiles';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export const meetupProposalStatusEnum = pgEnum('meetup_proposal_status', [
  'proposed',
  'accepted',
  'rejected',
  'completed',
]);

export const MeetupProposalStatus = {
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  COMPLETED: 'completed',
} as const;

export const meetupProposals = pgTable('meetup_proposals', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .notNull(),
  recovery_event_id: uuid('recovery_event_id')
    .references(/* c8 ignore next */ () => recoveryEvents.id, { onDelete: 'cascade' })
    .notNull(),
  proposed_by: uuid('proposed_by')
    .references(/* c8 ignore next */ () => profiles.id, { onDelete: 'cascade' })
    .notNull(),
  location: text('location'),
  coordinates: jsonb('coordinates').$type<Coordinates>(),
  datetime: timestamp('datetime', { withTimezone: true }),
  status: meetupProposalStatusEnum('status').notNull().default('proposed'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type MeetupProposal = typeof meetupProposals.$inferSelect;
export type NewMeetupProposal = typeof meetupProposals.$inferInsert;
