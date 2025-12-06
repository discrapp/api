import { describe, it, expect } from 'vitest';
import { discPhotos } from './disc-photos';
import { getTableColumns, getTableName } from 'drizzle-orm';

describe('disc_photos schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(discPhotos)).toBe('disc_photos');
  });

  it('should have all required columns', () => {
    const columns = getTableColumns(discPhotos);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('disc_id');
    expect(columnNames).toContain('storage_path');
    expect(columnNames).toContain('photo_uuid');
    expect(columnNames).toContain('created_at');
  });

  it('should have id as UUID with default', () => {
    const columns = getTableColumns(discPhotos);
    expect(columns.id.dataType).toBe('string');
    expect(columns.id.notNull).toBe(true);
    expect(columns.id.primary).toBe(true);
  });

  it('should have disc_id as UUID foreign key', () => {
    const columns = getTableColumns(discPhotos);
    expect(columns.disc_id.dataType).toBe('string');
    expect(columns.disc_id.notNull).toBe(true);
  });

  it('should have storage_path as text and required', () => {
    const columns = getTableColumns(discPhotos);
    expect(columns.storage_path.dataType).toBe('string');
    expect(columns.storage_path.notNull).toBe(true);
  });

  it('should have photo_uuid as text and required', () => {
    const columns = getTableColumns(discPhotos);
    expect(columns.photo_uuid.dataType).toBe('string');
    expect(columns.photo_uuid.notNull).toBe(true);
  });

  it('should have created_at as timestamp with default', () => {
    const columns = getTableColumns(discPhotos);
    expect(columns.created_at.dataType).toBe('date');
    expect(columns.created_at.notNull).toBe(true);
  });
});
