import { Resend } from "resend";
import { getFrontendUrl } from "./urls";

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
            <div style="display:inline-block;padding:4px 10px;border-radius:6px;background:#ecfdf5;color:#15803d;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:12px">
              Admin Invitation
            </div>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">
              ${toName}, you've been invited to join ${restaurantName}
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6">
              Hi ${toName}, your manager has invited you as an <strong>Admin</strong> on the <strong>${restaurantName}</strong> inventory team on kyru.
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
  inviteType = "partner",
}: {
  to: string;
  firstName: string;
  setupUrl: string;
  /** "partner" — new restaurant setup. "owner" — owner account activation, no restaurant created. */
  inviteType?: "partner" | "owner";
}): Promise<string> {
  const isOwner = inviteType === "owner";
  const badgeLabel = isOwner ? "Owner Invitation" : "Partner Invitation";
  const heading = isOwner
    ? `Welcome to kyru, ${firstName}!`
    : `Welcome to kyru, ${firstName}!`;
  const bodyCopy = isOwner
    ? `You've been invited as an <strong>Owner</strong> on <strong>kyru</strong> — the inventory platform built for modern restaurants. Click the button below to activate your account. This link expires in <strong>72 hours</strong>.`
    : `You've been invited to set up your restaurant on <strong>kyru</strong> — the inventory platform built for modern restaurants. Click the button below to get started. This link expires in <strong>72 hours</strong>.`;
  const buttonLabel = isOwner ? "Activate My Account" : "Set Up My Restaurant";
  const subject = isOwner
    ? "You're invited to activate your owner account on kyru"
    : "You're invited to set up your restaurant on kyru";

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
            <div style="display:inline-block;padding:4px 10px;border-radius:6px;background:#ecfdf5;color:#15803d;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:12px">
              ${badgeLabel}
            </div>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">
              ${heading}
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6">
              ${bodyCopy}
            </p>

            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:10px;background:#3dbf8a">
                  <a href="${setupUrl}"
                     style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">
                    ${buttonLabel}
                  </a>
                </td>
              </tr>
            </table>

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
    subject,
    text: isOwner
      ? `Hi ${firstName},\n\nYou've been invited as an Owner on kyru.\n\nActivate your account here (expires in 72 hours):\n${setupUrl}\n\n— kyru Advisory`
      : `Hi ${firstName},\n\nYou've been invited to set up your restaurant on kyru.\n\nGet started here (expires in 72 hours):\n${setupUrl}\n\n— kyru Advisory`,
    html,
  });
}

