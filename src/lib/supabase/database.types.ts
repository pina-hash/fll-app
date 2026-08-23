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
      teams: {
        Row: {
          accent: Database["public"]["Enums"]["team_accent"]
          archived_at: string | null
          created_at: string
          fll_team_number: number | null
          id: string
          join_code: string
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
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _app_day_start: { Args: { p_date: string }; Returns: string }
      _app_timezone: { Args: never; Returns: string }
      _app_today: { Args: never; Returns: string }
      _generate_join_code: { Args: never; Returns: string }
      _next_team_accent: {
        Args: never
        Returns: Database["public"]["Enums"]["team_accent"]
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
      current_mentor_id: { Args: never; Returns: string }
      current_student_id: { Args: never; Returns: string }
      current_student_team_id: { Args: never; Returns: string }
      is_admin_mentor: { Args: never; Returns: boolean }
      is_mentor: { Args: never; Returns: boolean }
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
      meeting_end: { Args: { p_meeting_id: string }; Returns: Json }
      meeting_start: { Args: { p_meeting_id: string }; Returns: Json }
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
      student_reactivate: { Args: { p_student_id: string }; Returns: Json }
      student_reset_pin: {
        Args: { p_new_pin: string; p_student_id: string }
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
    }
    Enums: {
      meeting_kind: "friday" | "saturday"
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

