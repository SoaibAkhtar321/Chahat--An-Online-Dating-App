export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      account_state: {
        Row: {
          data: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          data?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          data?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      admin_audit: {
        Row: {
          action: string;
          admin_id: string;
          created_at: string;
          id: string;
          note: string;
          target: string | null;
        };
        Insert: {
          action: string;
          admin_id: string;
          created_at?: string;
          id?: string;
          note?: string;
          target?: string | null;
        };
        Update: {
          action?: string;
          admin_id?: string;
          created_at?: string;
          id?: string;
          note?: string;
          target?: string | null;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          blocked: string;
          blocker: string;
          created_at: string;
        };
        Insert: {
          blocked: string;
          blocker: string;
          created_at?: string;
        };
        Update: {
          blocked?: string;
          blocker?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      matches: {
        Row: {
          created_at: string;
          id: string;
          user_a: string;
          user_b: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          user_a: string;
          user_b: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          user_a?: string;
          user_b?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          image_path: string | null;
          match_id: string;
          read_at: string | null;
          sender: string;
        };
        Insert: {
          body?: string;
          created_at?: string;
          id?: string;
          image_path?: string | null;
          match_id: string;
          read_at?: string | null;
          sender: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          image_path?: string | null;
          match_id?: string;
          read_at?: string | null;
          sender?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          bio: string;
          city: string;
          created_at: string;
          dob: string | null;
          education: string;
          gender: string;
          id: string;
          intents: string[];
          interests: string[];
          is_demo: boolean;
          languages: string[];
          last_active: string;
          lifestyle: Json;
          likes_you: boolean;
          name: string;
          onboarded: boolean;
          photos: Json;
          prompt: Json;
          seeking: string;
          status: string;
          user_id: string | null;
          work: string;
        };
        Insert: {
          bio?: string;
          city?: string;
          created_at?: string;
          dob?: string | null;
          education?: string;
          gender?: string;
          id: string;
          intents?: string[];
          interests?: string[];
          is_demo?: boolean;
          languages?: string[];
          last_active?: string;
          lifestyle?: Json;
          likes_you?: boolean;
          name?: string;
          onboarded?: boolean;
          photos?: Json;
          prompt?: Json;
          seeking?: string;
          status?: string;
          user_id?: string | null;
          work?: string;
        };
        Update: {
          bio?: string;
          city?: string;
          created_at?: string;
          dob?: string | null;
          education?: string;
          gender?: string;
          id?: string;
          intents?: string[];
          interests?: string[];
          is_demo?: boolean;
          languages?: string[];
          last_active?: string;
          lifestyle?: Json;
          likes_you?: boolean;
          name?: string;
          onboarded?: boolean;
          photos?: Json;
          prompt?: Json;
          seeking?: string;
          status?: string;
          user_id?: string | null;
          work?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          category: string;
          created_at: string;
          id: string;
          note: string;
          reporter: string;
          source: string;
          status: string;
          target: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          id?: string;
          note?: string;
          reporter: string;
          source?: string;
          status?: string;
          target: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          id?: string;
          note?: string;
          reporter?: string;
          source?: string;
          status?: string;
          target?: string;
        };
        Relationships: [];
      };
      swipes: {
        Row: {
          created_at: string;
          from_id: string;
          kind: string;
          to_id: string;
        };
        Insert: {
          created_at?: string;
          from_id: string;
          kind: string;
          to_id: string;
        };
        Update: {
          created_at?: string;
          from_id?: string;
          kind?: string;
          to_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      chat_folder_member: { Args: { _folder: string }; Returns: boolean };
      demo_reply: { Args: { _match: string }; Returns: undefined };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_blocked_pair: { Args: { _a: string; _b: string }; Returns: boolean };
      is_match_member: { Args: { _match: string }; Returns: boolean };
    };
    Enums: {
      app_role: "admin" | "moderator" | "user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const;
