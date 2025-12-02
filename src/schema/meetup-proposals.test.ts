import { describe, it, expect } from 'vitest';
import { meetupProposals, MeetupProposalStatus } from './meetup-proposals';
import { getTableColumns, getTableName } from 'drizzle-orm';

describe('meetup_proposals schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(meetupProposals)).toBe('meetup_proposals');
  });

  it('should have all required columns', () => {
    const columns = getTableColumns(meetupProposals);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('recovery_event_id');
    expect(columnNames).toContain('proposed_by');
    expect(columnNames).toContain('location');
    expect(columnNames).toContain('coordinates');
    expect(columnNames).toContain('datetime');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('should have id as UUID with default', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.id.dataType).toBe('string');
    expect(columns.id.notNull).toBe(true);
    expect(columns.id.primary).toBe(true);
  });

  it('should have recovery_event_id as UUID foreign key', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.recovery_event_id.dataType).toBe('string');
    expect(columns.recovery_event_id.notNull).toBe(true);
  });

  it('should have proposed_by as UUID foreign key', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.proposed_by.dataType).toBe('string');
    expect(columns.proposed_by.notNull).toBe(true);
  });

  it('should have location as text', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.location.dataType).toBe('string');
  });

  it('should have coordinates as json', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.coordinates.dataType).toBe('json');
  });

  it('should have datetime as timestamp', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.datetime.dataType).toBe('date');
  });

  it('should have status as enum with default', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.status.enumValues).toEqual(['proposed', 'accepted', 'rejected', 'completed']);
    expect(columns.status.notNull).toBe(true);
  });

  it('should have created_at as timestamp with default', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.created_at.dataType).toBe('date');
    expect(columns.created_at.notNull).toBe(true);
  });

  it('should have updated_at as timestamp with default', () => {
    const columns = getTableColumns(meetupProposals);
    expect(columns.updated_at.dataType).toBe('date');
    expect(columns.updated_at.notNull).toBe(true);
  });

  it('should export MeetupProposalStatus enum values', () => {
    expect(MeetupProposalStatus.PROPOSED).toBe('proposed');
    expect(MeetupProposalStatus.ACCEPTED).toBe('accepted');
    expect(MeetupProposalStatus.REJECTED).toBe('rejected');
    expect(MeetupProposalStatus.COMPLETED).toBe('completed');
  });
});
