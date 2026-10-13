# Email templates

Two kinds of email are sent:

1. App emails (notifications, transmittals, handover, login invite) are sent by this app through Resend and rendered in `apps/web/lib/notifications/render.ts` (`renderBrandedEmailHtml`). They need `RESEND_API_KEY`.
2. Auth emails (invite, reset password, confirm email, magic link, email change) are sent by Supabase Auth. Their HTML lives in `supabase/templates/*.html`.

## Local development

`supabase/config.toml` wires the templates under `[auth.email.template.*]` (`content_path`). This only applies to the local Supabase stack. It does not change the hosted project.

## Hosted project

In the Supabase Dashboard open Authentication > Email Templates. For each template below, set the subject and paste the full contents of the file into the message body, then Save.

| Dashboard template | File | Subject |
| --- | --- | --- |
| Invite user | `supabase/templates/invite.html` | You have been invited to JAGS Assurance |
| Reset password | `supabase/templates/recovery.html` | Reset your JAGS Assurance password |
| Confirm signup | `supabase/templates/confirmation.html` | Confirm your JAGS Assurance email |
| Magic link | `supabase/templates/magic_link.html` | Your JAGS Assurance sign-in link |
| Change email address | `supabase/templates/email_change.html` | Confirm your new JAGS Assurance email |

The templates use `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` and `{{ .SiteURL }}`. Make sure Authentication > URL Configuration > Site URL is the production app URL, because the logo (`{{ .SiteURL }}/icon-192.png`) and footer links are built from it.

Delivery from the default Supabase sender is heavily rate limited. For production configure custom SMTP (Authentication > Emails > SMTP Settings), for example with Resend.
