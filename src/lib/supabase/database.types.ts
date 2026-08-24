export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          checked_in_at: string
          id: string
          meeting_id: string
          student_id: string
        }
        Insert: {
          checked_in_at?: string
          id?: string
          meeting_id: string
          student_id: string
        }
        Update: {
          checked_in_at?: string
          id?: string
          meeting_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      blockers: {
        Row: {
          id: string
          note: string
          raised_at: string
          resolved_at: string | null
          resolved_by_mentor_id: string | null
          student_id: string
          task_id: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          note: string
          raised_at?: string
          resolved_at?: string | null
          resolved_by_mentor_id?: string | null
          student_id: string
          task_id?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          note?: string
          raised_at?: string
          resolved_at?: string | null
          resolved_by_mentor_id?: string | null
          student_id?: string
          task_id?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blockers_resolved_by_mentor_id_fkey"
            columns: ["resolved_by_mentor_id"]
            isOneToOne: false
            referencedRelation: "mentors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blockers_student_id_team_id_fkey"
            columns: ["student_id", "team_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "blockers_task_id_team_id_fkey"
            columns: ["task_id", "team_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "blockers_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence: {
        Row: {
          caption: string | null
          id: string
          storage_path: string
          task_id: string
          team_id: string
          upload_timestamp: string
          uploaded_by_student_id: string
        }
        Insert: {
          caption?: string | null
          id?: string
          storage_path: string
          task_id: string
          team_id: string
          upload_timestamp?: string
          uploaded_by_student_id: string
        }
        Update: {
          caption?: string | null
          id?: string
          storage_path?: string
          task_id?: string
          team_id?: string
          upload_timestamp?: string
          uploaded_by_student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_task_id_team_id_fkey"
            columns: ["task_id", "team_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "evidence_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_uploaded_by_student_id_team_id_fkey"
            columns: ["uploaded_by_student_id", "team_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      launch_missions: {
        Row: {
          created_at: string
          id: string
          launch_id: string
          mission_id: string
          scoring_lines: number[]
          sort_order: number
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          launch_id: string
          mission_id: string
          scoring_lines?: number[]
          sort_order?: number
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          launch_id?: string
          mission_id?: string
          scoring_lines?: number[]
          sort_order?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_missions_launch_id_team_id_fkey"
            columns: ["launch_id", "team_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "launch_missions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      launches: {
        Row: {
          attachment_name: string
          created_at: string
          id: string
          name: string
          sort_order: number
          strategy_id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          attachment_name?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          strategy_id: string
          team_id: string
          updated_at?: string
        }
        Update: {
          attachment_name?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          strategy_id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "launches_strategy_id_team_id_fkey"
            columns: ["strategy_id", "team_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      mat_config: {
        Row: {
          id: boolean
          launch_area_h_mm: number | null
          launch_area_w_mm: number | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          launch_area_h_mm?: number | null
          launch_area_w_mm?: number | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          launch_area_h_mm?: number | null
          launch_area_w_mm?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      mat_images: {
        Row: {
          dim_pct: number
          far_u: number | null
          far_v: number | null
          id: string
          image_h: number
          image_w: number
          origin_u: number | null
          origin_v: number | null
          storage_path: string | null
          team_id: string
          updated_at: string
          uploaded_at: string
        }
        Insert: {
          dim_pct?: number
          far_u?: number | null
          far_v?: number | null
          id?: string
          image_h: number
          image_w: number
          origin_u?: number | null
          origin_v?: number | null
          storage_path?: string | null
          team_id: string
          updated_at?: string
          uploaded_at?: string
        }
        Update: {
          dim_pct?: number
          far_u?: number | null
          far_v?: number | null
          id?: string
          image_h?: number
          image_w?: number
          origin_u?: number | null
          origin_v?: number | null
          storage_path?: string | null
          team_id?: string
          updated_at?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mat_images_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      match_run_launches: {
        Row: {
          attempted: boolean
          created_at: string
          id: string
          launch_id: string | null
          name: string
          run_id: string
          sort_order: number
          team_id: string
          updated_at: string
        }
        Insert: {
          attempted?: boolean
          created_at?: string
          id?: string
          launch_id?: string | null
          name?: string
          run_id: string
          sort_order?: number
          team_id: string
          updated_at?: string
        }
        Update: {
          attempted?: boolean
          created_at?: string
          id?: string
          launch_id?: string | null
          name?: string
          run_id?: string
          sort_order?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_run_launches_launch_id_team_id_fkey"
            columns: ["launch_id", "team_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "match_run_launches_run_id_team_id_fkey"
            columns: ["run_id", "team_id"]
            isOneToOne: false
            referencedRelation: "match_runs"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      match_run_scores: {
        Row: {
          created_at: string
          id: string
          line_index: number
          mission_id: string
          points: number
          quantity: number
          run_id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_index: number
          mission_id: string
          points?: number
          quantity?: number
          run_id: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          line_index?: number
          mission_id?: string
          points?: number
          quantity?: number
          run_id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_run_scores_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_run_scores_run_id_team_id_fkey"
            columns: ["run_id", "team_id"]
            isOneToOne: false
            referencedRelation: "match_runs"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      match_runs: {
        Row: {
          created_at: string
          elapsed_s: number | null
          id: string
          logged_by_mentor_id: string | null
          logged_by_student_id: string | null
          note: string
          points: number
          started_at: string
          strategy_id: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          elapsed_s?: number | null
          id?: string
          logged_by_mentor_id?: string | null
          logged_by_student_id?: string | null
          note?: string
          points?: number
          started_at?: string
          strategy_id?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          elapsed_s?: number | null
          id?: string
          logged_by_mentor_id?: string | null
          logged_by_student_id?: string | null
          note?: string
          points?: number
          started_at?: string
          strategy_id?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_runs_logged_by_mentor_id_fkey"
            columns: ["logged_by_mentor_id"]
            isOneToOne: false
            referencedRelation: "mentors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_runs_logged_by_student_id_team_id_fkey"
            columns: ["logged_by_student_id", "team_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "match_runs_strategy_id_team_id_fkey"
            columns: ["strategy_id", "team_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "match_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_phases: {
        Row: {
          ended_at: string | null
          id: string
          meeting_id: string
          name: string
          ordinal: number
          planned_minutes: number
          started_at: string | null
          updated_at: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          meeting_id: string
          name: string
          ordinal: number
          planned_minutes: number
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          meeting_id?: string
          name?: string
          ordinal?: number
          planned_minutes?: number
          started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_phases_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_recaps: {
        Row: {
          confirmed: boolean
          confirmed_at: string | null
          confirmed_by_mentor_id: string | null
          confirmed_by_student_id: string | null
          created_at: string
          draft: Json
          id: string
          meeting_id: string
          summary: string
          team_id: string
          updated_at: string
        }
        Insert: {
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by_mentor_id?: string | null
          confirmed_by_student_id?: string | null
          created_at?: string
          draft?: Json
          id?: string
          meeting_id: string
          summary?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by_mentor_id?: string | null
          confirmed_by_student_id?: string | null
          created_at?: string
          draft?: Json
          id?: string
          meeting_id?: string
          summary?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_recaps_confirmed_by_mentor_id_fkey"
            columns: ["confirmed_by_mentor_id"]
            isOneToOne: false
            referencedRelation: "mentors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_recaps_confirmed_by_student_id_team_id_fkey"
            columns: ["confirmed_by_student_id", "team_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "meeting_recaps_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_recaps_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          created_at: string
          created_by: string
          current_phase_id: string | null
          ended_at: string | null
          id: string
          kind: Database["public"]["Enums"]["meeting_kind"]
          meeting_date: string
          planned_end_at: string
          planned_start_at: string
          started_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          current_phase_id?: string | null
          ended_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["meeting_kind"]
          meeting_date: string
          planned_end_at: string
          planned_start_at: string
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          current_phase_id?: string | null
          ended_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["meeting_kind"]
          meeting_date?: string
          planned_end_at?: string
          planned_start_at?: string
          started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "mentors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_current_phase_fkey"
            columns: ["current_phase_id", "id"]
            isOneToOne: false
            referencedRelation: "meeting_phases"
            referencedColumns: ["id", "meeting_id"]
          },
        ]
      }
      mentors: {
        Row: {
          auth_user_id: string
          created_at: string
          deactivated_at: string | null
          display_name: string
          email: string
          id: string
          is_admin: boolean
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          deactivated_at?: string | null
          display_name: string
          email: string
          id?: string
          is_admin?: boolean
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          deactivated_at?: string | null
          display_name?: string
          email?: string
          id?: string
          is_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      missions: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          points_label: string
          position_x_mm: number | null
          position_y_mm: number | null
          scoring: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          points_label: string
          position_x_mm?: number | null
          position_y_mm?: number | null
          scoring?: Json
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          points_label?: string
          position_x_mm?: number | null
          position_y_mm?: number | null
          scoring?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      notebook_entries: {
        Row: {
          authored_by_student_id: string | null
          body: string
          change_note: string
          created_at: string
          evidence_id: string | null
          id: string
          outcome: Database["public"]["Enums"]["notebook_outcome"] | null
          prompt_key: string
          section: Database["public"]["Enums"]["notebook_section"]
          sort_order: number
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          authored_by_student_id?: string | null
          body?: string
          change_note?: string
          created_at?: string
          evidence_id?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["notebook_outcome"] | null
          prompt_key?: string
          section: Database["public"]["Enums"]["notebook_section"]
          sort_order?: number
          team_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          authored_by_student_id?: string | null
          body?: string
          change_note?: string
          created_at?: string
          evidence_id?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["notebook_outcome"] | null
          prompt_key?: string
          section?: Database["public"]["Enums"]["notebook_section"]
          sort_order?: number
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notebook_entries_authored_by_student_id_team_id_fkey"
            columns: ["authored_by_student_id", "team_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "notebook_entries_evidence_id_team_id_fkey"
            columns: ["evidence_id", "team_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "notebook_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      phase_templates: {
        Row: {
          id: string
          kind: Database["public"]["Enums"]["meeting_kind"]
          name: string
          ordinal: number
          planned_minutes: number
        }
        Insert: {
          id?: string
          kind: Database["public"]["Enums"]["meeting_kind"]
          name: string
          ordinal: number
          planned_minutes: number
        }
        Update: {
          id?: string
          kind?: Database["public"]["Enums"]["meeting_kind"]
          name?: string
          ordinal?: number
          planned_minutes?: number
        }
        Relationships: []
      }
      role_assignments: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          role: Database["public"]["Enums"]["team_role"]
          student_id: string
          team_id: string
          tier: Database["public"]["Enums"]["role_tier"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          role: Database["public"]["Enums"]["team_role"]
          student_id: string
          team_id: string
          tier: Database["public"]["Enums"]["role_tier"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          role?: Database["public"]["Enums"]["team_role"]
          student_id?: string
          team_id?: string
          tier?: Database["public"]["Enums"]["role_tier"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_assignments_student_id_team_id_fkey"
            columns: ["student_id", "team_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "role_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      strategies: {
        Row: {
          created_at: string
          id: string
          label: string | null
          team_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          team_id: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          team_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "strategies_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      student_parent_access: {
        Row: {
          created_at: string
          id: string
          issued_at: string
          issued_by_mentor_id: string | null
          last_opened_at: string | null
          open_count: number
          revoked_at: string | null
          student_id: string
          team_id: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          issued_at?: string
          issued_by_mentor_id?: string | null
          last_opened_at?: string | null
          open_count?: number
          revoked_at?: string | null
          student_id: string
          team_id: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          issued_at?: string
          issued_by_mentor_id?: string | null
          last_opened_at?: string | null
          open_count?: number
          revoked_at?: string | null
          student_id?: string
          team_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_parent_access_issued_by_mentor_id_fkey"
            columns: ["issued_by_mentor_id"]
            isOneToOne: false
            referencedRelation: "mentors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_parent_access_student_id_team_id_fkey"
            columns: ["student_id", "team_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      students: {
        Row: {
          auth_user_id: string
          created_at: string
          deactivated_at: string | null
          first_name: string
          grade: number | null
          id: string
          last_initial: string
          slug: string
          team_id: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          deactivated_at?: string | null
          first_name: string
          grade?: number | null
          id?: string
          last_initial: string
          slug: string
          team_id: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          deactivated_at?: string | null
          first_name?: string
          grade?: number | null
          id?: string
          last_initial?: string
          slug?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_student_id: string | null
          closed_at: string | null
          created_at: string
          created_by_mentor_id: string | null
          created_by_student_id: string | null
          detail: string | null
          evidence_required: boolean
          id: string
          meeting_id: string | null
          role: Database["public"]["Enums"]["team_role"] | null
          status: Database["public"]["Enums"]["task_status"]
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_student_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by_mentor_id?: string | null
          created_by_student_id?: string | null
          detail?: string | null
          evidence_required?: boolean
          id?: string
          meeting_id?: string | null
          role?: Database["public"]["Enums"]["team_role"] | null
          status?: Database["public"]["Enums"]["task_status"]
          team_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_student_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by_mentor_id?: string | null
          created_by_student_id?: string | null
          detail?: string | null
          evidence_required?: boolean
          id?: string
          meeting_id?: string | null
          role?: Database["public"]["Enums"]["team_role"] | null
          status?: Database["public"]["Enums"]["task_status"]
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_student_id_team_id_fkey"
            columns: ["assigned_student_id", "team_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "tasks_created_by_mentor_id_fkey"
            columns: ["created_by_mentor_id"]
            isOneToOne: false
            referencedRelation: "mentors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_student_id_fkey"
            columns: ["created_by_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_board_devices: {
        Row: {
          auth_user_id: string
          created_at: string
          id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          id?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_board_devices_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_mission_notes: {
        Row: {
          id: string
          mission_id: string
          note: string
          team_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          mission_id: string
          note?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          mission_id?: string
          note?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_mission_notes_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_mission_notes_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_robots: {
        Row: {
          between_launches_s: number
          created_at: string
          dwell_s: number
          id: string
          length_mm: number
          speed_cm_s: number
          team_id: string
          updated_at: string
          width_mm: number
        }
        Insert: {
          between_launches_s?: number
          created_at?: string
          dwell_s?: number
          id?: string
          length_mm?: number
          speed_cm_s?: number
          team_id: string
          updated_at?: string
          width_mm?: number
        }
        Update: {
          between_launches_s?: number
          created_at?: string
          dwell_s?: number
          id?: string
          length_mm?: number
          speed_cm_s?: number
          team_id?: string
          updated_at?: string
          width_mm?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_robots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          accent: Database["public"]["Enums"]["team_accent"]
          archived_at: string | null
          created_at: string
          fll_team_number: number | null
          id: string
          join_code: string
          join_open_meeting_id: string | null
          join_open_since: string | null
          name: string
          updated_at: string
        }
        Insert: {
          accent?: Database["public"]["Enums"]["team_accent"]
          archived_at?: string | null
          created_at?: string
          fll_team_number?: number | null
          id?: string
          join_code: string
          join_open_meeting_id?: string | null
          join_open_since?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          accent?: Database["public"]["Enums"]["team_accent"]
          archived_at?: string | null
          created_at?: string
          fll_team_number?: number | null
          id?: string
          join_code?: string
          join_open_meeting_id?: string | null
          join_open_since?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_join_open_meeting_fkey"
            columns: ["join_open_meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      waypoints: {
        Row: {
          created_at: string
          id: string
          launch_id: string
          sort_order: number
          team_id: string
          updated_at: string
          x_mm: number
          y_mm: number
        }
        Insert: {
          created_at?: string
          id?: string
          launch_id: string
          sort_order?: number
          team_id: string
          updated_at?: string
          x_mm: number
          y_mm: number
        }
        Update: {
          created_at?: string
          id?: string
          launch_id?: string
          sort_order?: number
          team_id?: string
          updated_at?: string
          x_mm?: number
          y_mm?: number
        }
        Relationships: [
          {
            foreignKeyName: "waypoints_launch_id_team_id_fkey"
            columns: ["launch_id", "team_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _app_day_start: { Args: { p_date: string }; Returns: string }
      _app_timezone: { Args: never; Returns: string }
      _app_today: { Args: never; Returns: string }
      _board_email: { Args: { p_join_code: string }; Returns: string }
      _generate_join_code: { Args: never; Returns: string }
      _meeting_recap_facts: {
        Args: { p_meeting_id: string; p_team_id: string }
        Returns: Json
      }
      _meeting_recaps_generate: {
        Args: { p_meeting_id: string }
        Returns: number
      }
      _next_team_accent: {
        Args: never
        Returns: Database["public"]["Enums"]["team_accent"]
      }
      _resolve_current_meeting_id: { Args: never; Returns: string }
      _student_detach_from_team: {
        Args: { p_student_id: string }
        Returns: Json
      }
      _student_email: {
        Args: { p_join_code: string; p_slug: string }
        Returns: string
      }
      _student_slug_base: {
        Args: { p_first_name: string; p_last_initial: string }
        Returns: string
      }
      auth_whoami: { Args: never; Returns: Json }
      board_live_summary: { Args: { p_meeting_id?: string }; Returns: Json }
      current_board_team_id: { Args: never; Returns: string }
      current_mentor_id: { Args: never; Returns: string }
      current_student_id: { Args: never; Returns: string }
      current_student_team_id: { Args: never; Returns: string }
      is_admin_mentor: { Args: never; Returns: boolean }
      is_mentor: { Args: never; Returns: boolean }
      match_run_history: { Args: { p_team_id: string }; Returns: Json }
      meeting_advance_phase: { Args: { p_meeting_id: string }; Returns: Json }
      meeting_create: {
        Args: {
          p_kind: Database["public"]["Enums"]["meeting_kind"]
          p_meeting_date: string
          p_planned_end_at?: string
          p_planned_start_at: string
        }
        Returns: Json
      }
      meeting_current: { Args: never; Returns: Json }
      meeting_end: { Args: { p_meeting_id: string }; Returns: Json }
      meeting_start: { Args: { p_meeting_id: string }; Returns: Json }
      notebook_can_edit: {
        Args: {
          p_section: Database["public"]["Enums"]["notebook_section"]
          p_team_id: string
        }
        Returns: boolean
      }
      notebook_season_stats: { Args: { p_team_id: string }; Returns: Json }
      parent_access_issue: { Args: { p_student_id: string }; Returns: Json }
      parent_access_revoke: { Args: { p_student_id: string }; Returns: Json }
      parent_photo_path: {
        Args: { p_evidence_id: string; p_token: string }
        Returns: string
      }
      parent_view: { Args: { p_token: string }; Returns: Json }
      role_assign: {
        Args: {
          p_role: Database["public"]["Enums"]["team_role"]
          p_student_id: string
          p_team_id: string
          p_tier: Database["public"]["Enums"]["role_tier"]
        }
        Returns: Json
      }
      role_unassign: {
        Args: {
          p_role: Database["public"]["Enums"]["team_role"]
          p_team_id: string
          p_tier: Database["public"]["Enums"]["role_tier"]
        }
        Returns: Json
      }
      strategy_can_edit: { Args: { p_team_id: string }; Returns: boolean }
      strategy_snapshot: {
        Args: { p_label?: string; p_team_id: string }
        Returns: Json
      }
      student_create: {
        Args: {
          p_first_name: string
          p_grade?: number
          p_last_initial: string
          p_pin?: string
          p_team_id: string
        }
        Returns: Json
      }
      student_deactivate: { Args: { p_student_id: string }; Returns: Json }
      student_move_team: {
        Args: { p_student_id: string; p_to_team_id: string }
        Returns: Json
      }
      student_reactivate: { Args: { p_student_id: string }; Returns: Json }
      student_reset_pin: {
        Args: { p_new_pin: string; p_student_id: string }
        Returns: Json
      }
      student_self_enroll: {
        Args: {
          p_first_name: string
          p_grade: number
          p_join_code: string
          p_last_initial: string
          p_pin: string
        }
        Returns: Json
      }
      team_board_disable: { Args: { p_team_id: string }; Returns: Json }
      team_board_enable: {
        Args: { p_pin: string; p_team_id: string }
        Returns: Json
      }
      team_create: {
        Args: {
          p_accent?: Database["public"]["Enums"]["team_accent"]
          p_fll_team_number?: number
          p_name: string
        }
        Returns: Json
      }
      team_join_open: { Args: { p_team_id: string }; Returns: boolean }
      team_join_window_close: { Args: { p_team_id: string }; Returns: Json }
      team_join_window_open: { Args: { p_team_id: string }; Returns: Json }
      team_login_roster: { Args: { p_join_code: string }; Returns: Json }
      team_regenerate_join_code: { Args: { p_team_id: string }; Returns: Json }
      team_resolve_roles: {
        Args: { p_meeting_id?: string; p_on_date?: string; p_team_id: string }
        Returns: {
          active_name: string
          active_student_id: string
          active_tier: Database["public"]["Enums"]["role_tier"]
          has_second: boolean
          primary_name: string
          primary_present: boolean
          primary_student_id: string
          role: Database["public"]["Enums"]["team_role"]
          second_name: string
          second_present: boolean
          second_student_id: string
          unfilled: boolean
        }[]
      }
      team_roster_state: { Args: never; Returns: Json }
      team_size_cap: { Args: never; Returns: number }
    }
    Enums: {
      meeting_kind: "friday" | "saturday"
      notebook_outcome: "worked" | "failed" | "mixed"
      notebook_section:
        | "robot_design"
        | "innovation_project"
        | "core_values"
        | "season_summary"
      role_tier: "primary" | "second"
      task_status: "open" | "active" | "blocked" | "done"
      team_accent: "cyan" | "chartreuse" | "magenta" | "amber"
      team_role:
        | "lead_builder"
        | "lead_programmer"
        | "run_captain"
        | "innovation_lead"
        | "notebook_values_lead"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      meeting_kind: ["friday", "saturday"],
      notebook_outcome: ["worked", "failed", "mixed"],
      notebook_section: [
        "robot_design",
        "innovation_project",
        "core_values",
        "season_summary",
      ],
      role_tier: ["primary", "second"],
      task_status: ["open", "active", "blocked", "done"],
      team_accent: ["cyan", "chartreuse", "magenta", "amber"],
      team_role: [
        "lead_builder",
        "lead_programmer",
        "run_captain",
        "innovation_lead",
        "notebook_values_lead",
      ],
    },
  },
} as const

