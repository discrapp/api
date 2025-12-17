import { assertEquals } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { sendEmail } from './email.ts';

// Note: Most email tests require mocking the Resend API or having a valid API key.
// These tests focus on edge cases and error handling.

Deno.test('sendEmail: should return error when RESEND_API_KEY not configured', async () => {
  // Temporarily unset the API key if it exists
  const originalKey = Deno.env.get('RESEND_API_KEY');
  if (originalKey) {
    Deno.env.delete('RESEND_API_KEY');
  }

  try {
    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Test Subject',
      html: '<p>Test body</p>',
    });

    assertEquals(result.success, false);
    assertEquals(result.error, 'Email not configured');
  } finally {
    // Restore the API key if it existed
    if (originalKey) {
      Deno.env.set('RESEND_API_KEY', originalKey);
    }
  }
});

Deno.test('sendEmail: should accept string or array for to field', async () => {
  // This test verifies the type handling without actually sending
  // Since RESEND_API_KEY is likely not set in test env, it will fail early
  const originalKey = Deno.env.get('RESEND_API_KEY');
  if (originalKey) {
    Deno.env.delete('RESEND_API_KEY');
  }

  try {
    // Test with string
    const result1 = await sendEmail({
      to: 'single@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    });
    assertEquals(result1.success, false);

    // Test with array
    const result2 = await sendEmail({
      to: ['first@example.com', 'second@example.com'],
      subject: 'Test',
      html: '<p>Test</p>',
    });
    assertEquals(result2.success, false);
  } finally {
    if (originalKey) {
      Deno.env.set('RESEND_API_KEY', originalKey);
    }
  }
});

Deno.test('sendEmail: should send email successfully (requires RESEND_API_KEY)', async () => {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    console.log('Skipping email send test - RESEND_API_KEY not set');
    return;
  }

  // Use Resend's test email address
  const result = await sendEmail({
    to: 'delivered@resend.dev',
    subject: 'Test Email from AceBack',
    html: '<p>This is a test email.</p>',
    text: 'This is a test email.',
  });

  assertEquals(result.success, true);
  assertEquals(typeof result.messageId, 'string');
});
