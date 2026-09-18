// Hand-written to exactly match supabase/migrations as of Phase 1 (projects). Regenerate for real
// once a live Supabase project exists: `pnpm db:types` (supabase gen types typescript). Keep this
// file's shape in sync by hand only until then — every column here must match a migration file.

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          is_active: boolean;
          engagement_mode: "jags_led" | "co_branded" | "white_label";
          // Who does the inspection work, distinct from engagement_mode (branding only) — see
          // 20260918010000_self_managed_engagement_scope.sql.
          engagement_scope: "full_service" | "self_managed";
          ai_consent: boolean;
          branding_logo_path: string | null;
          // Per-org display override for the fixed burgundy/gold theme (see
          // 20260917060000_org_brand_colors.sql). Null means "use the default JAGS palette".
          brand_primary_color: string | null;
          brand_accent_color: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          is_active?: boolean;
          engagement_mode?: "jags_led" | "co_branded" | "white_label";
          engagement_scope?: "full_service" | "self_managed";
          ai_consent?: boolean;
          branding_logo_path?: string | null;
          brand_primary_color?: string | null;
          brand_accent_color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Insert"]>;
        Relationships: [];
      };
      organization_plans: {
        Row: {
          id: string;
          organization_id: string;
          plan_tier: "starter" | "professional" | "enterprise";
          seat_limit: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          plan_tier?: "starter" | "professional" | "enterprise";
          seat_limit?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organization_plans"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string | null;
          recipient_user_id: string;
          title: string;
          body: string | null;
          link: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id?: string | null;
          recipient_user_id: string;
          title: string;
          body?: string | null;
          link?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          is_jags_staff: boolean;
          staff_role: "admin" | "inspector" | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          is_jags_staff?: boolean;
          staff_role?: "admin" | "inspector" | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      access_grants: {
        Row: {
          id: string;
          user_id: string;
          scope_type: "global" | "organization" | "project";
          organization_id: string | null;
          project_id: string | null;
          role: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scope_type: "global" | "organization" | "project";
          organization_id?: string | null;
          project_id?: string | null;
          role: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["access_grants"]["Insert"]>;
        Relationships: [];
      };
      master_disciplines: {
        Row: {
          id: string;
          code: string;
          name: string;
          is_default: boolean;
          is_active: boolean;
          sort_order: number;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          is_default?: boolean;
          is_active?: boolean;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["master_disciplines"]["Insert"]>;
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          organization_id: string;
          project_number: string;
          name: string;
          contract_number: string | null;
          site_location: string | null;
          country: string | null;
          start_date: string | null;
          end_date: string | null;
          status: "draft" | "active" | "on_hold" | "completed" | "cancelled";
          created_by: string | null;
          created_at: string;
          updated_at: string;
          allow_client_execution: boolean;
          allow_client_itp_creation: boolean;
          responsible_person_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_number: string;
          name: string;
          contract_number?: string | null;
          site_location?: string | null;
          country?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          status?: "draft" | "active" | "on_hold" | "completed" | "cancelled";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          allow_client_execution?: boolean;
          allow_client_itp_creation?: boolean;
          responsible_person_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      project_parties: {
        Row: {
          id: string;
          project_id: string;
          party_type: "subcontractor" | "main_contractor" | "tpi_lab" | "vendor" | "client" | "jags";
          name: string;
          contact_name: string | null;
          contact_email: string | null;
          discipline_id: string | null;
          is_active: boolean;
          created_at: string;
          user_id: string | null;
          onboarded_by: "jags" | "client";
        };
        Insert: {
          id?: string;
          project_id: string;
          party_type: "subcontractor" | "main_contractor" | "tpi_lab" | "vendor" | "client" | "jags";
          name: string;
          contact_name?: string | null;
          contact_email?: string | null;
          discipline_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          user_id?: string | null;
          onboarded_by?: "jags" | "client";
        };
        Update: Partial<Database["public"]["Tables"]["project_parties"]["Insert"]>;
        Relationships: [];
      };
      teams: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["teams"]["Insert"]>;
        Relationships: [];
      };
      team_members: {
        Row: { team_id: string; user_id: string; is_team_lead: boolean; created_at: string };
        Insert: {
          team_id: string;
          user_id: string;
          is_team_lead?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_members"]["Insert"]>;
        Relationships: [];
      };
      team_project_assignments: {
        Row: { team_id: string; project_id: string; created_at: string };
        Insert: { team_id: string; project_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["team_project_assignments"]["Insert"]>;
        Relationships: [];
      };
      itps: {
        Row: {
          id: string;
          project_id: string;
          itp_number: string;
          title: string;
          scope: string | null;
          applicable_standard: string | null;
          revision: number;
          status: "draft" | "under_review" | "approved" | "client_accepted";
          prepared_by: string | null;
          reviewed_by: string | null;
          approved_by: string | null;
          client_accepted_by: string | null;
          client_accepted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          itp_number: string;
          title: string;
          scope?: string | null;
          applicable_standard?: string | null;
          revision?: number;
          status?: "draft" | "under_review" | "approved" | "client_accepted";
          prepared_by?: string | null;
          reviewed_by?: string | null;
          approved_by?: string | null;
          client_accepted_by?: string | null;
          client_accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["itps"]["Insert"]>;
        Relationships: [];
      };
      itp_sections: {
        Row: {
          id: string;
          itp_id: string;
          section_number: number;
          title: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          itp_id: string;
          section_number: number;
          title: string;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["itp_sections"]["Insert"]>;
        Relationships: [];
      };
      itp_items: {
        Row: {
          id: string;
          section_id: string;
          item_number: string;
          activity: string;
          reference_spec: string | null;
          acceptance_criteria: string | null;
          method: string | null;
          frequency: string | null;
          evidence_type: 1 | 2 | 3;
          sort_order: number;
          created_at: string;
          discipline_id: string | null;
        };
        Insert: {
          id?: string;
          section_id: string;
          item_number: string;
          activity: string;
          reference_spec?: string | null;
          acceptance_criteria?: string | null;
          method?: string | null;
          frequency?: string | null;
          evidence_type?: 1 | 2 | 3;
          sort_order?: number;
          created_at?: string;
          discipline_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["itp_items"]["Insert"]>;
        Relationships: [];
      };
      activity_party_intervention: {
        Row: {
          id: string;
          itp_item_id: string;
          project_party_id: string;
          intervention: string;
        };
        Insert: {
          id?: string;
          itp_item_id: string;
          project_party_id: string;
          intervention: string;
        };
        Update: Partial<Database["public"]["Tables"]["activity_party_intervention"]["Insert"]>;
        Relationships: [];
      };
      checklist_templates: {
        Row: { id: string; itp_item_id: string; checklist_number: string; name: string; created_at: string };
        Insert: {
          id?: string;
          itp_item_id: string;
          checklist_number: string;
          name: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["checklist_templates"]["Insert"]>;
        Relationships: [];
      };
      checklist_items: {
        Row: {
          id: string;
          template_id: string;
          item_number: string;
          description: string;
          is_mandatory: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          template_id: string;
          item_number: string;
          description: string;
          is_mandatory?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["checklist_items"]["Insert"]>;
        Relationships: [];
      };
      inspection_records: {
        Row: {
          id: string;
          project_id: string;
          itp_item_id: string;
          checklist_template_id: string | null;
          record_number: string;
          project_name: string;
          itp_number: string;
          activity: string;
          location: string | null;
          inspection_date: string;
          inspector_id: string | null;
          inspector_signature: string | null;
          overall_result: "pass" | "fail" | "partial" | null;
          notes: string | null;
          narrative: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          itp_item_id: string;
          checklist_template_id?: string | null;
          record_number: string;
          project_name: string;
          itp_number: string;
          activity: string;
          location?: string | null;
          inspection_date?: string;
          inspector_id?: string | null;
          inspector_signature?: string | null;
          overall_result?: "pass" | "fail" | "partial" | null;
          notes?: string | null;
          narrative?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["inspection_records"]["Insert"]>;
        Relationships: [];
      };
      checklist_responses: {
        Row: {
          id: string;
          inspection_record_id: string;
          checklist_item_id: string;
          result: "yes" | "no" | "na";
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          inspection_record_id: string;
          checklist_item_id: string;
          result: "yes" | "no" | "na";
          comment?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["checklist_responses"]["Insert"]>;
        Relationships: [];
      };
      inspection_photos: {
        Row: {
          id: string;
          inspection_record_id: string;
          storage_path: string;
          caption: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          inspection_record_id: string;
          storage_path: string;
          caption?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["inspection_photos"]["Insert"]>;
        Relationships: [];
      };
      irns: {
        Row: {
          id: string;
          inspection_record_id: string;
          irn_number: string;
          release_date: string;
          issued_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          inspection_record_id: string;
          irn_number: string;
          release_date?: string;
          issued_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["irns"]["Insert"]>;
        Relationships: [];
      };
      ncrs: {
        Row: {
          id: string;
          project_id: string;
          itp_item_id: string | null;
          inspection_record_id: string | null;
          ncr_number: string;
          severity: "observation" | "minor_ncr" | "major_ncr";
          description: string;
          requirement_not_met: string | null;
          status: "open" | "in_progress" | "pending_verification" | "closed";
          assigned_to: string | null;
          due_date: string | null;
          root_cause: string | null;
          corrective_action: string | null;
          preventive_action: string | null;
          verification_notes: string | null;
          raised_by: string | null;
          closed_by: string | null;
          closed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          itp_item_id?: string | null;
          inspection_record_id?: string | null;
          ncr_number: string;
          severity: "observation" | "minor_ncr" | "major_ncr";
          description: string;
          requirement_not_met?: string | null;
          status?: "open" | "in_progress" | "pending_verification" | "closed";
          assigned_to?: string | null;
          due_date?: string | null;
          root_cause?: string | null;
          corrective_action?: string | null;
          preventive_action?: string | null;
          verification_notes?: string | null;
          raised_by?: string | null;
          closed_by?: string | null;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ncrs"]["Insert"]>;
        Relationships: [];
      };
      standalone_assignments: {
        Row: {
          id: string;
          project_id: string;
          assignment_number: string;
          assignment_type: "fat" | "witness_inspection" | "specific_test" | "pre_shipment";
          equipment_description: string;
          manufacturer: string | null;
          model: string | null;
          serial_tag: string | null;
          location: string | null;
          standard_reference: string | null;
          assignment_date: string | null;
          status: "draft" | "completed";
          conclusion: "pass" | "conditional_pass" | "fail" | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          assignment_number: string;
          assignment_type: "fat" | "witness_inspection" | "specific_test" | "pre_shipment";
          equipment_description: string;
          manufacturer?: string | null;
          model?: string | null;
          serial_tag?: string | null;
          location?: string | null;
          standard_reference?: string | null;
          assignment_date?: string | null;
          status?: "draft" | "completed";
          conclusion?: "pass" | "conditional_pass" | "fail" | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["standalone_assignments"]["Insert"]>;
        Relationships: [];
      };
      standalone_assignment_measurements: {
        Row: {
          id: string;
          assignment_id: string;
          description: string;
          nominal_value: string | null;
          tolerance: string | null;
          actual_value: string | null;
          unit: string | null;
          result: "pass" | "fail" | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          assignment_id: string;
          description: string;
          nominal_value?: string | null;
          tolerance?: string | null;
          actual_value?: string | null;
          unit?: string | null;
          result?: "pass" | "fail" | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["standalone_assignment_measurements"]["Insert"]>;
        Relationships: [];
      };
      standalone_assignment_photos: {
        Row: {
          id: string;
          assignment_id: string;
          storage_path: string;
          caption: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          assignment_id: string;
          storage_path: string;
          caption?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["standalone_assignment_photos"]["Insert"]>;
        Relationships: [];
      };
      standalone_assignment_punch_items: {
        Row: { id: string; assignment_id: string; description: string; status: "open" | "closed"; created_at: string };
        Insert: {
          id?: string;
          assignment_id: string;
          description: string;
          status?: "open" | "closed";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["standalone_assignment_punch_items"]["Insert"]>;
        Relationships: [];
      };
      standalone_assignment_signatures: {
        Row: {
          id: string;
          assignment_id: string;
          role: string;
          signatory_name: string;
          signature_data: string;
          signed_at: string;
        };
        Insert: {
          id?: string;
          assignment_id: string;
          role: string;
          signatory_name: string;
          signature_data: string;
          signed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["standalone_assignment_signatures"]["Insert"]>;
        Relationships: [];
      };
      background_jobs: {
        Row: {
          id: string;
          job_type: "render_itp_pdf";
          payload: Record<string, unknown>;
          status: "pending" | "processing" | "completed" | "failed";
          result_storage_path: string | null;
          error_message: string | null;
          attempts: number;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          job_type: "render_itp_pdf";
          payload: Record<string, unknown>;
          status?: "pending" | "processing" | "completed" | "failed";
          result_storage_path?: string | null;
          error_message?: string | null;
          attempts?: number;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["background_jobs"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_jags_staff: { Args: Record<string, never>; Returns: boolean };
      has_org_access: { Args: { target_org_id: string }; Returns: boolean };
      accept_itp: { Args: { target_itp_id: string }; Returns: undefined };
      has_custom_permission: {
        Args: { target_user_id: string; target_permission_key: string; target_project_id: string | null };
        Returns: boolean;
      };
      insert_checklists_atomic: {
        Args: { templates: unknown };
        Returns: { id: string; itp_item_id: string }[];
      };
    };
    Enums: Record<string, never>;
  };
}
