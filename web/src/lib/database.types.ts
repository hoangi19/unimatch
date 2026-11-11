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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_providers: {
        Row: {
          base_url: string | null
          display_name: string | null
          extra_headers: Json
          key_hint: string | null
          key_saved_at: string | null
          key_secret_id: string | null
          kind: Database["public"]["Enums"]["ai_provider_kind"]
          model: string | null
          supports_tools: boolean
        }
        Insert: {
          base_url?: string | null
          display_name?: string | null
          extra_headers?: Json
          key_hint?: string | null
          key_saved_at?: string | null
          key_secret_id?: string | null
          kind: Database["public"]["Enums"]["ai_provider_kind"]
          model?: string | null
          supports_tools?: boolean
        }
        Update: {
          base_url?: string | null
          display_name?: string | null
          extra_headers?: Json
          key_hint?: string | null
          key_saved_at?: string | null
          key_secret_id?: string | null
          kind?: Database["public"]["Enums"]["ai_provider_kind"]
          model?: string | null
          supports_tools?: boolean
        }
        Relationships: []
      }
      bot_settings: {
        Row: {
          active_provider: Database["public"]["Enums"]["ai_provider_kind"]
          fallback: string
          greeting: string
          guardrails: Json
          handoff_message: string
          id: boolean
          language: string
          max_tokens: number
          quick_replies: string[]
          rate_limit_per_hour: number
          system_prompt: string
          temperature: number
        }
        Insert: {
          active_provider?: Database["public"]["Enums"]["ai_provider_kind"]
          fallback: string
          greeting: string
          guardrails: Json
          handoff_message: string
          id?: boolean
          language?: string
          max_tokens?: number
          quick_replies?: string[]
          rate_limit_per_hour?: number
          system_prompt: string
          temperature?: number
        }
        Update: {
          active_provider?: Database["public"]["Enums"]["ai_provider_kind"]
          fallback?: string
          greeting?: string
          guardrails?: Json
          handoff_message?: string
          id?: boolean
          language?: string
          max_tokens?: number
          quick_replies?: string[]
          rate_limit_per_hour?: number
          system_prompt?: string
          temperature?: number
        }
        Relationships: [
          {
            foreignKeyName: "bot_settings_active_provider_fkey"
            columns: ["active_provider"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["kind"]
          },
        ]
      }
      conversations: {
        Row: {
          bot_lock_until: string | null
          bot_replied_up_to: string | null
          created_at: string
          customer_name: string | null
          customer_picture_url: string | null
          customer_profile_at: string | null
          handoff_at: string | null
          handoff_reason: string | null
          id: string
          language: string | null
          last_customer_message_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          needs_help: boolean | null
          notes: string
          page_id: string
          psid: string
          status: string
          unread_count: number
        }
        Insert: {
          bot_lock_until?: string | null
          bot_replied_up_to?: string | null
          created_at?: string
          customer_name?: string | null
          customer_picture_url?: string | null
          customer_profile_at?: string | null
          handoff_at?: string | null
          handoff_reason?: string | null
          id?: string
          language?: string | null
          last_customer_message_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          needs_help?: boolean | null
          notes?: string
          page_id: string
          psid: string
          status?: string
          unread_count?: number
        }
        Update: {
          bot_lock_until?: string | null
          bot_replied_up_to?: string | null
          created_at?: string
          customer_name?: string | null
          customer_picture_url?: string | null
          customer_profile_at?: string | null
          handoff_at?: string | null
          handoff_reason?: string | null
          id?: string
          language?: string | null
          last_customer_message_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          needs_help?: boolean | null
          notes?: string
          page_id?: string
          psid?: string
          status?: string
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      embedding_model: {
        Row: {
          base_url: string
          dims: number
          id: boolean
          key_hint: string | null
          key_saved_at: string | null
          key_secret_id: string | null
          model: string
          provider: string
        }
        Insert: {
          base_url?: string
          dims?: number
          id?: boolean
          key_hint?: string | null
          key_saved_at?: string | null
          key_secret_id?: string | null
          model?: string
          provider?: string
        }
        Update: {
          base_url?: string
          dims?: number
          id?: boolean
          key_hint?: string | null
          key_saved_at?: string | null
          key_secret_id?: string | null
          model?: string
          provider?: string
        }
        Relationships: []
      }
      guardrail_model: {
        Row: {
          base_url: string
          id: boolean
          key_hint: string | null
          key_saved_at: string | null
          key_secret_id: string | null
          model: string
          provider: string
        }
        Insert: {
          base_url?: string
          id?: boolean
          key_hint?: string | null
          key_saved_at?: string | null
          key_secret_id?: string | null
          model?: string
          provider?: string
        }
        Update: {
          base_url?: string
          id?: boolean
          key_hint?: string | null
          key_saved_at?: string | null
          key_secret_id?: string | null
          model?: string
          provider?: string
        }
        Relationships: []
      }
      job_chunks: {
        Row: {
          chunk_index: number
          content_hash: string
          created_at: string
          embedding: string
          external_id: string
          model: string
          source: string
        }
        Insert: {
          chunk_index: number
          content_hash: string
          created_at?: string
          embedding: string
          external_id: string
          model: string
          source: string
        }
        Update: {
          chunk_index?: number
          content_hash?: string
          created_at?: string
          embedding?: string
          external_id?: string
          model?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_chunks_source_external_id_fkey"
            columns: ["source", "external_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["source", "external_id"]
          },
        ]
      }
      jobs: {
        Row: {
          applicants_count: number | null
          apply_url: string | null
          benefits: string[]
          company_linkedin_url: string | null
          company_logo: string | null
          company_name: string | null
          created_at: string
          description_html: string | null
          description_text: string | null
          employment_type: string | null
          external_id: string
          industries: string | null
          link: string | null
          location: string | null
          posted_at: string | null
          raw: Json
          salary: string | null
          scraped_at: string | null
          seniority_level: string | null
          source: string
          source_name: string | null
          title: string
          updated_at: string
        }
        Insert: {
          applicants_count?: number | null
          apply_url?: string | null
          benefits?: string[]
          company_linkedin_url?: string | null
          company_logo?: string | null
          company_name?: string | null
          created_at?: string
          description_html?: string | null
          description_text?: string | null
          employment_type?: string | null
          external_id: string
          industries?: string | null
          link?: string | null
          location?: string | null
          posted_at?: string | null
          raw: Json
          salary?: string | null
          scraped_at?: string | null
          seniority_level?: string | null
          source: string
          source_name?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          applicants_count?: number | null
          apply_url?: string | null
          benefits?: string[]
          company_linkedin_url?: string | null
          company_logo?: string | null
          company_name?: string | null
          created_at?: string
          description_html?: string | null
          description_text?: string | null
          employment_type?: string | null
          external_id?: string
          industries?: string | null
          link?: string | null
          location?: string | null
          posted_at?: string | null
          raw?: Json
          salary?: string | null
          scraped_at?: string | null
          seniority_level?: string | null
          source?: string
          source_name?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          admin_id: string | null
          attachments: Json | null
          conversation_id: string
          created_at: string
          delivery_error: string | null
          delivery_status: string
          event: Json | null
          external_id: string | null
          id: string
          sender_kind: string
          text: string | null
          trace: Json | null
        }
        Insert: {
          admin_id?: string | null
          attachments?: Json | null
          conversation_id: string
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string
          event?: Json | null
          external_id?: string | null
          id?: string
          sender_kind: string
          text?: string | null
          trace?: Json | null
        }
        Update: {
          admin_id?: string | null
          attachments?: Json | null
          conversation_id?: string
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string
          event?: Json | null
          external_id?: string | null
          id?: string
          sender_kind?: string
          text?: string | null
          trace?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          access_token_secret_id: string | null
          bot_enabled: boolean
          connected_at: string
          handoff_keywords: string[]
          id: string
          name: string
          picture_url: string | null
          reply_delay_ms: number
          reply_hours: Json
          reply_mode: string
          token_checked_at: string | null
          token_expires_at: string | null
        }
        Insert: {
          access_token_secret_id?: string | null
          bot_enabled?: boolean
          connected_at?: string
          handoff_keywords?: string[]
          id: string
          name: string
          picture_url?: string | null
          reply_delay_ms?: number
          reply_hours?: Json
          reply_mode?: string
          token_checked_at?: string | null
          token_expires_at?: string | null
        }
        Update: {
          access_token_secret_id?: string | null
          bot_enabled?: boolean
          connected_at?: string
          handoff_keywords?: string[]
          id?: string
          name?: string
          picture_url?: string | null
          reply_delay_ms?: number
          reply_hours?: Json
          reply_mode?: string
          token_checked_at?: string | null
          token_expires_at?: string | null
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          error: string | null
          external_id: string | null
          field: string
          id: number
          page_id: string
          payload: Json
          received_at: string
          status: string
        }
        Insert: {
          error?: string | null
          external_id?: string | null
          field: string
          id?: never
          page_id: string
          payload: Json
          received_at?: string
          status?: string
        }
        Update: {
          error?: string | null
          external_id?: string | null
          field?: string
          id?: never
          page_id?: string
          payload?: Json
          received_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_webhook_event: {
        Args: { e: Database["public"]["Tables"]["webhook_events"]["Row"] }
        Returns: string
      }
      claim_bot_turn: {
        Args: { p_after_ms: number; p_page_id: string; p_psid: string }
        Returns: {
          conversation_id: string
          reply_up_to: string
        }[]
      }
      claim_customer_profile: {
        Args: { p_page_id: string; p_psid: string }
        Returns: boolean
      }
      clear_page_token: { Args: { p_page_id: string }; Returns: undefined }
      delete_customer_data: { Args: { p_psid: string }; Returns: Json }
      finish_bot_turn: {
        Args: { p_conversation_id: string; p_up_to: string }
        Returns: boolean
      }
      get_embedding_key: { Args: never; Returns: string }
      get_guardrail_key: { Args: never; Returns: string }
      get_page_token: { Args: { p_page_id: string }; Returns: string }
      get_provider_key: {
        Args: { p_kind: Database["public"]["Enums"]["ai_provider_kind"] }
        Returns: string
      }
      hand_off_conversation: {
        Args: { p_conversation_id: string; p_detail: Json; p_reason: string }
        Returns: boolean
      }
      inbox_stats: {
        Args: { p_from?: string; p_page_id?: string; p_to?: string }
        Returns: {
          avg_first_response_seconds: number
          bot_handled: number
          customer_conversations: number
          open_conversations: number
          waiting_for_human: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      match_jobs: {
        Args: { match_count: number; query_embedding: string }
        Returns: {
          apply_url: string
          company_name: string
          employment_type: string
          external_id: string
          link: string
          location: string
          salary: string
          similarity: number
          source: string
          title: string
        }[]
      }
      process_webhook_event: {
        Args: { e: Database["public"]["Tables"]["webhook_events"]["Row"] }
        Returns: string
      }
      record_outbound_message: {
        Args: {
          p_admin_id: string
          p_conversation_id: string
          p_delivery_error: string
          p_external_id: string
          p_sender_kind: string
          p_text: string
          p_trace: Json
        }
        Returns: string
      }
      record_token_check: {
        Args: { p_page_id: string; p_valid: boolean }
        Returns: undefined
      }
      remove_embedding_key: { Args: never; Returns: undefined }
      remove_guardrail_key: { Args: never; Returns: undefined }
      remove_provider_key: {
        Args: { p_kind: Database["public"]["Enums"]["ai_provider_kind"] }
        Returns: undefined
      }
      replay_webhook_events: { Args: { p_page_id: string }; Returns: number }
      set_conversation_mode: {
        Args: { p_conversation_id: string; p_mode: string }
        Returns: boolean
      }
      set_conversation_mode_as: {
        Args: { p_admin_id: string; p_conversation_id: string; p_mode: string }
        Returns: boolean
      }
      set_embedding_key: {
        Args: { p_key: string }
        Returns: {
          key_hint: string
          key_saved_at: string
        }[]
      }
      set_guardrail_key: {
        Args: { p_key: string }
        Returns: {
          key_hint: string
          key_saved_at: string
        }[]
      }
      set_page_token: {
        Args: { p_expires_at: string; p_page_id: string; p_token: string }
        Returns: undefined
      }
      set_provider_key: {
        Args: {
          p_key: string
          p_kind: Database["public"]["Enums"]["ai_provider_kind"]
        }
        Returns: {
          key_hint: string
          key_saved_at: string
        }[]
      }
      token_health_secret_ok: { Args: { p_secret: string }; Returns: boolean }
    }
    Enums: {
      ai_provider_kind: "hermes" | "openai" | "anthropic" | "custom"
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
    Enums: {
      ai_provider_kind: ["hermes", "openai", "anthropic", "custom"],
    },
  },
} as const
