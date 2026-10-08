// Messages for the ?error= codes proxy.ts / the auth routes send people back to /login with.
export const LOGIN_NOTICES: Record<string, string> = {
  reset_link_invalid: "That password reset link is invalid or has expired. Request a new one from Forgot password.",
  deactivated: "This account has been deactivated. Contact your administrator if you think that is a mistake.",
  session_idle: "You were signed out after a period of inactivity. Sign in again to continue.",
  session_expired: "Your session reached its maximum length. Sign in again to continue.",
  temp_password_expired: "Your temporary password has expired. Ask your administrator to issue a new one.",
  session_ended: "Your session has ended. Sign in again to continue.",
};

/** Where the client idle timer sends a signed-out user: the same notice proxy.ts shows for an idle session. */
export const IDLE_LOGIN_PATH = "/login?error=session_idle";

export function loginNotice(code: string | undefined): string | null {
  return code && Object.prototype.hasOwnProperty.call(LOGIN_NOTICES, code) ? LOGIN_NOTICES[code] : null;
}
