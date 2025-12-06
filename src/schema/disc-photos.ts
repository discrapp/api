import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { discs } from './discs';

export const discPhotos = pgTable('disc_photos', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .notNull(),
  disc_id: uuid('disc_id')
    .references(() => discs.id, { onDelete: 'cascade' })
    .notNull(),
  storage_path: text('storage_path').notNull(),
  photo_uuid: text('photo_uuid').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type DiscPhoto = typeof discPhotos.$inferSelect;
export type NewDiscPhoto = typeof discPhotos.$inferInsert;
