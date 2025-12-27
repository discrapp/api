import { assertEquals } from 'jsr:@std/assert';
import { getDisplayName, fetchDisplayName } from './display-name.ts';

Deno.test('getDisplayName - returns fallback for null profile', () => {
  const result = getDisplayName(null);
  assertEquals(result, 'Someone');
});

Deno.test('getDisplayName - returns custom fallback for null profile', () => {
  const result = getDisplayName(null, 'Anonymous');
  assertEquals(result, 'Anonymous');
});

Deno.test('getDisplayName - prefers full_name when display_preference is full_name', () => {
  const profile = {
    username: 'testuser',
    full_name: 'Test User',
    display_preference: 'full_name' as const,
  };
  const result = getDisplayName(profile);
  assertEquals(result, 'Test User');
});

Deno.test('getDisplayName - returns username with @ when display_preference is username', () => {
  const profile = {
    username: 'testuser',
    full_name: 'Test User',
    display_preference: 'username' as const,
  };
  const result = getDisplayName(profile);
  assertEquals(result, '@testuser');
});

Deno.test('getDisplayName - prefers username when no display_preference set', () => {
  const profile = {
    username: 'testuser',
    full_name: 'Test User',
  };
  const result = getDisplayName(profile);
  assertEquals(result, '@testuser');
});

Deno.test('getDisplayName - falls back to full_name when no username', () => {
  const profile = {
    full_name: 'Test User',
  };
  const result = getDisplayName(profile);
  assertEquals(result, 'Test User');
});

Deno.test('getDisplayName - returns fallback when only username is null', () => {
  const profile = {
    username: null,
    full_name: null,
  };
  const result = getDisplayName(profile);
  assertEquals(result, 'Someone');
});

Deno.test('getDisplayName - returns fallback when profile has no usable data', () => {
  const profile = {};
  const result = getDisplayName(profile);
  assertEquals(result, 'Someone');
});

Deno.test('getDisplayName - ignores full_name if empty when preference is full_name', () => {
  const profile = {
    username: 'testuser',
    full_name: '',
    display_preference: 'full_name' as const,
  };
  const result = getDisplayName(profile);
  assertEquals(result, '@testuser');
});

Deno.test('fetchDisplayName - fetches and formats display name', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              username: 'testuser',
              full_name: 'Test User',
              display_preference: 'username',
            },
          }),
        }),
      }),
    }),
  };

  const result = await fetchDisplayName(mockSupabase, 'user-123');
  assertEquals(result, '@testuser');
});

Deno.test('fetchDisplayName - returns fallback when profile not found', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: null,
          }),
        }),
      }),
    }),
  };

  const result = await fetchDisplayName(mockSupabase, 'user-123');
  assertEquals(result, 'Someone');
});

Deno.test('fetchDisplayName - uses custom fallback', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: null,
          }),
        }),
      }),
    }),
  };

  const result = await fetchDisplayName(mockSupabase, 'user-123', 'Unknown User');
  assertEquals(result, 'Unknown User');
});
