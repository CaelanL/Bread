
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
                },"curated_collection_savers": {
                  Row: {
                    "catalog_id": string,"id": number,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "catalog_id": string,"id"?: never,"user_id"?: string | null
                  }
                  Update: {
                    "catalog_id"?: string,"id"?: never,"user_id"?: string | null
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
                },"invite_handoffs": {
                  Row: {
                    "code": string,"created_at": string,"id": number,"network": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: never,"network": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: never,"network"?: string
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
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"first_name": string | null,"last_name": string | null,"translation": string | null,"updated_at": string,"user_id": string,"welcome_v2_seen_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"first_name"?: string | null,"last_name"?: string | null,"translation"?: string | null,"updated_at"?: string,"user_id": string,"welcome_v2_seen_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"first_name"?: string | null,"last_name"?: string | null,"translation"?: string | null,"updated_at"?: string,"user_id"?: string,"welcome_v2_seen_at"?: string | null
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
                },"shared_collection_members": {
                  Row: {
                    "joined_at": string,"role": string,"shared_collection_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "joined_at"?: string,"role": string,"shared_collection_id": string,"user_id": string
                  }
                  Update: {
                    "joined_at"?: string,"role"?: string,"shared_collection_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shared_collection_members_shared_collection_id_fkey"
      columns: ["shared_collection_id"]
isOneToOne: false
      referencedRelation: "shared_collections"
      referencedColumns: ["id"]
    }
                  ]
                },"shared_collection_verses": {
                  Row: {
                    "added_at": string,"added_by": string | null,"book": string,"chapter": number,"shared_collection_id": string,"verse_end": number,"verse_start": number
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"book": string,"chapter": number,"shared_collection_id": string,"verse_end": number,"verse_start": number
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"book"?: string,"chapter"?: number,"shared_collection_id"?: string,"verse_end"?: number,"verse_start"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "shared_collection_verses_shared_collection_id_fkey"
      columns: ["shared_collection_id"]
isOneToOne: false
      referencedRelation: "shared_collections"
      referencedColumns: ["id"]
    }
                  ]
                },"shared_collections": {
                  Row: {
                    "created_at": string,"icon_key": string | null,"id": string,"name": string,"owner_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"icon_key"?: string | null,"id"?: string,"name": string,"owner_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"icon_key"?: string | null,"id"?: string,"name"?: string,"owner_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"shared_invites": {
                  Row: {
                    "code": string,"created_at": string,"expires_at": string,"id": string,"revoked_at": string | null,"shared_collection_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"revoked_at"?: string | null,"shared_collection_id": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"revoked_at"?: string | null,"shared_collection_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shared_invites_shared_collection_id_fkey"
      columns: ["shared_collection_id"]
isOneToOne: false
      referencedRelation: "shared_collections"
      referencedColumns: ["id"]
    }
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
                    "client_id": string,"created_at": string,"deleted_at": string | null,"icon_key": string | null,"id": string,"is_default": boolean,"name": string,"position": number | null,"shared_collection_id": string | null,"sort_preference": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"deleted_at"?: string | null,"icon_key"?: string | null,"id"?: string,"is_default"?: boolean,"name": string,"position"?: number | null,"shared_collection_id"?: string | null,"sort_preference"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"icon_key"?: string | null,"id"?: string,"is_default"?: boolean,"name"?: string,"position"?: number | null,"shared_collection_id"?: string | null,"sort_preference"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_collections_shared_collection_id_fkey"
      columns: ["shared_collection_id"]
isOneToOne: false
      referencedRelation: "shared_collections"
      referencedColumns: ["id"]
    }
                  ]
                },"user_intro_presentations": {
                  Row: {
                    "claimed_at": string,"intro_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "claimed_at"?: string,"intro_id": string,"user_id": string
                  }
                  Update: {
                    "claimed_at"?: string,"intro_id"?: string,"user_id"?: string
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
            "add_verse":
{ Args: { "p_book": string,"p_chapter": number,"p_collection_client_id": string,"p_keep_restored_version"?: boolean,"p_verse_end": number,"p_verse_start": number,"p_version": string }; Returns: {
              "book": string,
"chapter": number,
"client_id": string,
"created_at": string,
"deleted_at": string | null,
"id": string,
"last_chunk_size": number | null,
"last_difficulty": string | null,
"last_practiced_at": string | null,
"progress": NonNullable<Json>,
"updated_at": string,
"user_id": string,
"verse_end": number,
"verse_start": number,
"version": string
            }
                          SetofOptions: {
        from: "*"
        to: "user_verses"
        isOneToOne: true
        isSetofReturn: false
      } },
"claim_intro_presentation":
{ Args: { "p_intro_id": string }; Returns: boolean
                           },
"cleanup_expired_verse_cache":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"cleanup_stale_transcription_locks":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"copy_verse_to_collection":
{ Args: { "collection_client_id": string,"verse_client_id": string }; Returns: {
              "added_at": string,
"collection_id": string,
"id": string,
"verse_id": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "verse_collections"
        isOneToOne: false
        isSetofReturn: true
      } },
"delete_collection":
{ Args: { "collection_client_id": string }; Returns: undefined
                           },
"delete_own_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"delete_verse":
{ Args: { "collection_client_id": string,"verse_client_id": string }; Returns: undefined
                           },
"evict_lru_verses":
{ Args: { "p_max_count": number,"p_needed": number,"p_version": string }; Returns: number
                           },
"get_cron_secret":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_curated_collection_saver_counts":
{ Args: { "p_catalog_ids": (string)[] }; Returns: {
              "catalog_id": string,"saver_count": number
            }[]
                           },
"get_current_streak":
{ Args: { "p_tz_offset_min": number,"p_user_id": string }; Returns: number
                           },
"get_shared_members":
{ Args: { "p_shared": string }; Returns: {
              "display_name": string,"joined_at": string,"role": string,"user_id": string
            }[]
                           },
"get_shared_progress":
{ Args: { "p_shared": string }; Returns: {
              "book": string,"chapter": number,"engraved": boolean,"mastered": boolean,"practiced": boolean,"user_id": string,"verse_end": number,"verse_start": number
            }[]
                           },
"get_shared_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "engraved_squares": number,"mastered_squares": number,"member_count": number,"shared_id": string,"verse_count": number
            }[]
                           },
