import { profiles } from './profiles';
import { getTableColumns, getTableName } from 'drizzle-orm';

describe('profiles schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(profiles)).toBe('profiles');
  });

  it('should have all required columns', () => {
    const columns = getTableColumns(profiles);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('username');
    expect(columnNames).toContain('email');
    expect(columnNames).toContain('full_name');
    expect(columnNames).toContain('avatar_url');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('should have id as UUID with default', () => {
    const columns = getTableColumns(profiles);
    expect(columns.id.dataType).toBe('string');
    expect(columns.id.notNull).toBe(true);
    expect(columns.id.primary).toBe(true);
  });

  it('should have username as text and required', () => {
    const columns = getTableColumns(profiles);
    expect(columns.username.dataType).toBe('string');
    expect(columns.username.notNull).toBe(true);
  });

  it('should have email as text', () => {
    const columns = getTableColumns(profiles);
    expect(columns.email.dataType).toBe('string');
  });

  it('should have full_name as text', () => {
    const columns = getTableColumns(profiles);
    expect(columns.full_name.dataType).toBe('string');
  });

  it('should have avatar_url as text', () => {
    const columns = getTableColumns(profiles);
    expect(columns.avatar_url.dataType).toBe('string');
  });

  it('should have created_at as timestamp with default', () => {
    const columns = getTableColumns(profiles);
    expect(columns.created_at.dataType).toBe('date');
    expect(columns.created_at.notNull).toBe(true);
  });

  it('should have updated_at as timestamp with default', () => {
    const columns = getTableColumns(profiles);
    expect(columns.updated_at.dataType).toBe('date');
    expect(columns.updated_at.notNull).toBe(true);
  });
});
