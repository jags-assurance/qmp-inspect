export const NOTIFICATIONS_TABLE = "notifications";

export interface NotificationRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  recipient_user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
