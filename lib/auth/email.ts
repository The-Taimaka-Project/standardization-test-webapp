import { Resend } from 'resend';

let _resend: Resend | null = null;
function client() {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');
  _resend = new Resend(key);
  return _resend;
}

const FROM = process.env.RESEND_FROM ?? 'Standardization Webapp <noreply@taimaka-internal.org>';

export async function sendVerificationEmail(to: string, link: string) {
  const r = await client().emails.send({
    from: FROM,
    to,
    subject: 'Verify your Standardization Webapp email',
    html: `<p>Click below to verify your email and finish creating your account:</p>
           <p><a href="${link}">${link}</a></p>
           <p>This link expires in 24 hours.</p>`,
    text: `Verify your email: ${link}\n(Expires in 24 hours.)`,
  });
  if (r.error) throw new Error(`Resend error: ${r.error.message}`);
}

export async function sendPasswordResetEmail(to: string, link: string) {
  const r = await client().emails.send({
    from: FROM,
    to,
    subject: 'Reset your Standardization Webapp password',
    html: `<p>Click below to reset your password:</p>
           <p><a href="${link}">${link}</a></p>
           <p>This link expires in 1 hour. If you didn't request this, ignore the email.</p>`,
    text: `Reset your password: ${link}\n(Expires in 1 hour.)`,
  });
  if (r.error) throw new Error(`Resend error: ${r.error.message}`);
}
