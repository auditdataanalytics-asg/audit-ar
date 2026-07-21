"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getPaginationItems, PAGE_SIZE_OPTIONS } from "@/lib/audit-ar/pagination";

export function DataPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  disabled = false,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  disabled?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const rangeStart = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, totalItems);
  const items = getPaginationItems(safePage, totalPages);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          Menampilkan {rangeStart}–{rangeEnd} dari {totalItems}
        </span>
        <span className="hidden sm:inline">·</span>
        <label className="flex items-center gap-2">
          <span>Baris</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              if (value) onPageSizeChange(Number(value));
            }}
            disabled={disabled}
          >
            <SelectTrigger size="sm" aria-label="Jumlah baris per halaman">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <nav className="flex max-w-full items-center gap-1 overflow-x-auto" aria-label="Pagination">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(safePage - 1)}
          disabled={disabled || safePage === 1}
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft />
        </Button>
        {items.map((item) =>
          typeof item === "number" ? (
            <Button
              key={item}
              type="button"
              variant={item === safePage ? "default" : "outline"}
              size="icon-sm"
              onClick={() => onPageChange(item)}
              disabled={disabled}
              aria-label={`Halaman ${item}`}
              aria-current={item === safePage ? "page" : undefined}
            >
              {item}
            </Button>
          ) : (
            <span
              key={item}
              className="flex size-7 shrink-0 items-center justify-center text-muted-foreground"
              aria-hidden="true"
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          ),
        )}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(safePage + 1)}
          disabled={disabled || safePage === totalPages}
          aria-label="Halaman berikutnya"
        >
          <ChevronRight />
        </Button>
      </nav>
    </div>
  );
}
