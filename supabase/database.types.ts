
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "app_config": {
                  Row: {
                    "key": string,"updated_at": string | null,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string | null,"value": string
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string | null,"value"?: string
                  }
                  Relationships: [
                    
                  ]
                },"device_tokens": {
                  Row: {
                    "created_at": string,"expo_token": string,"id": string,"last_seen_at": string,"platform": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expo_token": string,"id"?: string,"last_seen_at"?: string,"platform": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"expo_token"?: string,"id"?: string,"last_seen_at"?: string,"platform"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notification_log": {
                  Row: {
                    "body": string | null,"error": string | null,"expo_ticket": string | null,"fired_at": string,"id": number,"source": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"error"?: string | null,"expo_ticket"?: string | null,"fired_at"?: string,"id"?: number,"source": string,"status": string,"user_id": string
                  }
                  Update: {
                    "body"?: string | null,"error"?: string | null,"expo_ticket"?: string | null,"fired_at"?: string,"id"?: number,"source"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notification_preferences": {
                  Row: {
                    "created_at": string,"in_progress_cadence": string,"in_progress_enabled": boolean,"in_progress_hour": number,"in_progress_last_fired_local_date": string | null,"in_progress_minute": number,"in_progress_weekday": number | null,"last_foregrounded_at": string,"master_enabled": boolean,"reviews_cadence": string,"reviews_enabled": boolean,"reviews_hour": number,"reviews_last_fired_local_date": string | null,"reviews_minute": number,"reviews_weekday": number | null,"timezone": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"in_progress_cadence"?: string,"in_progress_enabled"?: boolean,"in_progress_hour"?: number,"in_progress_last_fired_local_date"?: string | null,"in_progress_minute"?: number,"in_progress_weekday"?: number | null,"last_foregrounded_at"?: string,"master_enabled"?: boolean,"reviews_cadence"?: string,"reviews_enabled"?: boolean,"reviews_hour"?: number,"reviews_last_fired_local_date"?: string | null,"reviews_minute"?: number,"reviews_weekday"?: number | null,"timezone": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"in_progress_cadence"?: string,"in_progress_enabled"?: boolean,"in_progress_hour"?: number,"in_progress_last_fired_local_date"?: string | null,"in_progress_minute"?: number,"in_progress_weekday"?: number | null,"last_foregrounded_at"?: string,"master_enabled"?: boolean,"reviews_cadence"?: string,"reviews_enabled"?: boolean,"reviews_hour"?: number,"reviews_last_fired_local_date"?: string | null,"reviews_minute"?: number,"reviews_weekday"?: number | null,"timezone"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"popular_ranges": {
                  Row: {
                    "book": string,"chapter": number,"id": string,"updated_at": string | null,"user_count": number,"verse_end": number,"verse_start": number
                  }
                  ComputedFields: never
                  Insert: {
                    "book": string,"chapter": number,"id"?: string,"updated_at"?: string | null,"user_count"?: number,"verse_end": number,"verse_start": number
                  }
                  Update: {
                    "book"?: string,"chapter"?: number,"id"?: string,"updated_at"?: string | null,"user_count"?: number,"verse_end"?: number,"verse_start"?: number
                  }
                  Relationships: [
                    
                  ]
                },"session_attempts": {
                  Row: {
                    "accuracy": number,"book": string,"chapter": number,"chunk_size": number,"created_at": string | null,"difficulty": string,"id": string,"recording_duration_ms": number | null,"user_id": string,"verse_end": number,"verse_start": number,"version": string,"word_count": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accuracy": number,"book": string,"chapter": number,"chunk_size": number,"created_at"?: string | null,"difficulty": string,"id"?: string,"recording_duration_ms"?: number | null,"user_id": string,"verse_end": number,"verse_start": number,"version": string,"word_count"?: number | null
                  }
                  Update: {
                    "accuracy"?: number,"book"?: string,"chapter"?: number,"chunk_size"?: number,"created_at"?: string | null,"difficulty"?: string,"id"?: string,"recording_duration_ms"?: number | null,"user_id"?: string,"verse_end"?: number,"verse_start"?: number,"version"?: string,"word_count"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"subscriptions": {
                  Row: {
                    "created_at": string,"expires_at": string | null,"id": string,"tier": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at"?: string | null,"id"?: string,"tier"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string | null,"id"?: string,"tier"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"transcription_locks": {
                  Row: {
                    "started_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "started_at"?: string,"user_id": string
                  }
                  Update: {
                    "started_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"usage_daily": {
                  Row: {
                    "bible_fetch_count": number,"created_at": string,"date": string,"evaluate_count": number,"id": string,"transcribe_seconds": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bible_fetch_count"?: number,"created_at"?: string,"date"?: string,"evaluate_count"?: number,"id"?: string,"transcribe_seconds"?: number,"user_id": string
                  }
                  Update: {
                    "bible_fetch_count"?: number,"created_at"?: string,"date"?: string,"evaluate_count"?: number,"id"?: string,"transcribe_seconds"?: number,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_collections": {
                  Row: {
                    "client_id": string,"created_at": string,"deleted_at": string | null,"id": string,"is_default": boolean,"name": string,"sort_preference": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_default"?: boolean,"name": string,"sort_preference"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_default"?: boolean,"name"?: string,"sort_preference"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_stats": {
                  Row: {
                    "avg_time_per_word_ms": number | null,"total_words_mastered": number | null,"updated_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avg_time_per_word_ms"?: number | null,"total_words_mastered"?: number | null,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "avg_time_per_word_ms"?: number | null,"total_words_mastered"?: number | null,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_verses": {
                  Row: {
                    "book": string,"chapter": number,"client_id": string,"created_at": string,"deleted_at": string | null,"id": string,"last_chunk_size": number | null,"last_difficulty": string | null,"last_practiced_at": string | null,"progress": NonNullable<Json>,"updated_at": string,"user_id": string,"verse_end": number,"verse_start": number,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book": string,"chapter": number,"client_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"last_chunk_size"?: number | null,"last_difficulty"?: string | null,"last_practiced_at"?: string | null,"progress"?: NonNullable<Json>,"updated_at"?: string,"user_id": string,"verse_end": number,"verse_start": number,"version": string
                  }
                  Update: {
                    "book"?: string,"chapter"?: number,"client_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"last_chunk_size"?: number | null,"last_difficulty"?: string | null,"last_practiced_at"?: string | null,"progress"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string,"verse_end"?: number,"verse_start"?: number,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"verse_cache": {
                  Row: {
                    "book": string,"chapter": number,"created_at": string,"id": string,"last_used_at": string,"text": string,"verse": number,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book": string,"chapter": number,"created_at"?: string,"id"?: string,"last_used_at"?: string,"text": string,"verse": number,"version": string
                  }
                  Update: {
                    "book"?: string,"chapter"?: number,"created_at"?: string,"id"?: string,"last_used_at"?: string,"text"?: string,"verse"?: number,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"verse_collections": {
                  Row: {
                    "added_at": string,"collection_id": string,"id": string,"verse_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"collection_id": string,"id"?: string,"verse_id": string
                  }
                  Update: {
                    "added_at"?: string,"collection_id"?: string,"id"?: string,"verse_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "verse_collections_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "user_collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verse_collections_verse_id_fkey"
      columns: ["verse_id"]
isOneToOne: false
      referencedRelation: "user_verses"
      referencedColumns: ["id"]
    }
                  ]
                },"verse_of_month": {
                  Row: {
                    "book": string,"chapter": number,"created_at": string | null,"id": string,"image_url": string | null,"verse_end": number,"verse_start": number,"year_month": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book": string,"chapter": number,"created_at"?: string | null,"id"?: string,"image_url"?: string | null,"verse_end": number,"verse_start": number,"year_month": string
                  }
                  Update: {
                    "book"?: string,"chapter"?: number,"created_at"?: string | null,"id"?: string,"image_url"?: string | null,"verse_end"?: number,"verse_start"?: number,"year_month"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "verse_cache_stats": {
                  Row: {
                    "newest_use": string | null,"oldest_use": string | null,"verse_count": number | null,"version": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "cleanup_expired_verse_cache":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"cleanup_stale_transcription_locks":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"delete_own_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"evict_lru_verses":
{ Args: { "p_max_count": number,"p_needed": number,"p_version": string }; Returns: number
                           },
"get_cron_secret":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_current_streak":
{ Args: { "p_tz_offset_min": number,"p_user_id": string }; Returns: number
                           },
"get_total_time_studied":
{ Args: { "p_user_id": string }; Returns: number
                           },
"get_verse_cache_count":
{ Args: { "p_version": string }; Returns: number
                           },
"local_time_in_tz":
{ Args: { "tz": string }; Returns: string
                           },
"register_device_token":
{ Args: { "p_expo_token": string,"p_platform": string }; Returns: undefined
                           },
"update_popular_ranges":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"update_user_stats":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"upsert_verses":
{ Args: { "p_book": string,"p_chapter": number,"p_verses": Json,"p_version": string }; Returns: number
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
