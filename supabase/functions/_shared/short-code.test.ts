import { assertEquals } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { generateShortCode, generateShortCodes } from './short-code.ts';

Deno.test('generateShortCode: should generate 12 character code', () => {
  const code = generateShortCode();
  assertEquals(code.length, 12);
});

Deno.test('generateShortCode: should only contain valid characters', () => {
  const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

  for (let i = 0; i < 100; i++) {
    const code = generateShortCode();
    for (const char of code) {
      assertEquals(validChars.includes(char), true, `Invalid character: ${char}`);
    }
  }
});

Deno.test('generateShortCode: should not contain ambiguous characters', () => {
  const ambiguousChars = '0O1lIio';

  for (let i = 0; i < 100; i++) {
    const code = generateShortCode();
    for (const char of code) {
      assertEquals(ambiguousChars.includes(char), false, `Ambiguous character found: ${char}`);
    }
  }
});

Deno.test('generateShortCode: should generate different codes each time', () => {
  const codes = new Set<string>();
  for (let i = 0; i < 100; i++) {
    codes.add(generateShortCode());
  }
  // With 12 character codes from 55 characters, collision probability is extremely low
  // We expect all 100 codes to be unique
  assertEquals(codes.size, 100, `Expected 100 unique codes, got ${codes.size}`);
});

Deno.test('generateShortCode: should use mixed case characters', () => {
  // Generate enough codes to statistically guarantee mixed case
  let hasUpper = false;
  let hasLower = false;
  let hasNumber = false;

  for (let i = 0; i < 100; i++) {
    const code = generateShortCode();
    if (/[A-Z]/.test(code)) hasUpper = true;
    if (/[a-z]/.test(code)) hasLower = true;
    if (/[0-9]/.test(code)) hasNumber = true;
    if (hasUpper && hasLower && hasNumber) break;
  }

  assertEquals(hasUpper, true, 'Should contain uppercase letters');
  assertEquals(hasLower, true, 'Should contain lowercase letters');
  assertEquals(hasNumber, true, 'Should contain numbers');
});

Deno.test('generateShortCodes: should generate requested number of codes', () => {
  const codes = generateShortCodes(10);
  assertEquals(codes.length, 10);
});

Deno.test('generateShortCodes: should generate all unique codes', () => {
  const codes = generateShortCodes(50);
  const uniqueCodes = new Set(codes);
  assertEquals(uniqueCodes.size, 50);
});

Deno.test('generateShortCodes: should handle single code request', () => {
  const codes = generateShortCodes(1);
  assertEquals(codes.length, 1);
  assertEquals(codes[0].length, 12);
});

Deno.test('generateShortCodes: should handle large batch request', () => {
  const codes = generateShortCodes(100);
  assertEquals(codes.length, 100);
  const uniqueCodes = new Set(codes);
  assertEquals(uniqueCodes.size, 100);
});
