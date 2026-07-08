import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ModuleKey } from "./modules";

interface WorkspaceState {
  activeWorkspace: ModuleKey | null;
  setActiveWorkspace: (key: ModuleKey | null) => void;
}

// Remembers the workspace the user last entered (mirrors the LMS exam-type-store
// persistence pattern) so returning users can be routed sensibly.
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeWorkspace: null,
      setActiveWorkspace: (key) => set({ activeWorkspace: key }),
    }),
    {
      name: "workspace-store",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
