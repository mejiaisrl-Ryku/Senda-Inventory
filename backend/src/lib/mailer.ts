import { Resend } from "resend";

// ── Config ────────────────────────────────────────────────────────────────────

// RESEND_FROM must be a "name <email>" or plain email address whose domain is
// verified in your Resend account.  If the domain is unverified Resend rejects
// the send.  Set this in Railway's environment variables.
// Fallback: Resend's own onboarding domain works without domain verification
// and is useful for testing; swap for your verified domain in production.
const FROM =
  process.env.RESEND_FROM ?? "kyru Advisory <noreply@kyruadvisory.com>";

// ── Client factory ────────────────────────────────────────────────────────────

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[mailer] CRITICAL: RESEND_API_KEY is not set — emails will not be sent");
    throw new Error("RESEND_API_KEY is not set");
  }
  console.log(`[mailer] Resend client ready. FROM="${FROM}"`);
  return new Resend(apiKey);
}

// ── Shared send helper ────────────────────────────────────────────────────────

async function sendMail(payload: Parameters<Resend["emails"]["send"]>[0]): Promise<string> {
  const resend = getClient();

  console.log(`[mailer] Sending email to="${payload.to}" subject="${payload.subject}"`);

  let result: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    result = await resend.emails.send(payload);
  } catch (networkErr: unknown) {
    // Resend SDK can throw on network errors (not just return { error })
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    console.error(`[mailer] Network/SDK error calling Resend: ${msg}`);
    throw new Error(`Resend network error: ${msg}`);
  }

  const { data, error } = result;

  if (error) {
    console.error(
      `[mailer] Resend rejected the send: ${JSON.stringify(error)}`
    );
    throw new Error(`Resend error: ${error.message}`);
  }

  if (!data?.id) {
    // Resend SDK quirk: on some failure modes neither data nor error is set.
    console.error(
      `[mailer] Resend returned no message ID and no error — email was NOT queued. Raw result: ${JSON.stringify(result)}`
    );
    throw new Error(
      "Resend returned no message ID — the email was not queued. Check your RESEND_FROM domain is verified in the Resend dashboard."
    );
  }

  console.log(`[mailer] ✓ Email queued successfully. Resend message ID: ${data.id}`);
  return data.id;
}

// ── Public helpers ────────────────────────────────────────────────────────────

export async function sendInviteEmail({
  to,
  toName,
  restaurantName,
  inviteUrl,
}: {
  to: string;
  toName: string;
  restaurantName: string;
  inviteUrl: string;
}): Promise<string> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center">
            <table cellpadding="0" cellspacing="0" style="display:inline-table">
              <tr>
                <td style="padding-right:10px;vertical-align:middle">
                  <svg width="36" height="36" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <polygon points="20,2 35.6,11 35.6,29 20,38 4.4,29 4.4,11" fill="#3dbf8a"/>
                    <text x="20" y="27" text-anchor="middle" fill="#ffffff" font-size="20" font-weight="700" font-family="Inter,system-ui,sans-serif">K</text>
                  </svg>
                </td>
                <td style="vertical-align:middle">
                  <div style="color:#ffffff;font-weight:700;font-size:16px;line-height:1">kyru</div>
                  <div style="color:#3dbf8a;font-weight:600;font-size:10px;letter-spacing:0.18em;margin-top:2px">ADVISORY</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">
              You've been invited to join ${restaurantName}
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6">
              Hi ${toName}, your manager has invited you to the <strong>${restaurantName}</strong> inventory team on kyru.
              Click the button below to create your account and get started.
            </p>

            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:10px;background:#3dbf8a">
                  <a href="${inviteUrl}"
                     style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">
                    Accept Invitation
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6">
              Or copy this link into your browser:<br>
              <a href="${inviteUrl}" style="color:#3dbf8a;word-break:break-all">${inviteUrl}</a>
            </p>

            <p style="margin:20px 0 0;font-size:13px;color:#9ca3af">
              This invitation expires in 7 days. If you didn't expect this email you can safely ignore it.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
              Sent by kyru Advisory · <a href="https://kyruadvisory.com" style="color:#3dbf8a;text-decoration:none">kyruadvisory.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return sendMail({
    from: FROM,
    to: `${toName} <${to}>`,
    subject: `You're invited to join ${restaurantName} on kyru`,
    text: `Hi ${toName},\n\nYou've been invited to join ${restaurantName} on kyru.\n\nAccept your invitation here:\n${inviteUrl}\n\nThis link expires in 7 days.\n\n— kyru Advisory`,
    html,
  });
}

