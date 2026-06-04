export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  deactivated_at: string | null;
  last_login_at: string | null;
  created_at: string;
  schools: string[];
}
