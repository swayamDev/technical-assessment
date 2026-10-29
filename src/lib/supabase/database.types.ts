
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"entity_id": string,"id": number,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"entity_id": string,"id"?: never,"org_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string,"id"?: never,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"gateway_bills": {
                  Row: {
                    "amount_sen": number,"created_at": string,"created_by": string | null,"id": string,"lease_id": string,"org_id": string,"paid_at": string | null,"status": string,"transaction_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_sen": number,"created_at"?: string,"created_by"?: string | null,"id": string,"lease_id": string,"org_id": string,"paid_at"?: string | null,"status"?: string,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_sen"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"lease_id"?: string,"org_id"?: string,"paid_at"?: string | null,"status"?: string,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gateway_bills_lease_id_org_id_fkey"
      columns: ["lease_id","org_id"]
isOneToOne: false
      referencedRelation: "leases"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "amount_sen": number,"created_at": string,"due_date": string,"id": string,"kind": string,"lease_id": string,"org_id": string,"period_end": string | null,"period_index": number | null,"period_start": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_sen": number,"created_at"?: string,"due_date": string,"id"?: string,"kind": string,"lease_id": string,"org_id": string,"period_end"?: string | null,"period_index"?: number | null,"period_start"?: string | null
                  }
                  Update: {
                    "amount_sen"?: number,"created_at"?: string,"due_date"?: string,"id"?: string,"kind"?: string,"lease_id"?: string,"org_id"?: string,"period_end"?: string | null,"period_index"?: number | null,"period_start"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_lease_id_org_id_fkey"
      columns: ["lease_id","org_id"]
isOneToOne: false
      referencedRelation: "leases"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"leases": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deposit_sen": number,"end_date": string,"id": string,"monthly_rent_sen": number,"org_id": string,"start_date": string,"tenant_id": string,"unit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deposit_sen": number,"end_date": string,"id"?: string,"monthly_rent_sen": number,"org_id": string,"start_date": string,"tenant_id": string,"unit_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deposit_sen"?: number,"end_date"?: string,"id"?: string,"monthly_rent_sen"?: number,"org_id"?: string,"start_date"?: string,"tenant_id"?: string,"unit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leases_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leases_tenant_id_org_id_fkey"
      columns: ["tenant_id","org_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "leases_unit_id_org_id_fkey"
      columns: ["unit_id","org_id"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"org_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"org_id": string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"org_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payment_allocations": {
                  Row: {
                    "amount_sen": number,"created_at": string,"id": string,"invoice_id": string,"lease_id": string,"org_id": string,"payment_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_sen": number,"created_at"?: string,"id"?: string,"invoice_id": string,"lease_id": string,"org_id": string,"payment_id": string
                  }
                  Update: {
                    "amount_sen"?: number,"created_at"?: string,"id"?: string,"invoice_id"?: string,"lease_id"?: string,"org_id"?: string,"payment_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_allocations_invoice_id_lease_id_org_id_fkey"
      columns: ["invoice_id","lease_id","org_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id","lease_id","org_id"]
    },{
      foreignKeyName: "payment_allocations_payment_id_lease_id_org_id_fkey"
      columns: ["payment_id","lease_id","org_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id","lease_id","org_id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_sen": number,"approved_at": string | null,"approved_by": string | null,"created_at": string,"gateway_bill_id": string | null,"id": string,"lease_id": string,"method": string,"org_id": string,"received_at": string,"recorded_by": string | null,"rejected_at": string | null,"rejected_by": string | null,"rejection_reason": string | null,"slip_path": string | null,"status": string,"unapplied_sen": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_sen": number,"approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"gateway_bill_id"?: string | null,"id"?: string,"lease_id": string,"method": string,"org_id": string,"received_at": string,"recorded_by"?: string | null,"rejected_at"?: string | null,"rejected_by"?: string | null,"rejection_reason"?: string | null,"slip_path"?: string | null,"status": string,"unapplied_sen"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_sen"?: number,"approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"gateway_bill_id"?: string | null,"id"?: string,"lease_id"?: string,"method"?: string,"org_id"?: string,"received_at"?: string,"recorded_by"?: string | null,"rejected_at"?: string | null,"rejected_by"?: string | null,"rejection_reason"?: string | null,"slip_path"?: string | null,"status"?: string,"unapplied_sen"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_gateway_bill_id_lease_id_org_id_fkey"
      columns: ["gateway_bill_id","lease_id","org_id"]
isOneToOne: false
      referencedRelation: "gateway_bills"
      referencedColumns: ["id","lease_id","org_id"]
    },{
      foreignKeyName: "payments_lease_id_org_id_fkey"
      columns: ["lease_id","org_id"]
isOneToOne: false
      referencedRelation: "leases"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string,"org_id": string,"phone": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name": string,"id"?: string,"org_id": string,"phone"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string,"org_id"?: string,"phone"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tenants_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"units": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "units_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
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
  "public": {
          Enums: {
            
          }
        }
} as const
