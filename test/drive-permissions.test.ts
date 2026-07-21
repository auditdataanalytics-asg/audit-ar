import { beforeEach, describe, expect, it, vi } from "vitest";

const driveMocks = vi.hoisted(() => ({
  listPermissions: vi.fn(),
  createPermission: vi.fn(),
}));

vi.mock("@googleapis/drive", () => ({
  drive: () => ({
    permissions: {
      list: driveMocks.listPermissions,
      create: driveMocks.createPermission,
    },
  }),
}));

vi.mock("@/lib/audit-ar/google/drive-auth", () => ({
  getDriveAuthProvider: () => ({
    getAuthClient: vi.fn().mockResolvedValue({}),
  }),
}));

import { ensureFolderAnyoneWithLink } from "@/lib/audit-ar/google/drive";

describe("Google Drive unit folder permissions", () => {
  beforeEach(() => {
    driveMocks.listPermissions.mockReset();
    driveMocks.createPermission.mockReset();
  });

  it("grants reader access to anyone with the folder link", async () => {
    driveMocks.listPermissions.mockResolvedValue({ data: { permissions: [] } });
    driveMocks.createPermission.mockResolvedValue({ data: {} });

    await ensureFolderAnyoneWithLink("folder_123");

    expect(driveMocks.createPermission).toHaveBeenCalledWith({
      fileId: "folder_123",
      supportsAllDrives: true,
      requestBody: {
        type: "anyone",
        role: "reader",
        allowFileDiscovery: false,
      },
    });
  });

  it("keeps an existing anyone permission without creating a duplicate", async () => {
    driveMocks.listPermissions.mockResolvedValue({
      data: { permissions: [{ id: "permission_1", type: "anyone", role: "reader" }] },
    });

    await ensureFolderAnyoneWithLink("folder_123");

    expect(driveMocks.createPermission).not.toHaveBeenCalled();
  });
});
