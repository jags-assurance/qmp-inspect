export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_grants: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          project_id: string | null
          role: string
          scope_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          project_id?: string | null
          role: string
          scope_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          project_id?: string | null
          role?: string
          scope_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "access_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "access_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "access_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "access_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "access_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_expected_records: {
        Row: {
          created_at: string
          document_number: string | null
          id: string
          itp_item_id: string
          provider: string
          received_at: string | null
          record_type: string
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          document_number?: string | null
          id?: string
          itp_item_id: string
          provider: string
          received_at?: string | null
          record_type: string
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          document_number?: string | null
          id?: string
          itp_item_id?: string
          provider?: string
          received_at?: string | null
          record_type?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_expected_records_itp_item_id_fkey"
            columns: ["itp_item_id"]
            isOneToOne: false
            referencedRelation: "itp_items"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_party_intervention: {
        Row: {
          id: string
          intervention: string
          itp_item_id: string
          project_party_id: string
        }
        Insert: {
          id?: string
          intervention: string
          itp_item_id: string
          project_party_id: string
        }
        Update: {
          id?: string
          intervention?: string
          itp_item_id?: string
          project_party_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_party_intervention_itp_item_id_fkey"
            columns: ["itp_item_id"]
            isOneToOne: false
            referencedRelation: "itp_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_party_intervention_project_party_id_fkey"
            columns: ["project_party_id"]
            isOneToOne: false
            referencedRelation: "project_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_signoff_progress: {
        Row: {
          created_at: string
          id: string
          intervention: string
          itp_item_id: string
          notified_at: string | null
          proceeded_at: string | null
          proceeded_reason: string | null
          project_party_id: string
          signed_off_at: string | null
          signed_off_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          intervention: string
          itp_item_id: string
          notified_at?: string | null
          proceeded_at?: string | null
          proceeded_reason?: string | null
          project_party_id: string
          signed_off_at?: string | null
          signed_off_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          intervention?: string
          itp_item_id?: string
          notified_at?: string | null
          proceeded_at?: string | null
          proceeded_reason?: string | null
          project_party_id?: string
          signed_off_at?: string | null
          signed_off_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_signoff_progress_itp_item_id_fkey"
            columns: ["itp_item_id"]
            isOneToOne: false
            referencedRelation: "itp_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_signoff_progress_project_party_id_fkey"
            columns: ["project_party_id"]
            isOneToOne: false
            referencedRelation: "project_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_signoff_progress_signed_off_by_fkey"
            columns: ["signed_off_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_log: {
        Row: {
          ai_response: Json | null
          created_at: string
          decision: string | null
          feature: string
          id: string
          model_id: string | null
          organization_id: string
          prompt_version: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_response: Json | null
          source_ref: Json | null
          target_id: string | null
          target_type: string | null
          user_id: string | null
        }
        Insert: {
          ai_response?: Json | null
          created_at?: string
          decision?: string | null
          feature: string
          id?: string
          model_id?: string | null
          organization_id: string
          prompt_version?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_response?: Json | null
          source_ref?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Update: {
          ai_response?: Json | null
          created_at?: string
          decision?: string | null
          feature?: string
          id?: string
          model_id?: string | null
          organization_id?: string
          prompt_version?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_response?: Json | null
          source_ref?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          changes: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          organization_id: string
          project_id: string | null
          summary: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          organization_id: string
          project_id?: string | null
          summary: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          organization_id?: string
          project_id?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      background_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_type: string
          payload: Json
          result_storage_path: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type: string
          payload: Json
          result_storage_path?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type?: string
          payload?: Json
          result_storage_path?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      calibration_register: {
        Row: {
          cal_date: string | null
          cert_number: string
          created_at: string
          due_date: string
          id: string
          instrument_name: string
          notes: string | null
          project_id: string
          status: string
        }
        Insert: {
          cal_date?: string | null
          cert_number: string
          created_at?: string
          due_date: string
          id?: string
          instrument_name: string
          notes?: string | null
          project_id: string
          status?: string
        }
        Update: {
          cal_date?: string | null
          cert_number?: string
          created_at?: string
          due_date?: string
          id?: string
          instrument_name?: string
          notes?: string | null
          project_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "calibration_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "calibration_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "calibration_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "calibration_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "calibration_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          acceptance_criteria: string | null
          created_at: string
          description: string
          evidence_type: string | null
          id: string
          is_mandatory: boolean
          item_number: string
          sort_order: number
          template_id: string
        }
        Insert: {
          acceptance_criteria?: string | null
          created_at?: string
          description: string
          evidence_type?: string | null
          id?: string
          is_mandatory?: boolean
          item_number: string
          sort_order?: number
          template_id: string
        }
        Update: {
          acceptance_criteria?: string | null
          created_at?: string
          description?: string
          evidence_type?: string | null
          id?: string
          is_mandatory?: boolean
          item_number?: string
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_library_items: {
        Row: {
          acceptance_criteria: string | null
          created_at: string
          description: string
          evidence_type: string | null
          id: string
          is_mandatory: boolean
          item_number: string
          library_template_id: string
          sort_order: number
        }
        Insert: {
          acceptance_criteria?: string | null
          created_at?: string
          description: string
          evidence_type?: string | null
          id?: string
          is_mandatory?: boolean
          item_number: string
          library_template_id: string
          sort_order?: number
        }
        Update: {
          acceptance_criteria?: string | null
          created_at?: string
          description?: string
          evidence_type?: string | null
          id?: string
          is_mandatory?: boolean
          item_number?: string
          library_template_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "checklist_library_items_library_template_id_fkey"
            columns: ["library_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_library_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_library_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          discipline_id: string | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          discipline_id?: string | null
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          discipline_id?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_library_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_library_templates_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "master_disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_responses: {
        Row: {
          calibration_asset_id: string | null
          checklist_item_id: string
          comment: string | null
          created_at: string
          id: string
          inspection_record_id: string
          result: string
        }
        Insert: {
          calibration_asset_id?: string | null
          checklist_item_id: string
          comment?: string | null
          created_at?: string
          id?: string
          inspection_record_id: string
          result: string
        }
        Update: {
          calibration_asset_id?: string | null
          checklist_item_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          inspection_record_id?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_responses_calibration_asset_id_fkey"
            columns: ["calibration_asset_id"]
            isOneToOne: false
            referencedRelation: "calibration_register"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_responses_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_responses_inspection_record_id_fkey"
            columns: ["inspection_record_id"]
            isOneToOne: false
            referencedRelation: "inspection_records"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          checklist_number: string
          created_at: string
          id: string
          itp_item_id: string
          name: string
        }
        Insert: {
          checklist_number: string
          created_at?: string
          id?: string
          itp_item_id: string
          name: string
        }
        Update: {
          checklist_number?: string
          created_at?: string
          id?: string
          itp_item_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_itp_item_id_fkey"
            columns: ["itp_item_id"]
            isOneToOne: true
            referencedRelation: "itp_items"
            referencedColumns: ["id"]
          },
        ]
      }
      client_team_members: {
        Row: {
          client_team_id: string
          created_at: string
          is_team_lead: boolean
          user_id: string
        }
        Insert: {
          client_team_id: string
          created_at?: string
          is_team_lead?: boolean
          user_id: string
        }
        Update: {
          client_team_id?: string
          created_at?: string
          is_team_lead?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_team_members_client_team_id_fkey"
            columns: ["client_team_id"]
            isOneToOne: false
            referencedRelation: "client_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_team_project_assignments: {
        Row: {
          client_team_id: string
          created_at: string
          project_id: string
        }
        Insert: {
          client_team_id: string
          created_at?: string
          project_id: string
        }
        Update: {
          client_team_id?: string
          created_at?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_team_project_assignments_client_team_id_fkey"
            columns: ["client_team_id"]
            isOneToOne: false
            referencedRelation: "client_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "client_team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "client_team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "client_team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "client_team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      client_teams: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_folder_sync_configs: {
        Row: {
          connected_at: string
          connected_by: string | null
          created_at: string
          folder_reference: string
          id: string
          organization_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          folder_reference: string
          id?: string
          organization_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          folder_reference?: string
          id?: string
          organization_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_folder_sync_configs_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_folder_sync_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_role_assignments: {
        Row: {
          created_at: string
          id: string
          project_id: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_role_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_role_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "custom_role_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "custom_role_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "custom_role_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "custom_role_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "custom_role_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_role_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_role_permissions: {
        Row: {
          permission_key: string
          role_id: string
        }
        Insert: {
          permission_key: string
          role_id: string
        }
        Update: {
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_roles: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_books: {
        Row: {
          book_number: string
          compiled_at: string | null
          compiled_by: string | null
          created_at: string
          id: string
          override_by: string | null
          override_items: Json | null
          override_open_punch_items: boolean
          override_reason: string | null
          project_id: string
          status: string
          title: string
        }
        Insert: {
          book_number: string
          compiled_at?: string | null
          compiled_by?: string | null
          created_at?: string
          id?: string
          override_by?: string | null
          override_items?: Json | null
          override_open_punch_items?: boolean
          override_reason?: string | null
          project_id: string
          status?: string
          title: string
        }
        Update: {
          book_number?: string
          compiled_at?: string | null
          compiled_by?: string | null
          created_at?: string
          id?: string
          override_by?: string | null
          override_items?: Json | null
          override_open_punch_items?: boolean
          override_reason?: string | null
          project_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_books_compiled_by_fkey"
            columns: ["compiled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_books_override_by_fkey"
            columns: ["override_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_books_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_books_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "data_books_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "data_books_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "data_books_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "data_books_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          current_number: number
          doc_type: string
          id: string
          organization_id: string
          project_id: string | null
          updated_at: string
        }
        Insert: {
          current_number?: number
          doc_type: string
          id?: string
          organization_id: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          current_number?: number
          doc_type?: string
          id?: string
          organization_id?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_sequences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_sequences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "document_sequences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "document_sequences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "document_sequences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "document_sequences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      drawing_markups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          linked_entity_id: string | null
          markup_type: string
          project_id: string
          vault_document_id: string
          x: number
          y: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          linked_entity_id?: string | null
          markup_type?: string
          project_id: string
          vault_document_id: string
          x: number
          y: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          linked_entity_id?: string | null
          markup_type?: string
          project_id?: string
          vault_document_id?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "drawing_markups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_markups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_markups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "drawing_markups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "drawing_markups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "drawing_markups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "drawing_markups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "drawing_markups_vault_document_id_fkey"
            columns: ["vault_document_id"]
            isOneToOne: false
            referencedRelation: "vault_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_certificates: {
        Row: {
          acknowledged_at: string | null
          certificate_number: string
          conditional_open_items: Json | null
          conditional_reason: string | null
          created_at: string
          data_book_id: string
          id: string
          is_conditional: boolean
          issued_by: string | null
          issued_date: string
          package_sha256: string | null
          package_storage_path: string | null
          received_by_company: string | null
          received_by_name: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          certificate_number: string
          conditional_open_items?: Json | null
          conditional_reason?: string | null
          created_at?: string
          data_book_id: string
          id?: string
          is_conditional?: boolean
          issued_by?: string | null
          issued_date?: string
          package_sha256?: string | null
          package_storage_path?: string | null
          received_by_company?: string | null
          received_by_name?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          certificate_number?: string
          conditional_open_items?: Json | null
          conditional_reason?: string | null
          created_at?: string
          data_book_id?: string
          id?: string
          is_conditional?: boolean
          issued_by?: string | null
          issued_date?: string
          package_sha256?: string | null
          package_storage_path?: string | null
          received_by_company?: string | null
          received_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handover_certificates_data_book_id_fkey"
            columns: ["data_book_id"]
            isOneToOne: true
            referencedRelation: "data_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_certificates_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_photos: {
        Row: {
          caption: string | null
          checklist_item_id: string | null
          created_at: string
          id: string
          inspection_record_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          checklist_item_id?: string | null
          created_at?: string
          id?: string
          inspection_record_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          checklist_item_id?: string | null
          created_at?: string
          id?: string
          inspection_record_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_photos_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_photos_inspection_record_id_fkey"
            columns: ["inspection_record_id"]
            isOneToOne: false
            referencedRelation: "inspection_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_records: {
        Row: {
          activity: string
          applicable_standard: string | null
          checklist_template_id: string | null
          client_name: string | null
          created_at: string
          governing_drawing_reference: string | null
          governing_drawing_revision: string | null
          id: string
          inspection_date: string
          inspector_id: string | null
          inspector_signature: string | null
          itp_item_id: string
          itp_number: string
          location: string | null
          narrative: string | null
          notes: string | null
          overall_result: string | null
          project_id: string
          project_name: string
          record_number: string
        }
        Insert: {
          activity: string
          applicable_standard?: string | null
          checklist_template_id?: string | null
          client_name?: string | null
          created_at?: string
          governing_drawing_reference?: string | null
          governing_drawing_revision?: string | null
          id?: string
          inspection_date?: string
          inspector_id?: string | null
          inspector_signature?: string | null
          itp_item_id: string
          itp_number: string
          location?: string | null
          narrative?: string | null
          notes?: string | null
          overall_result?: string | null
          project_id: string
          project_name: string
          record_number: string
        }
        Update: {
          activity?: string
          applicable_standard?: string | null
          checklist_template_id?: string | null
          client_name?: string | null
          created_at?: string
          governing_drawing_reference?: string | null
          governing_drawing_revision?: string | null
          id?: string
          inspection_date?: string
          inspector_id?: string | null
          inspector_signature?: string | null
          itp_item_id?: string
          itp_number?: string
          location?: string | null
          narrative?: string | null
          notes?: string | null
          overall_result?: string | null
          project_id?: string
          project_name?: string
          record_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_records_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_records_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_records_itp_item_id_fkey"
            columns: ["itp_item_id"]
            isOneToOne: false
            referencedRelation: "itp_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "inspection_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "inspection_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "inspection_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "inspection_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      intervention_level_types: {
        Row: {
          code: string
          created_at: string
          default_notice_hours: number | null
          id: string
          is_blocking: boolean
          label: string
          organization_id: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          default_notice_hours?: number | null
          id?: string
          is_blocking?: boolean
          label: string
          organization_id: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          default_notice_hours?: number | null
          id?: string
          is_blocking?: boolean
          label?: string
          organization_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "intervention_level_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      irns: {
        Row: {
          created_at: string
          id: string
          inspection_record_id: string
          irn_number: string
          issued_by: string | null
          release_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          inspection_record_id: string
          irn_number: string
          issued_by?: string | null
          release_date?: string
        }
        Update: {
          created_at?: string
          id?: string
          inspection_record_id?: string
          irn_number?: string
          issued_by?: string | null
          release_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "irns_inspection_record_id_fkey"
            columns: ["inspection_record_id"]
            isOneToOne: true
            referencedRelation: "inspection_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      itp_approval_workflow_configs: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          required_approver_user_id: string | null
          required_reviewer_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          required_approver_user_id?: string | null
          required_reviewer_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          required_approver_user_id?: string | null
          required_reviewer_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itp_approval_workflow_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_approval_workflow_configs_required_approver_user_id_fkey"
            columns: ["required_approver_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_approval_workflow_configs_required_reviewer_user_id_fkey"
            columns: ["required_reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      itp_items: {
        Row: {
          acceptance_criteria: string | null
          activity: string
          created_at: string
          discipline_id: string | null
          evidence_type: number
          frequency: string | null
          governing_drawing_document_id: string | null
          id: string
          item_number: string
          method: string | null
          reference_spec: string | null
          section_id: string
          sort_order: number
        }
        Insert: {
          acceptance_criteria?: string | null
          activity: string
          created_at?: string
          discipline_id?: string | null
          evidence_type?: number
          frequency?: string | null
          governing_drawing_document_id?: string | null
          id?: string
          item_number: string
          method?: string | null
          reference_spec?: string | null
          section_id: string
          sort_order?: number
        }
        Update: {
          acceptance_criteria?: string | null
          activity?: string
          created_at?: string
          discipline_id?: string | null
          evidence_type?: number
          frequency?: string | null
          governing_drawing_document_id?: string | null
          id?: string
          item_number?: string
          method?: string | null
          reference_spec?: string | null
          section_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "itp_items_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "master_disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_items_governing_drawing_document_id_fkey"
            columns: ["governing_drawing_document_id"]
            isOneToOne: false
            referencedRelation: "vault_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "itp_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      itp_master_items: {
        Row: {
          acceptance_criteria: string | null
          activity: string
          evidence_type: number
          frequency: string | null
          id: string
          item_number: string
          method: string | null
          reference_spec: string | null
          section_id: string
          sort_order: number
        }
        Insert: {
          acceptance_criteria?: string | null
          activity: string
          evidence_type?: number
          frequency?: string | null
          id?: string
          item_number: string
          method?: string | null
          reference_spec?: string | null
          section_id: string
          sort_order?: number
        }
        Update: {
          acceptance_criteria?: string | null
          activity?: string
          evidence_type?: number
          frequency?: string | null
          id?: string
          item_number?: string
          method?: string | null
          reference_spec?: string | null
          section_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "itp_master_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "itp_master_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      itp_master_proposals: {
        Row: {
          created_at: string
          id: string
          proposal_notes: string | null
          proposed_action: string
          proposed_by: string | null
          proposed_title: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_itp_id: string
          status: string
          target_template_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          proposal_notes?: string | null
          proposed_action: string
          proposed_by?: string | null
          proposed_title?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_itp_id: string
          status?: string
          target_template_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          proposal_notes?: string | null
          proposed_action?: string
          proposed_by?: string | null
          proposed_title?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_itp_id?: string
          status?: string
          target_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itp_master_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_master_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_master_proposals_source_itp_id_fkey"
            columns: ["source_itp_id"]
            isOneToOne: false
            referencedRelation: "itps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_master_proposals_target_template_id_fkey"
            columns: ["target_template_id"]
            isOneToOne: false
            referencedRelation: "itp_master_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      itp_master_sections: {
        Row: {
          id: string
          section_number: number
          sort_order: number
          template_id: string
          title: string
        }
        Insert: {
          id?: string
          section_number: number
          sort_order?: number
          template_id: string
          title: string
        }
        Update: {
          id?: string
          section_number?: number
          sort_order?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "itp_master_sections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "itp_master_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      itp_master_templates: {
        Row: {
          applicable_standard: string | null
          created_at: string
          created_by: string | null
          discipline_id: string | null
          id: string
          industry: string
          is_active: boolean
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          applicable_standard?: string | null
          created_at?: string
          created_by?: string | null
          discipline_id?: string | null
          id?: string
          industry: string
          is_active?: boolean
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          applicable_standard?: string | null
          created_at?: string
          created_by?: string | null
          discipline_id?: string | null
          id?: string
          industry?: string
          is_active?: boolean
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "itp_master_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_master_templates_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "master_disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      itp_revisions: {
        Row: {
          applicable_standard: string | null
          created_at: string
          created_by: string | null
          id: string
          itp_id: string
          reason: string | null
          revision: number
          scope: string | null
          sections_snapshot: Json
          title: string
        }
        Insert: {
          applicable_standard?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          itp_id: string
          reason?: string | null
          revision: number
          scope?: string | null
          sections_snapshot: Json
          title: string
        }
        Update: {
          applicable_standard?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          itp_id?: string
          reason?: string | null
          revision?: number
          scope?: string | null
          sections_snapshot?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "itp_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itp_revisions_itp_id_fkey"
            columns: ["itp_id"]
            isOneToOne: false
            referencedRelation: "itps"
            referencedColumns: ["id"]
          },
        ]
      }
      itp_sections: {
        Row: {
          id: string
          itp_id: string
          section_number: number
          sort_order: number
          title: string
        }
        Insert: {
          id?: string
          itp_id: string
          section_number: number
          sort_order?: number
          title: string
        }
        Update: {
          id?: string
          itp_id?: string
          section_number?: number
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "itp_sections_itp_id_fkey"
            columns: ["itp_id"]
            isOneToOne: false
            referencedRelation: "itps"
            referencedColumns: ["id"]
          },
        ]
      }
      itps: {
        Row: {
          applicable_standard: string | null
          approved_at: string | null
          approved_by: string | null
          client_accepted_at: string | null
          client_accepted_by: string | null
          created_at: string
          external_approval_recorded_at: string | null
          external_approval_recorded_by: string | null
          external_approval_reference: string | null
          id: string
          itp_number: string
          prepared_by: string | null
          project_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          revision: number
          scope: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          applicable_standard?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_accepted_at?: string | null
          client_accepted_by?: string | null
          created_at?: string
          external_approval_recorded_at?: string | null
          external_approval_recorded_by?: string | null
          external_approval_reference?: string | null
          id?: string
          itp_number: string
          prepared_by?: string | null
          project_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          scope?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          applicable_standard?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_accepted_at?: string | null
          client_accepted_by?: string | null
          created_at?: string
          external_approval_recorded_at?: string | null
          external_approval_recorded_by?: string | null
          external_approval_reference?: string | null
          id?: string
          itp_number?: string
          prepared_by?: string | null
          project_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          scope?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itps_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itps_client_accepted_by_fkey"
            columns: ["client_accepted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itps_external_approval_recorded_by_fkey"
            columns: ["external_approval_recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itps_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "itps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "itps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "itps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "itps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "itps_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      master_disciplines: {
        Row: {
          code: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      material_register: {
        Row: {
          approval_status: string
          approved_date: string | null
          batch_number: string | null
          certificate_reference: string | null
          created_at: string
          disposition_notes: string | null
          heat_number: string | null
          id: string
          material_description: string
          notes: string | null
          po_reference: string | null
          project_id: string
          receipt_status: string
          submittal_reference: string | null
        }
        Insert: {
          approval_status: string
          approved_date?: string | null
          batch_number?: string | null
          certificate_reference?: string | null
          created_at?: string
          disposition_notes?: string | null
          heat_number?: string | null
          id?: string
          material_description: string
          notes?: string | null
          po_reference?: string | null
          project_id: string
          receipt_status?: string
          submittal_reference?: string | null
        }
        Update: {
          approval_status?: string
          approved_date?: string | null
          batch_number?: string | null
          certificate_reference?: string | null
          created_at?: string
          disposition_notes?: string | null
          heat_number?: string | null
          id?: string
          material_description?: string
          notes?: string | null
          po_reference?: string | null
          project_id?: string
          receipt_status?: string
          submittal_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "material_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "material_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "material_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "material_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      ncr_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          ncr_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          ncr_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          ncr_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ncr_photos_ncr_id_fkey"
            columns: ["ncr_id"]
            isOneToOne: false
            referencedRelation: "ncrs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncr_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ncrs: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          closed_by: string | null
          corrective_action: string | null
          created_at: string
          description: string
          due_date: string | null
          id: string
          inspection_record_id: string | null
          itp_item_id: string | null
          ncr_number: string
          preventive_action: string | null
          project_id: string
          raised_by: string | null
          requirement_not_met: string | null
          root_cause: string | null
          severity: string
          status: string
          updated_at: string
          verification_notes: string | null
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          closed_by?: string | null
          corrective_action?: string | null
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          inspection_record_id?: string | null
          itp_item_id?: string | null
          ncr_number: string
          preventive_action?: string | null
          project_id: string
          raised_by?: string | null
          requirement_not_met?: string | null
          root_cause?: string | null
          severity: string
          status?: string
          updated_at?: string
          verification_notes?: string | null
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          closed_by?: string | null
          corrective_action?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          inspection_record_id?: string | null
          itp_item_id?: string | null
          ncr_number?: string
          preventive_action?: string | null
          project_id?: string
          raised_by?: string | null
          requirement_not_met?: string | null
          root_cause?: string | null
          severity?: string
          status?: string
          updated_at?: string
          verification_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ncrs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_inspection_record_id_fkey"
            columns: ["inspection_record_id"]
            isOneToOne: false
            referencedRelation: "inspection_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_itp_item_id_fkey"
            columns: ["itp_item_id"]
            isOneToOne: false
            referencedRelation: "itp_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_period_configs: {
        Row: {
          hours: number
          id: string
          intervention: string
          project_id: string
        }
        Insert: {
          hours: number
          id?: string
          intervention: string
          project_id: string
        }
        Update: {
          hours?: number
          id?: string
          intervention?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_period_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_period_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notice_period_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notice_period_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notice_period_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notice_period_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          organization_id: string
          project_id: string | null
          recipient_user_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          organization_id: string
          project_id?: string | null
          recipient_user_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          organization_id?: string
          project_id?: string | null
          recipient_user_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      numbering_configs: {
        Row: {
          client_code: string
          created_at: string
          doc_type: string
          id: string
          include_year: boolean
          organization_id: string
          originator_code: string
          project_id: string | null
          separator: string
          sequence_padding: number
          updated_at: string
        }
        Insert: {
          client_code: string
          created_at?: string
          doc_type: string
          id?: string
          include_year?: boolean
          organization_id: string
          originator_code?: string
          project_id?: string | null
          separator?: string
          sequence_padding?: number
          updated_at?: string
        }
        Update: {
          client_code?: string
          created_at?: string
          doc_type?: string
          id?: string
          include_year?: boolean
          organization_id?: string
          originator_code?: string
          project_id?: string | null
          separator?: string
          sequence_padding?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "numbering_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "numbering_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "numbering_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "numbering_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "numbering_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "numbering_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "numbering_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      organization_module_licenses: {
        Row: {
          created_at: string
          id: string
          is_licensed: boolean
          module_key: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_licensed?: boolean
          module_key: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_licensed?: boolean
          module_key?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_module_licenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_plans: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          plan_tier: string
          seat_limit: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          plan_tier?: string
          seat_limit?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          plan_tier?: string
          seat_limit?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_consent: boolean
          brand_accent_color: string | null
          brand_primary_color: string | null
          branding_logo_path: string | null
          created_at: string
          engagement_mode: string
          engagement_scope: string
          id: string
          is_active: boolean
          itp_sequencing_mode: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          ai_consent?: boolean
          brand_accent_color?: string | null
          brand_primary_color?: string | null
          branding_logo_path?: string | null
          created_at?: string
          engagement_mode?: string
          engagement_scope?: string
          id?: string
          is_active?: boolean
          itp_sequencing_mode?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          ai_consent?: boolean
          brand_accent_color?: string | null
          brand_primary_color?: string | null
          branding_logo_path?: string | null
          created_at?: string
          engagement_mode?: string
          engagement_scope?: string
          id?: string
          is_active?: boolean
          itp_sequencing_mode?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      personnel_certifications: {
        Row: {
          cert_number: string | null
          certification_type: string
          created_at: string
          expiry_date: string
          id: string
          issued_date: string | null
          notes: string | null
          project_id: string
          project_party_id: string
          status: string
        }
        Insert: {
          cert_number?: string | null
          certification_type: string
          created_at?: string
          expiry_date: string
          id?: string
          issued_date?: string | null
          notes?: string | null
          project_id: string
          project_party_id: string
          status?: string
        }
        Update: {
          cert_number?: string | null
          certification_type?: string
          created_at?: string
          expiry_date?: string
          id?: string
          issued_date?: string | null
          notes?: string | null
          project_id?: string
          project_party_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "personnel_certifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_certifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "personnel_certifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "personnel_certifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "personnel_certifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "personnel_certifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "personnel_certifications_project_party_id_fkey"
            columns: ["project_party_id"]
            isOneToOne: false
            referencedRelation: "project_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      project_parties: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          created_at: string
          discipline_id: string | null
          id: string
          is_active: boolean
          name: string
          onboarded_by: string
          party_type: string
          project_id: string
          user_id: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          discipline_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          onboarded_by?: string
          party_type: string
          project_id: string
          user_id?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          discipline_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          onboarded_by?: string
          party_type?: string
          project_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_parties_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "master_disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_parties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_parties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_parties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_parties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_parties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_parties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_parties_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          allow_client_execution: boolean
          allow_client_itp_creation: boolean
          allow_contractor_itp_creation: boolean
          contract_number: string | null
          country: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          enforce_hold_blocks_start: boolean
          id: string
          name: string
          organization_id: string
          project_number: string
          responsible_person_id: string | null
          site_location: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          allow_client_execution?: boolean
          allow_client_itp_creation?: boolean
          allow_contractor_itp_creation?: boolean
          contract_number?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          enforce_hold_blocks_start?: boolean
          id?: string
          name: string
          organization_id: string
          project_number: string
          responsible_person_id?: string | null
          site_location?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          allow_client_execution?: boolean
          allow_client_itp_creation?: boolean
          allow_contractor_itp_creation?: boolean
          contract_number?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          enforce_hold_blocks_start?: boolean
          id?: string
          name?: string
          organization_id?: string
          project_number?: string
          responsible_person_id?: string | null
          site_location?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_responsible_person_id_fkey"
            columns: ["responsible_person_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_list_items: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_evidence: string | null
          created_at: string
          description: string
          due_date: string | null
          id: string
          location: string | null
          project_id: string
          responsible_party_id: string | null
          source: string
          source_inspection_record_id: string | null
          source_ncr_id: string | null
          source_standalone_assignment_id: string | null
          status: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_evidence?: string | null
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          location?: string | null
          project_id: string
          responsible_party_id?: string | null
          source: string
          source_inspection_record_id?: string | null
          source_ncr_id?: string | null
          source_standalone_assignment_id?: string | null
          status?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_evidence?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          location?: string | null
          project_id?: string
          responsible_party_id?: string | null
          source?: string
          source_inspection_record_id?: string | null
          source_ncr_id?: string | null
          source_standalone_assignment_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "punch_list_items_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "punch_list_items_responsible_party_id_fkey"
            columns: ["responsible_party_id"]
            isOneToOne: false
            referencedRelation: "project_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_list_items_source_inspection_record_id_fkey"
            columns: ["source_inspection_record_id"]
            isOneToOne: false
            referencedRelation: "inspection_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_list_items_source_ncr_id_fkey"
            columns: ["source_ncr_id"]
            isOneToOne: false
            referencedRelation: "ncrs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_list_items_source_standalone_assignment_id_fkey"
            columns: ["source_standalone_assignment_id"]
            isOneToOne: false
            referencedRelation: "standalone_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      standalone_assignment_measurements: {
        Row: {
          actual_value: string | null
          assignment_id: string
          created_at: string
          description: string
          id: string
          nominal_value: string | null
          result: string | null
          sort_order: number
          tolerance: string | null
          unit: string | null
        }
        Insert: {
          actual_value?: string | null
          assignment_id: string
          created_at?: string
          description: string
          id?: string
          nominal_value?: string | null
          result?: string | null
          sort_order?: number
          tolerance?: string | null
          unit?: string | null
        }
        Update: {
          actual_value?: string | null
          assignment_id?: string
          created_at?: string
          description?: string
          id?: string
          nominal_value?: string | null
          result?: string | null
          sort_order?: number
          tolerance?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "standalone_assignment_measurements_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "standalone_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      standalone_assignment_photos: {
        Row: {
          assignment_id: string
          caption: string | null
          created_at: string
          id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          assignment_id: string
          caption?: string | null
          created_at?: string
          id?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          assignment_id?: string
          caption?: string | null
          created_at?: string
          id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "standalone_assignment_photos_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "standalone_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_assignment_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      standalone_assignment_punch_items: {
        Row: {
          assignment_id: string
          created_at: string
          description: string
          id: string
          status: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          description: string
          id?: string
          status?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          description?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "standalone_assignment_punch_items_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "standalone_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      standalone_assignment_signatures: {
        Row: {
          assignment_id: string
          id: string
          role: string
          signatory_name: string
          signature_data: string
          signed_at: string
        }
        Insert: {
          assignment_id: string
          id?: string
          role: string
          signatory_name: string
          signature_data: string
          signed_at?: string
        }
        Update: {
          assignment_id?: string
          id?: string
          role?: string
          signatory_name?: string
          signature_data?: string
          signed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "standalone_assignment_signatures_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "standalone_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      standalone_assignments: {
        Row: {
          assignment_date: string | null
          assignment_number: string
          assignment_type: string
          cleared_at: string | null
          cleared_by: string | null
          completed_at: string | null
          conclusion: string | null
          created_at: string
          created_by: string | null
          discipline_id: string | null
          equipment_description: string
          id: string
          location: string | null
          manufacturer: string | null
          model: string | null
          narrative: string | null
          notes: string | null
          project_id: string
          serial_tag: string | null
          standard_reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assignment_date?: string | null
          assignment_number: string
          assignment_type: string
          cleared_at?: string | null
          cleared_by?: string | null
          completed_at?: string | null
          conclusion?: string | null
          created_at?: string
          created_by?: string | null
          discipline_id?: string | null
          equipment_description: string
          id?: string
          location?: string | null
          manufacturer?: string | null
          model?: string | null
          narrative?: string | null
          notes?: string | null
          project_id: string
          serial_tag?: string | null
          standard_reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assignment_date?: string | null
          assignment_number?: string
          assignment_type?: string
          cleared_at?: string | null
          cleared_by?: string | null
          completed_at?: string | null
          conclusion?: string | null
          created_at?: string
          created_by?: string | null
          discipline_id?: string | null
          equipment_description?: string
          id?: string
          location?: string | null
          manufacturer?: string | null
          model?: string | null
          narrative?: string | null
          notes?: string | null
          project_id?: string
          serial_tag?: string | null
          standard_reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "standalone_assignments_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_assignments_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "master_disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "standalone_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "standalone_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "standalone_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "standalone_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          is_team_lead: boolean
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_team_lead?: boolean
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_team_lead?: boolean
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      team_project_assignments: {
        Row: {
          created_at: string
          project_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "team_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "team_project_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          is_jags_staff: boolean
          staff_role: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          is_jags_staff?: boolean
          staff_role?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          is_jags_staff?: boolean
          staff_role?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      vault_documents: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          document_date: string | null
          document_number: string | null
          document_reference: string | null
          extracted_text: string | null
          extraction_error: string | null
          extraction_status: string
          file_size: number | null
          folder_id: string
          id: string
          internal_reference: string | null
          notes: string | null
          revision: string
          status: string
          storage_path: string
          superseded_by: string | null
          title: string
          uploaded_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          document_date?: string | null
          document_number?: string | null
          document_reference?: string | null
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_status?: string
          file_size?: number | null
          folder_id: string
          id?: string
          internal_reference?: string | null
          notes?: string | null
          revision?: string
          status?: string
          storage_path: string
          superseded_by?: string | null
          title: string
          uploaded_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          document_date?: string | null
          document_number?: string | null
          document_reference?: string | null
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_status?: string
          file_size?: number | null
          folder_id?: string
          id?: string
          internal_reference?: string | null
          notes?: string | null
          revision?: string
          status?: string
          storage_path?: string
          superseded_by?: string | null
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_documents_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "vault_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_folders: {
        Row: {
          created_at: string
          folder_key: string
          id: string
          name: string
          project_id: string
        }
        Insert: {
          created_at?: string
          folder_key: string
          id?: string
          name: string
          project_id: string
        }
        Update: {
          created_at?: string
          folder_key?: string
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "vault_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "vault_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "vault_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "vault_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
      welder_qualification_register: {
        Row: {
          created_at: string
          expiry_date: string
          id: string
          notes: string | null
          project_id: string
          qualified_ranges: string | null
          qualified_wps: string
          status: string
          welder_identifier: string
        }
        Insert: {
          created_at?: string
          expiry_date: string
          id?: string
          notes?: string | null
          project_id: string
          qualified_ranges?: string | null
          qualified_wps: string
          status?: string
          welder_identifier: string
        }
        Update: {
          created_at?: string
          expiry_date?: string
          id?: string
          notes?: string | null
          project_id?: string
          qualified_ranges?: string | null
          qualified_wps?: string
          status?: string
          welder_identifier?: string
        }
        Relationships: [
          {
            foreignKeyName: "welder_qualification_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welder_qualification_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "welder_qualification_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "welder_qualification_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "welder_qualification_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "welder_qualification_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
        ]
      }
    }
    Views: {
      vw_powerbi_first_time_pass_rate: {
        Row: {
          first_attempts: number | null
          first_time_pass_rate_pct: number | null
          first_time_passes: number | null
          organization_id: string | null
          project_id: string | null
          project_name: string | null
          project_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_powerbi_hold_point_turnaround: {
        Row: {
          avg_hold_point_turnaround_hours: number | null
          hold_points_measured: number | null
          organization_id: string | null
          project_id: string | null
          project_name: string | null
          project_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_powerbi_inspections_completed_vs_planned: {
        Row: {
          inspections_completed: number | null
          inspections_planned: number | null
          organization_id: string | null
          project_id: string | null
          project_name: string | null
          project_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_powerbi_itp_completion: {
        Row: {
          client_accepted_itps: number | null
          itp_completion_pct: number | null
          organization_id: string | null
          project_id: string | null
          project_name: string | null
          project_number: string | null
          total_itps: number | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_powerbi_ncr_trends: {
        Row: {
          avg_close_out_hours: number | null
          ncr_count: number | null
          ncr_month: string | null
          organization_id: string | null
          project_id: string | null
          project_name: string | null
          project_number: string | null
          severity: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_first_time_pass_rate"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_hold_point_turnaround"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_inspections_completed_vs_planned"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_itp_completion"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vw_powerbi_punch_list_and_fat"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_powerbi_punch_list_and_fat: {
        Row: {
          closed_punch_items: number | null
          fat_conditional_pass_count: number | null
          fat_fail_count: number | null
          fat_pass_count: number | null
          open_punch_items: number | null
          organization_id: string | null
          project_id: string | null
          project_name: string | null
          project_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_itp: { Args: { target_itp_id: string }; Returns: undefined }
      acknowledge_handover: {
        Args: {
          received_company: string
          received_name: string
          target_certificate_id: string
        }
        Returns: undefined
      }
      background_jobs_resolve_org_id: {
        Args: { p_job_type: string; p_payload: Json }
        Returns: string
      }
      can_bootstrap_client_team: {
        Args: { target_org_id: string }
        Returns: boolean
      }
      can_bootstrap_client_team_members: {
        Args: { target_client_team_id: string }
        Returns: boolean
      }
      has_custom_permission: {
        Args: {
          target_permission_key: string
          target_project_id?: string
          target_user_id: string
        }
        Returns: boolean
      }
      has_org_access: { Args: { target_org_id: string }; Returns: boolean }
      has_project_access: {
        Args: { target_org_id: string; target_project_id: string }
        Returns: boolean
      }
      insert_checklists_atomic: {
        Args: { templates: Json }
        Returns: {
          id: string
          itp_item_id: string
        }[]
      }
      is_admin_staff: { Args: never; Returns: boolean }
      is_client_checklist_generator: {
        Args: { itp_status: string; target_project_id: string }
        Returns: boolean
      }
      is_client_itp_creator: {
        Args: { itp_status?: string; target_project_id: string }
        Returns: boolean
      }
      is_client_team_lead_of: {
        Args: { target_client_team_id: string }
        Returns: boolean
      }
      is_jags_staff: { Args: never; Returns: boolean }
      is_team_lead_of: { Args: { target_team_id: string }; Returns: boolean }
      next_document_sequence: {
        Args: { org_id: string; proj_id: string; seq_doc_type: string }
        Returns: number
      }
      seed_default_intervention_levels: {
        Args: { target_org_id: string }
        Returns: undefined
      }
      user_has_org_access: {
        Args: { target_org_id: string; target_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
