import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { sendEmail } from '../_shared/email.ts';

/**
 * Test Email Function
 *
 * Simple function to test email sending via Resend
 */

const PRINTER_EMAIL = Deno.env.get('PRINTER_EMAIL') || 'test@example.com';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`Sending test email to: ${PRINTER_EMAIL}`);

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Email Test Successful!</h1>
    </div>
    <div style="padding: 20px;">
      <p>This is a test email from AceBack API.</p>
      <p>If you received this email, your Resend API key and PRINTER_EMAIL are configured correctly!</p>
      <p><strong>Configuration verified:</strong></p>
      <ul>
        <li>✅ RESEND_API_KEY is valid</li>
        <li>✅ PRINTER_EMAIL is set to: ${PRINTER_EMAIL}</li>
        <li>✅ Email delivery is working</li>
      </ul>
    </div>
  </div>
</body>
</html>
`;

  const emailText = `
Email Test Successful!

This is a test email from AceBack API.
If you received this email, your Resend API key and PRINTER_EMAIL are configured correctly!

Configuration verified:
- RESEND_API_KEY is valid
- PRINTER_EMAIL is set to: ${PRINTER_EMAIL}
- Email delivery is working
`;

  const result = await sendEmail({
    to: PRINTER_EMAIL,
    subject: '✅ AceBack Email Test',
    html: emailHtml,
    text: emailText,
  });

  if (!result.success) {
    console.error('Failed to send test email:', result.error);
    return new Response(
      JSON.stringify({
        success: false,
        error: result.error,
        printer_email: PRINTER_EMAIL,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  console.log('Test email sent successfully! Message ID:', result.messageId);

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Test email sent successfully',
      message_id: result.messageId,
      sent_to: PRINTER_EMAIL,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
