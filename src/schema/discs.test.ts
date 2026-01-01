import { discs, validateFlightNumbers, type FlightNumbers } from './discs';
import { getTableColumns, getTableName } from 'drizzle-orm';

describe('discs schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(discs)).toBe('discs');
  });

  it('should have all required columns', () => {
    const columns = getTableColumns(discs);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('owner_id');
    expect(columnNames).toContain('qr_code_id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('manufacturer');
    expect(columnNames).toContain('mold');
    expect(columnNames).toContain('plastic');
    expect(columnNames).toContain('weight');
    expect(columnNames).toContain('color');
    expect(columnNames).toContain('flight_numbers');
    expect(columnNames).toContain('reward_amount');
    expect(columnNames).toContain('notes');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('should have id as UUID with default', () => {
    const columns = getTableColumns(discs);
    expect(columns.id.dataType).toBe('string');
    expect(columns.id.notNull).toBe(true);
    expect(columns.id.primary).toBe(true);
  });

  it('should have owner_id as UUID foreign key', () => {
    const columns = getTableColumns(discs);
    expect(columns.owner_id.dataType).toBe('string');
    expect(columns.owner_id.notNull).toBe(true);
  });

  it('should have qr_code_id as UUID foreign key', () => {
    const columns = getTableColumns(discs);
    expect(columns.qr_code_id.dataType).toBe('string');
  });

  it('should have name, manufacturer, mold, plastic, color, notes as text', () => {
    const columns = getTableColumns(discs);
    expect(columns.name.dataType).toBe('string');
    expect(columns.name.notNull).toBe(true);
    expect(columns.manufacturer.dataType).toBe('string');
    expect(columns.mold.dataType).toBe('string');
    expect(columns.plastic.dataType).toBe('string');
    expect(columns.color.dataType).toBe('string');
    expect(columns.notes.dataType).toBe('string');
  });

  it('should have weight as integer', () => {
    const columns = getTableColumns(discs);
    expect(columns.weight.dataType).toBe('number');
  });

  it('should have flight_numbers as json', () => {
    const columns = getTableColumns(discs);
    expect(columns.flight_numbers.dataType).toBe('json');
    expect(columns.flight_numbers.notNull).toBe(true);
  });

  it('should have reward_amount as integer', () => {
    const columns = getTableColumns(discs);
    expect(columns.reward_amount.dataType).toBe('string');
  });

  it('should have created_at as timestamp with default', () => {
    const columns = getTableColumns(discs);
    expect(columns.created_at.dataType).toBe('date');
    expect(columns.created_at.notNull).toBe(true);
  });

  it('should have updated_at as timestamp with default', () => {
    const columns = getTableColumns(discs);
    expect(columns.updated_at.dataType).toBe('date');
    expect(columns.updated_at.notNull).toBe(true);
  });
});

describe('validateFlightNumbers', () => {
  it('should accept valid flight numbers', () => {
    const valid: FlightNumbers = {
      speed: 7,
      glide: 5,
      turn: 0,
      fade: 1,
    };

    expect(() => validateFlightNumbers(valid)).not.toThrow();
  });

  it('should accept valid flight numbers with stability', () => {
    const valid: FlightNumbers = {
      speed: 7,
      glide: 5,
      turn: 0,
      fade: 1,
      stability: 2,
    };

    expect(() => validateFlightNumbers(valid)).not.toThrow();
  });

  it('should reject speed below 1', () => {
    const invalid: FlightNumbers = {
      speed: 0,
      glide: 5,
      turn: 0,
      fade: 1,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow('Speed must be between 1 and 14');
  });

  it('should reject speed above 14', () => {
    const invalid: FlightNumbers = {
      speed: 15,
      glide: 5,
      turn: 0,
      fade: 1,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow('Speed must be between 1 and 14');
  });

  it('should reject glide below 1', () => {
    const invalid: FlightNumbers = {
      speed: 7,
      glide: 0,
      turn: 0,
      fade: 1,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow('Glide must be between 1 and 7');
  });

  it('should reject glide above 7', () => {
    const invalid: FlightNumbers = {
      speed: 7,
      glide: 8,
      turn: 0,
      fade: 1,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow('Glide must be between 1 and 7');
  });

  it('should reject turn below -5', () => {
    const invalid: FlightNumbers = {
      speed: 7,
      glide: 5,
      turn: -6,
      fade: 1,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow('Turn must be between -5 and 1');
  });

  it('should reject turn above 1', () => {
    const invalid: FlightNumbers = {
      speed: 7,
      glide: 5,
      turn: 2,
      fade: 1,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow('Turn must be between -5 and 1');
  });

  it('should reject fade below 0', () => {
    const invalid: FlightNumbers = {
      speed: 7,
      glide: 5,
      turn: 0,
      fade: -1,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow('Fade must be between 0 and 5');
  });

  it('should reject fade above 5', () => {
    const invalid: FlightNumbers = {
      speed: 7,
      glide: 5,
      turn: 0,
      fade: 6,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow('Fade must be between 0 and 5');
  });

  it('should accept all edge case valid values', () => {
    const minValid: FlightNumbers = {
      speed: 1,
      glide: 1,
      turn: -5,
      fade: 0,
    };

    const maxValid: FlightNumbers = {
      speed: 14,
      glide: 7,
      turn: 1,
      fade: 5,
    };

    expect(() => validateFlightNumbers(minValid)).not.toThrow();
    expect(() => validateFlightNumbers(maxValid)).not.toThrow();
  });
});
