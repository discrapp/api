import { assertEquals } from 'jsr:@std/assert';
import { resolveAvatarUrl } from './avatar.ts';

Deno.test('avatar - returns signed URL when avatarStoragePath provided', async () => {
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://storage.example.com/signed-url' },
        }),
      }),
    },
  };

  const result = await resolveAvatarUrl(
    'test@example.com',
    'user123.jpg',
    mockSupabase as never,
    200
  );

  assertEquals(result, 'https://storage.example.com/signed-url');
});

Deno.test('avatar - falls back to Gravatar when signed URL fails', async () => {
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: null,
        }),
      }),
    },
  };

  const result = await resolveAvatarUrl(
    'test@example.com',
    'user123.jpg',
    mockSupabase as never,
    200
  );

  // Should return Gravatar URL
  assertEquals(result, 'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=200&d=404');
});

Deno.test('avatar - returns Gravatar when no avatarStoragePath', async () => {
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://storage.example.com/signed-url' },
        }),
      }),
    },
  };

  const result = await resolveAvatarUrl(
    'test@example.com',
    null,
    mockSupabase as never,
    200
  );

  assertEquals(result, 'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=200&d=404');
});

Deno.test('avatar - returns null when no email and no avatarStoragePath', async () => {
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: null,
        }),
      }),
    },
  };

  const result = await resolveAvatarUrl(
    null,
    null,
    mockSupabase as never,
    200
  );

  assertEquals(result, null);
});

Deno.test('avatar - respects custom size parameter', async () => {
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: null,
        }),
      }),
    },
  };

  const result = await resolveAvatarUrl(
    'test@example.com',
    null,
    mockSupabase as never,
    300
  );

  assertEquals(result, 'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=300&d=404');
});

Deno.test('avatar - uses default size when not specified', async () => {
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: null,
        }),
      }),
    },
  };

  const result = await resolveAvatarUrl(
    'test@example.com',
    null,
    mockSupabase as never
  );

  assertEquals(result?.includes('s=200'), true);
});

Deno.test('avatar - handles undefined avatarStoragePath', async () => {
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: null,
        }),
      }),
    },
  };

  const result = await resolveAvatarUrl(
    'test@example.com',
    undefined,
    mockSupabase as never,
    200
  );

  assertEquals(result, 'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=200&d=404');
});

Deno.test('avatar - handles undefined email', async () => {
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://storage.example.com/signed-url' },
        }),
      }),
    },
  };

  const result = await resolveAvatarUrl(
    undefined,
    'user123.jpg',
    mockSupabase as never,
    200
  );

  assertEquals(result, 'https://storage.example.com/signed-url');
});
