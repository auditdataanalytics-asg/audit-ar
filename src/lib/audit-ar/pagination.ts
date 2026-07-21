export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type PaginationPageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

export function isPaginationPageSize(value: unknown): value is PaginationPageSize {
  return (
    typeof value === "number" &&
    PAGE_SIZE_OPTIONS.includes(value as PaginationPageSize)
  );
}

export function getPaginationItems(page: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 4) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (page >= totalPages - 3) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }

  const orderedPages = Array.from(pages)
    .filter((item) => item >= 1 && item <= totalPages)
    .sort((a, b) => a - b);
  const items: PaginationItem[] = [];

  orderedPages.forEach((item, index) => {
    const previous = orderedPages[index - 1];
    if (previous && item - previous > 1) {
      items.push(previous === 1 ? "ellipsis-start" : "ellipsis-end");
    }
    items.push(item);
  });

  return items;
}
