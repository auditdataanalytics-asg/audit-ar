import { describe, expect, it } from "vitest";

import {
  getPaginationItems,
  isPaginationPageSize,
  PAGE_SIZE_OPTIONS,
} from "@/lib/audit-ar/pagination";

describe("numbered pagination", () => {
  it("shows every page when the total is small", () => {
    expect(getPaginationItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("uses ellipses around a middle page", () => {
    expect(getPaginationItems(10, 20)).toEqual([
      1,
      "ellipsis-start",
      9,
      10,
      11,
      "ellipsis-end",
      20,
    ]);
  });

  it("keeps the first and last page directly accessible near either edge", () => {
    expect(getPaginationItems(1, 20)).toEqual([1, 2, 3, 4, "ellipsis-end", 20]);
    expect(getPaginationItems(20, 20)).toEqual([
      1,
      "ellipsis-start",
      17,
      18,
      19,
      20,
    ]);
  });

  it("caps the selectable page size at 100 rows", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 25, 50, 100]);
    expect(isPaginationPageSize(100)).toBe(true);
    expect(isPaginationPageSize(101)).toBe(false);
  });
});
