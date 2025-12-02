import { describe, it, expect } from 'vitest';
import { qrCodes, QrCodeStatus } from './qr-codes';
import { getTableColumns, getTableName } from 'drizzle-orm';

describe('qr_codes schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(qrCodes)).toBe('qr_codes');
  });

  it('should have all required columns', () => {
    const columns = getTableColumns(qrCodes);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('short_code');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('assigned_to');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('should have id as UUID with default', () => {
    const columns = getTableColumns(qrCodes);
    expect(columns.id.dataType).toBe('string');
    expect(columns.id.notNull).toBe(true);
    expect(columns.id.primary).toBe(true);
  });

  it('should have short_code as text and required', () => {
    const columns = getTableColumns(qrCodes);
    expect(columns.short_code.dataType).toBe('string');
    expect(columns.short_code.notNull).toBe(true);
  });

  it('should have status as enum with default', () => {
    const columns = getTableColumns(qrCodes);
    expect(columns.status.enumValues).toEqual(['generated', 'assigned', 'active', 'deactivated']);
    expect(columns.status.notNull).toBe(true);
  });

  it('should have assigned_to as UUID foreign key', () => {
    const columns = getTableColumns(qrCodes);
    expect(columns.assigned_to.dataType).toBe('string');
  });

  it('should have created_at as timestamp with default', () => {
    const columns = getTableColumns(qrCodes);
    expect(columns.created_at.dataType).toBe('date');
    expect(columns.created_at.notNull).toBe(true);
  });

  it('should have updated_at as timestamp with default', () => {
    const columns = getTableColumns(qrCodes);
    expect(columns.updated_at.dataType).toBe('date');
    expect(columns.updated_at.notNull).toBe(true);
  });

  it('should export QrCodeStatus enum values', () => {
    expect(QrCodeStatus.GENERATED).toBe('generated');
    expect(QrCodeStatus.ASSIGNED).toBe('assigned');
    expect(QrCodeStatus.ACTIVE).toBe('active');
    expect(QrCodeStatus.DEACTIVATED).toBe('deactivated');
  });
});