export async function sendFeedbackEmail({
  fromName,
  fromEmail,
  restaurant,
  role,
  message,
  timestamp,
}: {
  fromName: string;
  fromEmail: string;
  restaurant: string;
  role: string;
  message: string;
  timestamp: string;
}): Promise<string> {
  const roleDisplay =
    role === "ADMIN" ? "Admin / Manager" :
    role === "STAFF" ? "Staff" :
    role;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#1a1a1a;padding:24px 40px">
            <span style="color:#3dbf8a;font-weight:700;font-size:16px;letter-spacing:0.04em">kyru</span>
            <span style="color:#555;font-size:13px;margin-left:10px">User Feedback</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px">
            <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#111827">New suggestion received</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:24px">
              <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:11px;color:#9ca3af;display:block;margin-bottom:2px">FROM</span>
                  <span style="font-size:14px;color:#111827;font-weight:600">${fromName}</span>
                  <span style="font-size:13px;color:#6b7280;margin-left:6px">&lt;${fromEmail}&gt;</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:11px;color:#9ca3af;display:block;margin-bottom:2px">RESTAURANT</span>
                  <span style="font-size:14px;color:#111827">${restaurant}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
                  <span style="font-size:11px;color:#9ca3af;display:block;margin-bottom:2px">ROLE</span>
                  <span style="font-size:14px;color:#111827">${roleDisplay}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 16px">
                  <span style="font-size:11px;color:#9ca3af;display:block;margin-bottom:2px">SENT</span>
                  <span style="font-size:13px;color:#6b7280">${timestamp}</span>
                </td>
              </tr>
            </table>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px">
              <p style="margin:0;font-size:15px;color:#111827;line-height:1.7;white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:16px 40px;border-top:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
              kyru Advisory · <a href="https://kyruadvisory.com" style="color:#3dbf8a;text-decoration:none">kyruadvisory.com</a>
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
    to: "israel@kyruadvisory.com",
    replyTo: `${fromName} <${fromEmail}>`,
    subject: `[Feedback] ${fromName} · ${restaurant}`,
    text: `New suggestion from ${fromName} (${fromEmail})\nRestaurant: ${restaurant}\nRole: ${roleDisplay}\nSent: ${timestamp}\n\n${message}`,
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

// ── Welcome email (post-signup) ───────────────────────────────────────────────

export async function sendWelcomeEmail({
  to,
  restaurantName,
  language = "en",
}: {
  to: string;
  restaurantName: string;
  language?: string;
}): Promise<string> {
  const appUrl = getFrontendUrl();
  const es = language === "es";

  const subject = es
    ? "Bienvenido a Kyru Advisory — Comencemos en 5 minutos"
    : "Welcome to Kyru Advisory — Let's Get Started in 5 Minutes";

  const logoBlock = `
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
    </table>`;

  const btn = (href: string, label: string) =>
    `<table cellpadding="0" cellspacing="0" style="margin-top:12px">
      <tr>
        <td style="border-radius:8px;background:#3dbf8a">
          <a href="${href}" style="display:inline-block;padding:10px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${label}</a>
        </td>
      </tr>
    </table>`;

  const step = (n: number, title: string, body: string, btnHref: string, btnLabel: string) =>
    `<tr>
      <td style="padding:0 0 24px">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="32" style="vertical-align:top;padding-top:2px">
              <div style="width:28px;height:28px;background:#3dbf8a;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;color:#fff">${n}</div>
            </td>
            <td style="padding-left:12px">
              <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px">${title}</div>
              <div style="font-size:14px;color:#6b7280;line-height:1.6">${body}</div>
              ${btn(btnHref, btnLabel)}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const win = (text: string) =>
    `<tr><td style="padding:4px 0 4px 8px;font-size:14px;color:#6b7280">
      <span style="color:#3dbf8a;font-weight:700;margin-right:6px">✓</span>${text}
    </td></tr>`;

  const html = es ? `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center">
            ${logoBlock}
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px 28px">
            <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111827">Bienvenido, ${restaurantName} 🎉</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6">Ya estás dentro. Configuremos todo en 5 minutos:</p>
            <table cellpadding="0" cellspacing="0" width="100%">
              ${step(1, "Confirma tu acceso", "Ve a tu panel y verifica que tu cuenta está activa.", `${appUrl}/login`, "Abre Kyru")}
              ${step(2, "Carga tu primera factura", "Tu primera factura toma 60 segundos. Nuestro IA lee los costos al instante — sin entrada manual.", `${appUrl}/dashboard/invoices`, "Cargar Factura")}
              ${step(3, "Revisa tu inventario", "Ve qué estás rastreando vs. qué está en stock. Detecta escasez antes de que duela.", `${appUrl}/dashboard/inventory`, "Ver Inventario")}
              ${step(4, "Entiende tus costos", "Estándares de la industria: Costo de alimento 28–35%, Mano de obra 25–30%. ¿Dónde estás?", `${appUrl}/dashboard/financials`, "Ver Tus Costos")}
            </table>
            <div style="margin-top:8px">
              <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:12px">Después de 3–5 facturas, verás:</div>
              <table cellpadding="0" cellspacing="0">
                ${win("Cuánto cuesta hacer cada plato")}
                ${win("Qué proveedores se comen tu ganancia")}
                ${win("Tendencias históricas de costos (por semana, por mes)")}
                ${win("Dónde estás perdiendo dinero")}
              </table>
            </div>
            <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:28px">
              <tr>
                <td style="background:#f0fdf4;border-left:4px solid #3dbf8a;border-radius:0 8px 8px 0;padding:16px 20px">
                  <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:6px">¿Atascado? Estamos aquí.</div>
                  <div style="font-size:14px;color:#6b7280;line-height:1.6">Responde este correo. Soporte disponible <strong>viernes 9am–6pm CST</strong>. Respondemos en 2 horas.</div>
                </td>
              </tr>
            </table>
            <p style="font-size:14px;color:#9ca3af;margin-top:28px;margin-bottom:0">
              — Israel<br><span style="font-size:13px">Fundador, Kyru Advisory</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:18px 40px;border-top:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
              © 2026 Kyru Advisory · <a href="https://kyruadvisory.com" style="color:#3dbf8a;text-decoration:none">kyruadvisory.com</a><br>
              ¿Preguntas? Responde este correo.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>` : `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center">
            ${logoBlock}
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px 28px">
            <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111827">Welcome, ${restaurantName} 🎉</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6">You're in. Let's get you set up in 5 minutes:</p>
            <table cellpadding="0" cellspacing="0" width="100%">
              ${step(1, "Confirm Your Login", "Go to your dashboard and verify your account is active.", `${appUrl}/login`, "Open Kyru")}
              ${step(2, "Upload Your First Invoice", "Your first invoice takes 60 seconds. Our AI reads costs instantly — no manual entry.", `${appUrl}/dashboard/invoices`, "Upload Invoice")}
              ${step(3, "Check Your Inventory", "See what you're tracking vs. what's in stock. Spot shortages before they hurt.", `${appUrl}/dashboard/inventory`, "View Inventory")}
              ${step(4, "Understand Your Costs", "Industry standards: Food cost 28–35%, Labor 25–30%. Where do you stand?", `${appUrl}/dashboard/financials`, "See Your Costs")}
            </table>
            <div style="margin-top:8px">
              <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:12px">After 3–5 Invoices, You'll See:</div>
              <table cellpadding="0" cellspacing="0">
                ${win("How much each dish costs you to make")}
                ${win("Which vendors are eating into your profit")}
                ${win("Historical cost trends (by week, by month)")}
                ${win("Spots where you're bleeding money")}
              </table>
            </div>
            <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:28px">
              <tr>
                <td style="background:#f0fdf4;border-left:4px solid #3dbf8a;border-radius:0 8px 8px 0;padding:16px 20px">
                  <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:6px">Stuck? We're here.</div>
                  <div style="font-size:14px;color:#6b7280;line-height:1.6">Reply to this email. Support is available <strong>Friday 9am–6pm CST</strong>. We respond within 2 hours.</div>
                </td>
              </tr>
            </table>
            <p style="font-size:14px;color:#9ca3af;margin-top:28px;margin-bottom:0">
              — Israel<br><span style="font-size:13px">Founder, Kyru Advisory</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:18px 40px;border-top:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
              © 2026 Kyru Advisory · <a href="https://kyruadvisory.com" style="color:#3dbf8a;text-decoration:none">kyruadvisory.com</a><br>
              Questions? Reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textEn = `Welcome to Kyru Advisory, ${restaurantName}!

Here's how to get started in 5 minutes:

1. Confirm your login → ${appUrl}/login
2. Upload your first invoice → ${appUrl}/dashboard/invoices
   Your first invoice takes 60 seconds. Our AI reads costs instantly.
3. Check your inventory → ${appUrl}/dashboard/inventory
4. Understand your costs → ${appUrl}/dashboard/financials
   Food cost should be 28-35%. Labor 25-30%.

After 3-5 invoices you'll see how much each dish costs, which vendors eat into profit, and historical cost trends.

Stuck? Reply to this email. Support is available Friday 9am-6pm CST.

— Israel
Founder, Kyru Advisory
https://kyruadvisory.com`;

  const textEs = `¡Bienvenido a Kyru Advisory, ${restaurantName}!

Aquí está cómo empezar en 5 minutos:

1. Confirma tu acceso → ${appUrl}/login
2. Carga tu primera factura → ${appUrl}/dashboard/invoices
   Tu primera factura toma 60 segundos. Nuestro IA lee los costos al instante.
3. Revisa tu inventario → ${appUrl}/dashboard/inventory
4. Entiende tus costos → ${appUrl}/dashboard/financials
   Costo de alimento 28-35%. Mano de obra 25-30%.

Después de 3-5 facturas verás cuánto cuesta cada plato, qué proveedores se comen tu ganancia, y tendencias históricas de costos.

¿Atascado? Responde este correo. Soporte disponible viernes 9am-6pm CST.

— Israel
Fundador, Kyru Advisory
https://kyruadvisory.com`;

  return sendMail({
    from: FROM,
    to,
    replyTo: "support@kyruadvisory.com",
    subject,
    text: es ? textEs : textEn,
    html,
  });
}

// ── Lead notification (landing page) ─────────────────────────────────────────

export async function sendLeadNotification(lead: {
  name:       string;
  restaurant: string;
  email:      string | null; // null only for pre-June-2026 rows
  locations:  string;
  phone:      string;
  language:   string;
  pageLang:   string;
  createdAt:  Date;
}): Promise<string> {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#666;white-space:nowrap">${label}</td><td style="padding:6px 0;font-weight:600">${esc(value)}</td></tr>`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<body style="font-family:-apple-system,Segoe UI,sans-serif;color:#111;max-width:520px">
  <h2 style="margin:0 0 4px">New trial request</h2>
  <p style="margin:0 0 18px;color:#666">From the kyruadvisory.com landing page.</p>
  <table style="border-collapse:collapse;font-size:15px">
    ${row("Name",       lead.name)}
    ${row("Restaurant", lead.restaurant)}
    ${row("Email",      lead.email ?? "—")}
    ${row("Locations",  lead.locations)}
    ${row("WhatsApp",   lead.phone)}
    ${row("Language",   lead.language)}
    ${row("Page lang",  lead.pageLang)}
    ${row("Received",   lead.createdAt.toISOString())}
  </table>
</body>
</html>`;

  return sendMail({
    from:    FROM,
    to:      "israel@kyruadvisory.com",
    ...(lead.email ? { replyTo: `${lead.name} <${lead.email}>` } : {}),
    subject: `[Kyru Lead] ${lead.restaurant} — ${lead.locations} locations`,
    html,
  });
}
