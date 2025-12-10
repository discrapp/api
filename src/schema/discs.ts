import { pgTable, text, timestamp, uuid, integer, jsonb, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { profiles } from './profiles';
import { qrCodes } from './qr-codes';

export interface FlightNumbers {
  speed: number;
  glide: number;
  turn: number;
  fade: number;
  stability?: number;
}

export function validateFlightNumbers(flightNumbers: FlightNumbers): void {
  if (flightNumbers.speed < 1 || flightNumbers.speed > 14) {
    throw new Error('Speed must be between 1 and 14');
  }
  if (flightNumbers.glide < 1 || flightNumbers.glide > 7) {
    throw new Error('Glide must be between 1 and 7');
  }
  if (flightNumbers.turn < -5 || flightNumbers.turn > 1) {
    throw new Error('Turn must be between -5 and 1');
  }
  if (flightNumbers.fade < 0 || flightNumbers.fade > 5) {
    throw new Error('Fade must be between 0 and 5');
  }
}

export const discs = pgTable('discs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .notNull(),
  owner_id: uuid('owner_id')
    .references(/* c8 ignore next */ () => profiles.id, { onDelete: 'cascade' })
    .notNull(),
  qr_code_id: uuid('qr_code_id').references(/* c8 ignore next */ () => qrCodes.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  manufacturer: text('manufacturer'),
  mold: text('mold'),
  plastic: text('plastic'),
  weight: integer('weight'),
  color: text('color'),
  flight_numbers: jsonb('flight_numbers').$type<FlightNumbers>().notNull(),
  reward_amount: numeric('reward_amount', { precision: 10, scale: 2 }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Disc = typeof discs.$inferSelect;
export type NewDisc = typeof discs.$inferInsert;
