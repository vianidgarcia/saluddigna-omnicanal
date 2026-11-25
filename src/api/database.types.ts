
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "api": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "agenda_clinica":
{ Args: { "p_clinica_id": string,"p_fecha"?: string }; Returns: Json
                           },
"agregar_beneficiario":
{ Args: { "p_apellido_materno": string,"p_apellido_paterno": string,"p_es_tutor_legal"?: boolean,"p_fecha_nacimiento": string,"p_interaccion_id": string,"p_nombre": string,"p_relacion": string,"p_sexo": string }; Returns: Json
                           },
"avanzar_tramite":
{ Args: { "p_clave_idempotencia"?: string,"p_datos"?: Json,"p_interaccion_id": string,"p_paso": string,"p_tramite_id": string,"p_version": number }; Returns: Json
                           },
"bandeja_atencion":
{ Args: { "p_canal"?: string,"p_categoria"?: string,"p_clinica_id"?: string,"p_cursor"?: string,"p_desde"?: string,"p_estado"?: string,"p_hasta"?: string,"p_limite"?: number }; Returns: Json
                           },
"buscar_conocimiento":
{ Args: { "p_categoria"?: string,"p_consulta": string,"p_embedding": string,"p_limite"?: number }; Returns: {
              "categoria": string,"contenido": string,"documento_id": string,"fragmento_id": string,"puntaje": number,"titulo": string
            }[]
                           },
"buscar_pacientes":
{ Args: { "p_limite"?: number,"p_texto": string }; Returns: Json
                           },
"catalogo_estudios":
{ Args: { "p_busqueda"?: string,"p_categoria"?: string }; Returns: Json
                           },
"cerrar_interaccion":
{ Args: { "p_interaccion_id": string,"p_resultado"?: string }; Returns: undefined
                           },
"clinicas_para_estudio":
{ Args: { "p_ciudad"?: string,"p_estado"?: string,"p_estudio_id": string }; Returns: Json
                           },
"cola_confirmar":
{ Args: { "p_cola": string,"p_msg_id": number }; Returns: boolean
                           },
"cola_leer":
{ Args: { "p_cantidad"?: number,"p_cola": string,"p_visibilidad_seg"?: number }; Returns: Json
                           },
"confirmar_pago":
{ Args: { "p_datos"?: Json,"p_estado": string,"p_referencia": string }; Returns: Json
                           },
"generar_pago":
{ Args: { "p_interaccion_id": string,"p_tramite_id": string,"p_version": number }; Returns: Json
                           },
"guardar_datos_paciente":
{ Args: { "p_apellido_materno"?: string,"p_apellido_paterno"?: string,"p_fecha_nacimiento"?: string,"p_interaccion_id": string,"p_nombre"?: string,"p_sexo"?: string }; Returns: Json
                           },
"guardar_resumen":
{ Args: { "p_leido_en": string,"p_resumen": string,"p_tramite_id": string }; Returns: undefined
                           },
"horarios_disponibles":
{ Args: { "p_clinica_id": string,"p_desde"?: string,"p_dias"?: number,"p_estudio_id": string,"p_inmediato"?: boolean }; Returns: Json
                           },
"iniciar_contacto":
{ Args: { "p_agente": string,"p_canal": string,"p_nivel"?: string,"p_telefono": string }; Returns: Json
                           },
"iniciar_sesion_paciente":
{ Args: { "p_canal"?: string }; Returns: Json
                           },
"iniciar_tramite":
{ Args: { "p_beneficiario_id"?: string,"p_estudio_id": string,"p_interaccion_id": string,"p_tipo"?: string }; Returns: Json
                           },
"journey_paciente":
{ Args: { "p_limite"?: number,"p_paciente_id": string }; Returns: Json
                           },
"kb_guardar_documento":
{ Args: { "p_categoria": string,"p_fragmentos": Json,"p_fuente": string,"p_reemplaza"?: string,"p_titulo": string }; Returns: string
                           },
"material_resumen":
{ Args: { "p_tramite_id": string }; Returns: Json
                           },
"metricas":
{ Args: { "p_clinica_id"?: string,"p_desde": string,"p_hasta": string }; Returns: Json
                           },
"mis_beneficiarios":
{ Args: { "p_interaccion_id": string }; Returns: Json
                           },
"obtener_contexto":
{ Args: { "p_interaccion_id": string }; Returns: Json
                           },
"procesar_aviso_whatsapp":
{ Args: { "p_evento_id": string,"p_ocurrido_en": string,"p_paciente_id": string }; Returns: Json
                           },
"registrar_consentimiento_avisos":
{ Args: { "p_acepta": boolean,"p_interaccion_id": string }; Returns: Json
                           },
"registrar_llegada":
{ Args: { "p_cita_id": string,"p_cumplio_preparacion"?: boolean,"p_tipo_documento": string }; Returns: Json
                           },
"registrar_mensaje":
{ Args: { "p_autor": string,"p_contenido": string,"p_direccion": string,"p_interaccion_id": string,"p_metadatos"?: Json }; Returns: string
                           },
"reservar_cita":
{ Args: { "p_fecha_hora": string,"p_interaccion_id": string,"p_tramite_id": string,"p_version": number }; Returns: Json
                           },
"retomar_tramite":
{ Args: { "p_interaccion_id": string,"p_tramite_id": string }; Returns: Json
                           },
"solicitar_otp":
{ Args: { "p_interaccion_id": string }; Returns: Json
                           },
"texto_asesor_atendiendo":
{ Args: { "p_interaccion_id": string,"p_tramite_id": string }; Returns: string
                           },
"tramites_en_curso":
{ Args: { "p_antes_de"?: string,"p_clinica_id"?: string,"p_limite"?: number,"p_paso"?: string }; Returns: Json
                           },
"validar_otp":
{ Args: { "p_codigo": string,"p_interaccion_id": string }; Returns: Json
                           },
"verificar_identidad":
{ Args: { "p_fecha_nacimiento": string,"p_interaccion_id": string }; Returns: Json
                           },
"verificar_presencial":
{ Args: { "p_cita_id"?: string,"p_interaccion_id"?: string,"p_tipo_documento"?: string }; Returns: Json
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

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "api">]

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
  "api": {
          Enums: {
            
          }
        }
} as const
