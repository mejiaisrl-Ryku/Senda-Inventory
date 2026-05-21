import { Resend } from "resend";

const FROM = "noreply@kyruadvisory.com";

function getClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  return new Resend(apiKey);
}

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
}) {
  const resend = getClient();

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

  const { error } = await resend.emails.send({
    from: `kyru Advisory <${FROM}>`,
    to: `${toName} <${to}>`,
    subject: `You're invited to join ${restaurantName} on kyru`,
    text: `Hi ${toName},\n\nYou've been invited to join ${restaurantName} on kyru.\n\nAccept your invitation here:\n${inviteUrl}\n\nThis link expires in 7 days.\n\n— kyru Advisory`,
    html,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
}
