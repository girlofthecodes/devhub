export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type FieldErrors = Record<string, string[]>;

export interface ApiErrorBody {
  code: string;
  detail: string;
  fields?: FieldErrors;
}

export type Role = "ADMIN" | "DEVELOPER" | "CLIENT" | "VISITOR";

export interface ListParams {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
}
