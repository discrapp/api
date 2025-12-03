import { describe, it, expect } from 'vitest';
import { recoveryEvents, RecoveryEventStatus } from './recovery-events';
import { getTableColumns, getTableName } from 'drizzle-orm';

describe('recovery_events schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(recoveryEvents)).toBe('recovery_events');
  });

  it('should have all required columns', () => {
    const columns = getTableColumns(recoveryEvents);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('disc_id');
    expect(columnNames).toContain('finder_id');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('found_at');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('should have id as UUID with default', () => {
    const columns = getTableColumns(recoveryEvents);
    expect(columns.id.dataType).toBe('string');
    expect(columns.id.notNull).toBe(true);
    expect(columns.id.primary).toBe(true);
  });

  it('should have disc_id as UUID foreign key', () => {
    const columns = getTableColumns(recoveryEvents);
    expect(columns.disc_id.dataType).toBe('string');
    expect(columns.disc_id.notNull).toBe(true);
  });

  it('should have finder_id as UUID foreign key', () => {
    const columns = getTableColumns(recoveryEvents);
    expect(columns.finder_id.dataType).toBe('string');
    expect(columns.finder_id.notNull).toBe(true);
  });

  it('should have status as enum with default', () => {
    const columns = getTableColumns(recoveryEvents);
    expect(columns.status.enumValues).toEqual(['found', 'contact_made', 'meetup_scheduled', 'returned', 'kept']);
    expect(columns.status.notNull).toBe(true);
  });

  it('should have found_at as timestamp', () => {
    const columns = getTableColumns(recoveryEvents);
    expect(columns.found_at.dataType).toBe('date');
  });

  it('should have created_at as timestamp with default', () => {
    const columns = getTableColumns(recoveryEvents);
    expect(columns.created_at.dataType).toBe('date');
    expect(columns.created_at.notNull).toBe(true);
  });

  it('should have updated_at as timestamp with default', () => {
    const columns = getTableColumns(recoveryEvents);
    expect(columns.updated_at.dataType).toBe('date');
    expect(columns.updated_at.notNull).toBe(true);
  });

  it('should export RecoveryEventStatus enum values', () => {
    expect(RecoveryEventStatus.FOUND).toBe('found');
    expect(RecoveryEventStatus.CONTACT_MADE).toBe('contact_made');
    expect(RecoveryEventStatus.MEETUP_SCHEDULED).toBe('meetup_scheduled');
    expect(RecoveryEventStatus.RETURNED).toBe('returned');
    expect(RecoveryEventStatus.KEPT).toBe('kept');
  });
});
