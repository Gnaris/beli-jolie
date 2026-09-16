export function parsePageParam(raw: string | undefined | null): number {
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export interface PaginateResult {
  totalPages: number;
  currentPage: number;
  skip: number;
}

export function paginate(total: number, perPage: number, requestedPage: number): PaginateResult {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / perPage));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const skip = (currentPage - 1) * perPage;
  return { totalPages, currentPage, skip };
}
