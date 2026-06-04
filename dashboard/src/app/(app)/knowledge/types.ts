/**
 * Shared types for the knowledge UI components. Mirror the API responses
 * from src/app/api/knowledge/* — kept in their own file so any of the
 * leaf components can import without a circular dep on knowledge-client.
 */

export interface KnowledgeItem {
  id: string;
  type: "file" | "text" | "qa";
  file_name: string;
  title: string | null;
  question: string | null;
  answer: string | null;
  theme_id: string | null;
  theme_name: string | null;
  subtheme_id: string | null;
  subtheme_name: string | null;
  status: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

export interface Theme {
  id: string;
  name: string;
  created_at: string;
}

export interface Subtheme {
  id: string;
  name: string;
  theme_id: string | null;
  created_at: string;
}
