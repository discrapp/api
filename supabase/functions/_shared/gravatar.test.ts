import { assertEquals } from 'jsr:@std/assert';
import { getGravatarUrl } from './gravatar.ts';

Deno.test('gravatar - returns null for null email', async () => {
  const result = await getGravatarUrl(null);
  assertEquals(result, null);
});

Deno.test('gravatar - returns null for undefined email', async () => {
  const result = await getGravatarUrl(undefined);
  assertEquals(result, null);
});

Deno.test('gravatar - generates correct URL for email', async () => {
  const result = await getGravatarUrl('test@example.com');
  // MD5 of 'test@example.com' is '55502f40dc8b7c769880b10874abc9d0'
  assertEquals(result, 'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=200&d=404');
});

Deno.test('gravatar - handles email with whitespace', async () => {
  const result = await getGravatarUrl('  test@example.com  ');
  // Should trim and lowercase
  assertEquals(result, 'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=200&d=404');
});

Deno.test('gravatar - handles uppercase email', async () => {
  const result = await getGravatarUrl('TEST@EXAMPLE.COM');
  // Should lowercase
  assertEquals(result, 'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=200&d=404');
});

Deno.test('gravatar - respects custom size parameter', async () => {
  const result = await getGravatarUrl('test@example.com', 100);
  assertEquals(result, 'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=100&d=404');
});

Deno.test('gravatar - uses default size when not specified', async () => {
  const result = await getGravatarUrl('test@example.com');
  assertEquals(result?.includes('s=200'), true);
});

Deno.test('gravatar - handles empty string email', async () => {
  const result = await getGravatarUrl('');
  // Empty string should be treated as falsy
  assertEquals(result, null);
});