"get_total_time_studied":
{ Args: { "p_user_id": string }; Returns: number
                           },
"get_verse_cache_count":
{ Args: { "p_version": string }; Returns: number
                           },
"import_curated_collection":
{ Args: { "p_catalog_id": string,"p_icon_key": string,"p_name": string,"p_passages": Json,"p_version": string }; Returns: string
                           },
"join_shared_collection":
{ Args: { "p_code": string,"p_version": string }; Returns: string
                           },
"leave_shared_collection":
{ Args: { "p_shared": string }; Returns: undefined
                           },
"local_time_in_tz":
{ Args: { "tz": string }; Returns: string
                           },
"mint_invite":
{ Args: { "p_shared": string }; Returns: {
              "code": string,"expires_at": string
            }[]
                           },
"preview_invite":
{ Args: { "p_code": string }; Returns: {
              "already_member": boolean,"inviter_name": string,"member_count": number,"name": string,"shared_id": string,"verse_count": number
            }[]
                           },
"register_device_token":
{ Args: { "p_expo_token": string,"p_platform": string }; Returns: undefined
                           },
"remove_shared_member":
{ Args: { "p_shared": string,"p_user": string }; Returns: undefined
                           },
"reorder_collections":
{ Args: { "collection_ids": (string)[] }; Returns: undefined
                           },
"share_collection":
{ Args: { "p_collection_client_id": string }; Returns: {
              "code": string,"shared_id": string
            }[]
                           },
"sync_shared_collection":
{ Args: { "p_shared": string,"p_version": string }; Returns: {
              "changed": boolean,"client_id": string
            }[]
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
