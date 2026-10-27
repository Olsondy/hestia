import { z } from 'zod';

/** Workspace types are data (table workspace_types); code never assumes only personal/enterprise exist. */
export const workspaceKindSchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
export const workspaceRoleSchema = z.enum(['admin', 'member']);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export const workspaceSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/);

/** Trusted server/script input only. There is no public endpoint that creates a workspace. */
export const createWorkspaceSchema = z.object({
  kind: workspaceKindSchema, name: z.string().trim().min(1).max(120), slug: workspaceSlugSchema,
  adminEmail: z.string().trim().toLowerCase().email().max(254),
}).strict();
export const setMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254), role: workspaceRoleSchema,
}).strict();
export const updateMemberSchema = z.object({ role: workspaceRoleSchema }).strict();

export type WorkspaceView = {
  id: string; kind: string; name: string; slug: string | null; personal: boolean;
  role: WorkspaceRole; usagePolicy: 'member_credits' | 'unmetered'; maxMembers: number | null;
};
export type WorkspaceMember = { userId: string; name: string | null; email: string | null; role: WorkspaceRole; createdAt: string };
