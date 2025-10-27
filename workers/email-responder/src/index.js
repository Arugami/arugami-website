/**
 * Arugami Email Auto-Responder Worker
 *
 * Handles emails to hello@arugami.com:
 * 1. Forwards to jordan@arugami.com
 * 2. Sends branded auto-reply to sender
 */

export default {
  async email(message, env, ctx) {
    // Forward the original message to Jordan
    await message.forward("jordan@arugami.com");

    // Extract sender info
    const senderEmail = message.from;
    const subject = message.headers.get("subject") || "Your Arugami Inquiry";

    // Create auto-reply message
    const reply = new EmailMessage(
      "hello@arugami.com",
      senderEmail,
      `Re: ${subject}`
    );

    // Set reply headers
    reply.setHeader("Content-Type", "text/html; charset=utf-8");

    // Branded HTML email body (Reynolds + W+K voice)
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #000000; color: #ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #000000;">
    <tr>
      <td style="padding: 40px 20px;">

        <!-- Logo -->
        <div style="text-align: center; margin-bottom: 40px;">
          <div style="font-size: 32px; font-weight: 900; background: linear-gradient(135deg, #FFD700, #00FF00); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
            ARUGAMI
          </div>
          <div style="font-size: 12px; color: #888888; margin-top: 8px; letter-spacing: 2px;">
            HUDSON COUNTY'S FIRST AI STUDIO
          </div>
        </div>

        <!-- Main Message -->
        <div style="background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(0, 255, 0, 0.1)); border-radius: 12px; padding: 30px; margin-bottom: 30px;">
          <h1 style="margin: 0 0 20px 0; font-size: 28px; font-weight: 900; color: #ffffff; line-height: 1.2;">
            We got your message.
          </h1>

          <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #e0e0e0;">
            Thanks for reaching out. We'll get back to you within 24 hours.
          </p>

          <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #e0e0e0;">
            In the meantime, check out what we're making for Hudson County businesses:
            <a href="https://arugami.com" style="color: #FFD700; text-decoration: none; font-weight: 600;">arugami.com</a>
          </p>
        </div>

        <!-- The Smirk Beat (Reynolds voice) -->
        <div style="padding: 20px; border-left: 3px solid #FFD700; margin-bottom: 30px; background: rgba(255, 215, 0, 0.05);">
          <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #cccccc; font-style: italic;">
            "None of this was filmed. All of it is real. That's the whole trick."
          </p>
        </div>

        <!-- CTA -->
        <div style="text-align: center; margin-bottom: 30px;">
          <a href="https://arugami.com" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #FFD700, #00FF00); color: #000000; text-decoration: none; font-weight: 700; font-size: 16px; border-radius: 50px; text-transform: uppercase; letter-spacing: 1px;">
            See the Magic
          </a>
        </div>

        <!-- Signature -->
        <div style="border-top: 1px solid #333333; padding-top: 20px; text-align: center;">
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #888888;">
            — The Arugami Team
          </p>
          <p style="margin: 0; font-size: 12px; color: #666666;">
            Film crews are optional now.
          </p>
        </div>

      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    reply.setBody(htmlBody);

    // Send the auto-reply
    await reply.send();
  }
};
