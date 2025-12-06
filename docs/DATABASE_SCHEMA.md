# Database Schema Documentation

## Overview

This document describes the database schema for the Discr application. The schema
is managed using Drizzle ORM with PostgreSQL and deployed to Supabase.

## Technology Stack

- **ORM:** Drizzle ORM (Node.js)
- **Database:** PostgreSQL 17 (via Supabase)
- **Migrations:** Drizzle Kit
- **Testing:** Vitest with 100% coverage (lines, branches, statements)

## Schema Architecture

### Design Principles

1. **Portability:** Using Drizzle ORM allows migration away from Supabase if
   needed
1. **Type Safety:** Full TypeScript types inferred from schema
1. **Test-Driven:** All schemas developed with TDD approach
1. **100% Coverage:** Lines, branches, and statements at 100% (functions N/A
   for schemas)

### Tables

#### profiles

User profile information extending Supabase auth.users.

```typescript
{
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  username: text NOT NULL
  email: text
  full_name: text
  avatar_url: text
  created_at: timestamp with time zone DEFAULT now() NOT NULL
  updated_at: timestamp with time zone DEFAULT now() NOT NULL
}
```

#### qr_codes

QR codes for disc tracking.

```typescript
{
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  short_code: text NOT NULL UNIQUE
  status: qr_code_status DEFAULT 'generated' NOT NULL
  assigned_to: uuid REFERENCES profiles(id) ON DELETE SET NULL
  created_at: timestamp with time zone DEFAULT now() NOT NULL
  updated_at: timestamp with time zone DEFAULT now() NOT NULL
}
```

**Status Enum:** `generated`, `assigned`, `active`, `deactivated`

#### discs

Disc golf discs owned by users.

```typescript
{
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  owner_id: uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL
  qr_code_id: uuid REFERENCES qr_codes(id) ON DELETE SET NULL
  name: text NOT NULL
  manufacturer: text
  plastic: text
  weight: integer
  flight_numbers: jsonb NOT NULL
  reward_amount: integer
  created_at: timestamp with time zone DEFAULT now() NOT NULL
  updated_at: timestamp with time zone DEFAULT now() NOT NULL
}
```

**Flight Numbers Structure:**

```typescript
{
  speed: number    // 1-14
  glide: number    // 1-7
  turn: number     // -5 to 1
  fade: number     // 0-5
  stability?: number // Optional
}
```

**Validation:** Flight numbers are validated using `validateFlightNumbers()` function.

#### disc_photos

Photos of discs for identification.

```typescript
{
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  disc_id: uuid REFERENCES discs(id) ON DELETE CASCADE NOT NULL
  storage_path: text NOT NULL
  photo_uuid: text NOT NULL  // UUID identifier for the photo file
  created_at: timestamp with time zone DEFAULT now() NOT NULL
}
```

#### recovery_events

Events when a disc is found.

```typescript
{
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  disc_id: uuid REFERENCES discs(id) ON DELETE CASCADE NOT NULL
  finder_id: uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL
  status: recovery_event_status DEFAULT 'found' NOT NULL
  found_at: timestamp with time zone
  created_at: timestamp with time zone DEFAULT now() NOT NULL
  updated_at: timestamp with time zone DEFAULT now() NOT NULL
}
```

**Status Enum:** `found`, `contact_made`, `meetup_scheduled`, `returned`, `kept`

#### meetup_proposals

Proposed meetups for returning discs.

```typescript
{
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  recovery_event_id: uuid REFERENCES recovery_events(id) ON DELETE CASCADE NOT NULL
  proposed_by: uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL
  location: text
  coordinates: jsonb
  datetime: timestamp with time zone
  status: meetup_proposal_status DEFAULT 'proposed' NOT NULL
  created_at: timestamp with time zone DEFAULT now() NOT NULL
  updated_at: timestamp with time zone DEFAULT now() NOT NULL
}
```

**Status Enum:** `proposed`, `accepted`, `rejected`, `completed`

**Coordinates Structure:**

```typescript
{
  latitude: number;
  longitude: number;
}
```

## Development Workflow

### Local Setup

```bash
# Install dependencies
npm install

# Generate migrations (after schema changes)
npm run db:generate

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Creating New Tables

1. **Write Tests First (TDD):**

   ```typescript
   // src/schema/my-table.test.ts
   import { describe, it, expect } from 'vitest';
   import { myTable } from './my-table';
   import { getTableColumns, getTableName } from 'drizzle-orm';

   describe('my_table schema', () => {
     it('should have the correct table name', () => {
       expect(getTableName(myTable)).toBe('my_table');
     });
     // Add tests for all columns...
   });
   ```

1. **Implement Schema:**

   ```typescript
   // src/schema/my-table.ts
   import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
   import { sql } from 'drizzle-orm';

   export const myTable = pgTable('my_table', {
     id: uuid('id')
       .primaryKey()
       .default(sql`gen_random_uuid()`)
       .notNull(),
     // Add columns...
     created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
   });

   export type MyTable = typeof myTable.$inferSelect;
   export type NewMyTable = typeof myTable.$inferInsert;
   ```

1. **Export from Index:**

   ```typescript
   // src/schema/index.ts
   export * from './my-table';
   ```

1. **Run Tests:**

   ```bash
   npm test
   npm run test:coverage  # Ensure 100% coverage
   ```

1. **Generate Migration:**

   ```bash
   npm run db:generate
   ```

### Migration Strategy

- **Local Development:** Migrations applied to local Supabase instance
- **Production:** Migrations applied via Supabase CLI or dashboard
- **Never modify existing migrations** after they're merged to main

## Testing Strategy

### Coverage Requirements

- **Lines:** 100%
- **Branches:** 100%
- **Statements:** 100%
- **Functions:** Not enforced for schema files (Drizzle builder functions)

Function coverage WILL be enforced at 100% for:

- API handlers
- Business logic
- Services
- Utilities
- Any non-schema code

### Test Organization

```text
src/schema/
├── profiles.ts           # Schema definition
├── profiles.test.ts      # Schema structure tests
├── qr-codes.ts
├── qr-codes.test.ts
└── ...
```

## Row Level Security (RLS)

RLS policies will be implemented in Supabase migrations (future work).

Basic policies to implement:

- Users can read/update their own profiles
- Users can CRUD their own discs
- Users can read QR codes assigned to their discs
- Users can create recovery events for found discs
- Users can view recovery events for their discs
- Users can create/view meetup proposals related to their events

## Future Enhancements

1. Add indexes for frequently queried columns
1. Implement RLS policies
1. Add database triggers for updated_at timestamps
1. Add soft delete support
1. Add audit logging

## References

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Supabase Documentation](https://supabase.com/docs)