export async function sendPartnerInviteEmail({
  to,
  firstName,
  setupUrl,
}: {
  to: string;
  firstName: string;
  setupUrl: string;
}): Promise<string> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center">
            <table cellpadding="0" cellspacing="0" style="display:inline-table">
              <tr>
                <td style="padding-right:10px;vertical-align:middle">
                  <svg width="36" height="36" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <polygon points="20,2 35.6,11 35.6,29 20,38 4.4,29 4.4,11" fill="#3dbf8a"/>
                    <text x="20" y="27" text-anchor="middle" fill="#ffffff" font-size="20" font-weight="700" font-family="Inter,system-ui,sans-serif">K</text>
                  </svg>
                </td>
                <td style="vertical-align:middle">
                  <div style="color:#ffffff;font-weight:700;font-size:16px;line-height:1">kyru</div>
                  <div style="color:#3dbf8a;font-weight:600;font-size:10px;letter-spacing:0.18em;margin-top:2px">ADVISORY</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">
              Welcome to kyru, ${firstName}!
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6">
              You've been invited to set up your restaurant on <strong>kyru</strong> — the inventory platform built for modern restaurants.
              Click the button below to get started. This link expires in <strong>72 hours</strong>.
            </p>

            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:10px;background:#3dbf8a">
                  <a href="${setupUrl}"
                     style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">
                    Set Up My Restaurant
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6">
              Or copy this link into your browser:<br>
              <a href="${setupUrl}" style="color:#3dbf8a;word-break:break-all">${setupUrl}</a>
            </p>

            <p style="margin:20px 0 0;font-size:13px;color:#9ca3af">
              If you didn't expect this email you can safely ignore it.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
              Sent by kyru Advisory · <a href="https://kyruadvisory.com" style="color:#3dbf8a;text-decoration:none">kyruadvisory.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return sendMail({
    from: FROM,
    to: `${firstName} <${to}>`,
    subject: "You're invited to set up your restaurant on kyru",
    text: `Hi ${firstName},\n\nYou've been invited to set up your restaurant on kyru.\n\nGet started here (expires in 72 hours):\n${setupUrl}\n\n— kyru Advisory`,
    html,
  });
}

export async function sendPasswordResetEmail({
  to,
  toName,
  resetUrl,
}: {
  to: string;
  toName: string;
  resetUrl: string;
}): Promise<string> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center">
            <table cellpadding="0" cellspacing="0" style="display:inline-table">
              <tr>
                <td style="padding-right:10px;vertical-align:middle">
                  <svg width="36" height="36" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <polygon points="20,2 35.6,11 35.6,29 20,38 4.4,29 4.4,11" fill="#3dbf8a"/>
                    <text x="20" y="27" text-anchor="middle" fill="#ffffff" font-size="20" font-weight="700" font-family="Inter,system-ui,sans-serif">K</text>
                  </svg>
                </td>
                <td style="vertical-align:middle">
                  <div style="color:#ffffff;font-weight:700;font-size:16px;line-height:1">kyru</div>
                  <div style="color:#3dbf8a;font-weight:600;font-size:10px;letter-spacing:0.18em;margin-top:2px">ADVISORY</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">
              Reset your password
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6">
              Hi ${toName}, we received a request to reset the password for your kyru account.
              Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.
            </p>

            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:10px;background:#3dbf8a">
                  <a href="${resetUrl}"
                     style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">
                    Reset Password
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6">
              Or copy this link into your browser:<br>
              <a href="${resetUrl}" style="color:#3dbf8a;word-break:break-all">${resetUrl}</a>
            </p>

            <p style="margin:20px 0 0;font-size:13px;color:#9ca3af">
              If you didn't request a password reset, you can safely ignore this email — your password won't change.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
              Sent by kyru Advisory · <a href="https://kyruadvisory.com" style="color:#3dbf8a;text-decoration:none">kyruadvisory.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return sendMail({
    from: FROM,
    to: toName ? `${toName} <${to}>` : to,
    subject: "Reset your kyru password",
    text: `Hi ${toName},\n\nWe received a request to reset your kyru password.\n\nReset it here (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.\n\n— kyru Advisory`,
    html,
  });
}
