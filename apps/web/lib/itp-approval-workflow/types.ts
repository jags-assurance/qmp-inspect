// Domain type + table-name handle for `itp_approval_workflow_configs`
// (supabase/migrations/20260922060000_configurable_itp_approval_workflow.sql) — R79 configurable
// ITP review/approval workflow.
//
// This table isn't in the generated Database type yet — same documented cast pattern as
// apps/web/lib/numbering/types.ts and apps/web/lib/vault/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE = "itp_approval_workflow_configs" as any;

export interface ItpApprovalWorkflowConfigRow {
  id: string;
  organization_id: string;
  required_reviewer_user_id: string | null;
  required_approver_user_id: string | null;
  created_at: string;
  updated_at: string;
}
