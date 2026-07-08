import { z } from "zod";

// One row of the master-data Excel import.
export const auditUnitRowSchema = z.object({
  unitNumber: z.string().trim().min(1, "Nomor unit kosong"),
  projectName: z.string().trim().min(1, "Nama proyek kosong"),
  unitDetail: z.string().trim().default(""),
  customerName: z.string().trim().default(""),
  brandName: z.string().trim().default(""),
  unitType: z.string().trim().default(""),
  concernNotes: z.string().trim().default(""),
});

export type AuditUnitRow = z.infer<typeof auditUnitRowSchema>;

// Supervisor-managed selectable category.
export const auditCategorySchema = z.object({
  type: z.enum(["buildingCondition", "buildingType"]),
  label: z.string().trim().min(1, "Label wajib diisi"),
});

export type AuditCategoryFormData = z.infer<typeof auditCategorySchema>;

// Field-audit form core fields (photos validated separately).
export const auditSubmissionSchema = z.object({
  occupancyStatus: z.enum(["occupied", "not_occupied"], {
    message: "Status hunian wajib dipilih",
  }),
  pltExists: z.boolean(),
  buildingConditionId: z.string().min(1, "Kondisi bangunan wajib dipilih"),
  buildingTypeId: z.string().min(1, "Tipe bangunan wajib dipilih"),
  remarks: z.string().trim().default(""),
});

export type AuditSubmissionFormData = z.infer<typeof auditSubmissionSchema>;

// Rejection requires a reason.
export const auditRejectionSchema = z.object({
  rejectionNote: z.string().trim().min(1, "Alasan penolakan wajib diisi"),
});

export type AuditRejectionFormData = z.infer<typeof auditRejectionSchema>;
