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
      auditoria: {
        Row: {
          accion: Database["public"]["Enums"]["accion_auditoria"]
          datos_antes: Json | null
          datos_despues: Json | null
          id: number
          ocurrido_en: string
          organizacion_id: string | null
          registro_id: string | null
          tabla: string
          usuario_id: string | null
        }
        Insert: {
          accion: Database["public"]["Enums"]["accion_auditoria"]
          datos_antes?: Json | null
          datos_despues?: Json | null
          id?: never
          ocurrido_en?: string
          organizacion_id?: string | null
          registro_id?: string | null
          tabla: string
          usuario_id?: string | null
        }
        Update: {
          accion?: Database["public"]["Enums"]["accion_auditoria"]
          datos_antes?: Json | null
          datos_despues?: Json | null
          id?: never
          ocurrido_en?: string
          organizacion_id?: string | null
          registro_id?: string | null
          tabla?: string
          usuario_id?: string | null
        }
        Relationships: []
      }
      avisos: {
        Row: {
          canal: string
          clave_regla: string
          creado_en: string
          destinatario: string | null
          enviado_en: string | null
          error: string | null
          exito: boolean | null
          id: number
          organizacion_id: string
          programado_para: string
          vencimiento_id: string
        }
        Insert: {
          canal?: string
          clave_regla: string
          creado_en?: string
          destinatario?: string | null
          enviado_en?: string | null
          error?: string | null
          exito?: boolean | null
          id?: never
          organizacion_id: string
          programado_para: string
          vencimiento_id: string
        }
        Update: {
          canal?: string
          clave_regla?: string
          creado_en?: string
          destinatario?: string | null
          enviado_en?: string | null
          error?: string | null
          exito?: boolean | null
          id?: never
          organizacion_id?: string
          programado_para?: string
          vencimiento_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avisos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_vencimiento_id_fkey"
            columns: ["vencimiento_id"]
            isOneToOne: false
            referencedRelation: "v_vencimientos_estado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_vencimiento_id_fkey"
            columns: ["vencimiento_id"]
            isOneToOne: false
            referencedRelation: "vencimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      flotas: {
        Row: {
          activa: boolean
          actualizado_en: string
          creado_en: string
          descripcion: string | null
          id: string
          nombre: string
          organizacion_id: string
        }
        Insert: {
          activa?: boolean
          actualizado_en?: string
          creado_en?: string
          descripcion?: string | null
          id?: string
          nombre: string
          organizacion_id: string
        }
        Update: {
          activa?: boolean
          actualizado_en?: string
          creado_en?: string
          descripcion?: string | null
          id?: string
          nombre?: string
          organizacion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flotas_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      invitaciones: {
        Row: {
          actualizado_en: string
          anulada: boolean
          codigo: string
          creada_por: string | null
          creado_en: string
          email: string | null
          expira_en: string
          id: string
          organizacion_id: string
          rol: Database["public"]["Enums"]["rol_miembro"]
          telefono: string | null
          telefono_clave: string | null
          usada_en: string | null
          usada_por: string | null
        }
        Insert: {
          actualizado_en?: string
          anulada?: boolean
          codigo: string
          creada_por?: string | null
          creado_en?: string
          email?: string | null
          expira_en: string
          id?: string
          organizacion_id: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          telefono?: string | null
          telefono_clave?: string | null
          usada_en?: string | null
          usada_por?: string | null
        }
        Update: {
          actualizado_en?: string
          anulada?: boolean
          codigo?: string
          creada_por?: string | null
          creado_en?: string
          email?: string | null
          expira_en?: string
          id?: string
          organizacion_id?: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          telefono?: string | null
          telefono_clave?: string | null
          usada_en?: string | null
          usada_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitaciones_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      miembros: {
        Row: {
          actualizado_en: string
          creado_en: string
          id: string
          organizacion_id: string
          rol: Database["public"]["Enums"]["rol_miembro"]
          usuario_id: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          id?: string
          organizacion_id: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          usuario_id: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          id?: string
          organizacion_id?: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "miembros_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      organizaciones: {
        Row: {
          activa: boolean
          actualizado_en: string
          creado_en: string
          cuit: string | null
          id: string
          nombre: string
          zona_horaria: string
        }
        Insert: {
          activa?: boolean
          actualizado_en?: string
          creado_en?: string
          cuit?: string | null
          id?: string
          nombre: string
          zona_horaria?: string
        }
        Update: {
          activa?: boolean
          actualizado_en?: string
          creado_en?: string
          cuit?: string | null
          id?: string
          nombre?: string
          zona_horaria?: string
        }
        Relationships: []
      }
      pagos: {
        Row: {
          actualizado_en: string
          anulado: boolean
          comprobante_url: string | null
          creado_en: string
          fecha_pago: string
          id: string
          medio_pago: Database["public"]["Enums"]["medio_pago"]
          moneda: string
          monto: number
          motivo_anulacion: string | null
          notas: string | null
          organizacion_id: string
          referencia: string | null
          registrado_por: string | null
          vencimiento_id: string
        }
        Insert: {
          actualizado_en?: string
          anulado?: boolean
          comprobante_url?: string | null
          creado_en?: string
          fecha_pago: string
          id?: string
          medio_pago?: Database["public"]["Enums"]["medio_pago"]
          moneda?: string
          monto: number
          motivo_anulacion?: string | null
          notas?: string | null
          organizacion_id: string
          referencia?: string | null
          registrado_por?: string | null
          vencimiento_id: string
        }
        Update: {
          actualizado_en?: string
          anulado?: boolean
          comprobante_url?: string | null
          creado_en?: string
          fecha_pago?: string
          id?: string
          medio_pago?: Database["public"]["Enums"]["medio_pago"]
          moneda?: string
          monto?: number
          motivo_anulacion?: string | null
          notas?: string | null
          organizacion_id?: string
          referencia?: string | null
          registrado_por?: string | null
          vencimiento_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_vencimiento_misma_organizacion"
            columns: ["vencimiento_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "v_vencimientos_estado"
            referencedColumns: ["id", "organizacion_id"]
          },
          {
            foreignKeyName: "pagos_vencimiento_misma_organizacion"
            columns: ["vencimiento_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "vencimientos"
            referencedColumns: ["id", "organizacion_id"]
          },
        ]
      }
      reglas_aviso: {
        Row: {
          activa: boolean
          actualizado_en: string
          avisar_el_dia: boolean
          creado_en: string
          dias_antes: number[]
          dias_despues: number[]
          id: string
          organizacion_id: string
          tipo_obligacion_id: string | null
        }
        Insert: {
          activa?: boolean
          actualizado_en?: string
          avisar_el_dia?: boolean
          creado_en?: string
          dias_antes?: number[]
          dias_despues?: number[]
          id?: string
          organizacion_id: string
          tipo_obligacion_id?: string | null
        }
        Update: {
          activa?: boolean
          actualizado_en?: string
          avisar_el_dia?: boolean
          creado_en?: string
          dias_antes?: number[]
          dias_despues?: number[]
          id?: string
          organizacion_id?: string
          tipo_obligacion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reglas_aviso_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reglas_aviso_tipo_misma_organizacion"
            columns: ["tipo_obligacion_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "tipos_obligacion"
            referencedColumns: ["id", "organizacion_id"]
          },
        ]
      }
      reglas_vencimiento: {
        Row: {
          activa: boolean
          actualizado_en: string
          creado_en: string
          dia_vencimiento: number
          frecuencia: Database["public"]["Enums"]["frecuencia"]
          id: string
          mes_inicio: number
          meses_cuotas: number[] | null
          moneda: string
          monto_estimado: number | null
          notas: string | null
          organizacion_id: string
          tipo_obligacion_id: string
          vehiculo_id: string
          vigente_desde: string
          vigente_hasta: string | null
        }
        Insert: {
          activa?: boolean
          actualizado_en?: string
          creado_en?: string
          dia_vencimiento: number
          frecuencia: Database["public"]["Enums"]["frecuencia"]
          id?: string
          mes_inicio?: number
          meses_cuotas?: number[] | null
          moneda?: string
          monto_estimado?: number | null
          notas?: string | null
          organizacion_id: string
          tipo_obligacion_id: string
          vehiculo_id: string
          vigente_desde: string
          vigente_hasta?: string | null
        }
        Update: {
          activa?: boolean
          actualizado_en?: string
          creado_en?: string
          dia_vencimiento?: number
          frecuencia?: Database["public"]["Enums"]["frecuencia"]
          id?: string
          mes_inicio?: number
          meses_cuotas?: number[] | null
          moneda?: string
          monto_estimado?: number | null
          notas?: string | null
          organizacion_id?: string
          tipo_obligacion_id?: string
          vehiculo_id?: string
          vigente_desde?: string
          vigente_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reglas_tipo_misma_organizacion"
            columns: ["tipo_obligacion_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "tipos_obligacion"
            referencedColumns: ["id", "organizacion_id"]
          },
          {
            foreignKeyName: "reglas_vehiculo_misma_organizacion"
            columns: ["vehiculo_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "vehiculos"
            referencedColumns: ["id", "organizacion_id"]
          },
          {
            foreignKeyName: "reglas_vencimiento_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      resumenes_flota: {
        Row: {
          actualizado_en: string
          cantidad_pendientes: number
          cantidad_vencidos: number
          flota_id: string
          monto_por_vencer_30d: number
          monto_vencido: number
          organizacion_id: string
          proximo_vencimiento: string | null
          total_vehiculos: number
          vehiculos_activos: number
        }
        Insert: {
          actualizado_en?: string
          cantidad_pendientes?: number
          cantidad_vencidos?: number
          flota_id: string
          monto_por_vencer_30d?: number
          monto_vencido?: number
          organizacion_id: string
          proximo_vencimiento?: string | null
          total_vehiculos?: number
          vehiculos_activos?: number
        }
        Update: {
          actualizado_en?: string
          cantidad_pendientes?: number
          cantidad_vencidos?: number
          flota_id?: string
          monto_por_vencer_30d?: number
          monto_vencido?: number
          organizacion_id?: string
          proximo_vencimiento?: string | null
          total_vehiculos?: number
          vehiculos_activos?: number
        }
        Relationships: [
          {
            foreignKeyName: "resumenes_flota_misma_organizacion"
            columns: ["flota_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "flotas"
            referencedColumns: ["id", "organizacion_id"]
          },
        ]
      }
      tipos_obligacion: {
        Row: {
          activo: boolean
          actualizado_en: string
          codigo: string
          creado_en: string
          id: string
          instrucciones: string | null
          jurisdiccion: Database["public"]["Enums"]["jurisdiccion"]
          moneda: string
          nombre: string
          organismo: string | null
          organizacion_id: string
          url_pago_plantilla: string | null
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          codigo: string
          creado_en?: string
          id?: string
          instrucciones?: string | null
          jurisdiccion: Database["public"]["Enums"]["jurisdiccion"]
          moneda?: string
          nombre: string
          organismo?: string | null
          organizacion_id: string
          url_pago_plantilla?: string | null
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          codigo?: string
          creado_en?: string
          id?: string
          instrucciones?: string | null
          jurisdiccion?: Database["public"]["Enums"]["jurisdiccion"]
          moneda?: string
          nombre?: string
          organismo?: string | null
          organizacion_id?: string
          url_pago_plantilla?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tipos_obligacion_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      vehiculos: {
        Row: {
          actualizado_en: string
          anio: number | null
          creado_en: string
          dominio: string
          estado: Database["public"]["Enums"]["estado_vehiculo"]
          fecha_alta: string
          fecha_baja: string | null
          flota_id: string
          id: string
          marca: string | null
          modelo: string | null
          notas: string | null
          numero_chasis: string | null
          numero_motor: string | null
          organizacion_id: string
          tipo: Database["public"]["Enums"]["tipo_vehiculo"]
        }
        Insert: {
          actualizado_en?: string
          anio?: number | null
          creado_en?: string
          dominio: string
          estado?: Database["public"]["Enums"]["estado_vehiculo"]
          fecha_alta: string
          fecha_baja?: string | null
          flota_id: string
          id?: string
          marca?: string | null
          modelo?: string | null
          notas?: string | null
          numero_chasis?: string | null
          numero_motor?: string | null
          organizacion_id: string
          tipo?: Database["public"]["Enums"]["tipo_vehiculo"]
        }
        Update: {
          actualizado_en?: string
          anio?: number | null
          creado_en?: string
          dominio?: string
          estado?: Database["public"]["Enums"]["estado_vehiculo"]
          fecha_alta?: string
          fecha_baja?: string | null
          flota_id?: string
          id?: string
          marca?: string | null
          modelo?: string | null
          notas?: string | null
          numero_chasis?: string | null
          numero_motor?: string | null
          organizacion_id?: string
          tipo?: Database["public"]["Enums"]["tipo_vehiculo"]
        }
        Relationships: [
          {
            foreignKeyName: "vehiculos_flota_misma_organizacion"
            columns: ["flota_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "flotas"
            referencedColumns: ["id", "organizacion_id"]
          },
          {
            foreignKeyName: "vehiculos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      vencimientos: {
        Row: {
          actualizado_en: string
          creado_en: string
          estado: Database["public"]["Enums"]["estado_vencimiento"]
          fecha_vencimiento: string
          id: string
          moneda: string
          monto_estimado: number | null
          monto_real: number | null
          notas: string | null
          numero_boleta: string | null
          numero_cuota: number | null
          organizacion_id: string
          periodo: string
          regla_id: string | null
          tipo_obligacion_id: string
          url_pago: string | null
          vehiculo_id: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          estado?: Database["public"]["Enums"]["estado_vencimiento"]
          fecha_vencimiento: string
          id?: string
          moneda?: string
          monto_estimado?: number | null
          monto_real?: number | null
          notas?: string | null
          numero_boleta?: string | null
          numero_cuota?: number | null
          organizacion_id: string
          periodo: string
          regla_id?: string | null
          tipo_obligacion_id: string
          url_pago?: string | null
          vehiculo_id: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          estado?: Database["public"]["Enums"]["estado_vencimiento"]
          fecha_vencimiento?: string
          id?: string
          moneda?: string
          monto_estimado?: number | null
          monto_real?: number | null
          notas?: string | null
          numero_boleta?: string | null
          numero_cuota?: number | null
          organizacion_id?: string
          periodo?: string
          regla_id?: string | null
          tipo_obligacion_id?: string
          url_pago?: string | null
          vehiculo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vencimientos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_regla_id_fkey"
            columns: ["regla_id"]
            isOneToOne: false
            referencedRelation: "reglas_vencimiento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_tipo_misma_organizacion"
            columns: ["tipo_obligacion_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "tipos_obligacion"
            referencedColumns: ["id", "organizacion_id"]
          },
          {
            foreignKeyName: "vencimientos_vehiculo_misma_organizacion"
            columns: ["vehiculo_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "vehiculos"
            referencedColumns: ["id", "organizacion_id"]
          },
        ]
      }
      vinculos_chat: {
        Row: {
          canal: Database["public"]["Enums"]["canal_chat"]
          id: string
          identificador_externo: string
          jid_crudo: string | null
          nombre_mostrado: string | null
          organizacion_activa_id: string | null
          telefono: string | null
          telefono_clave: string | null
          ultimo_uso_en: string | null
          usuario_id: string
          vinculado_en: string
        }
        Insert: {
          canal: Database["public"]["Enums"]["canal_chat"]
          id?: string
          identificador_externo: string
          jid_crudo?: string | null
          nombre_mostrado?: string | null
          organizacion_activa_id?: string | null
          telefono?: string | null
          telefono_clave?: string | null
          ultimo_uso_en?: string | null
          usuario_id: string
          vinculado_en?: string
        }
        Update: {
          canal?: Database["public"]["Enums"]["canal_chat"]
          id?: string
          identificador_externo?: string
          jid_crudo?: string | null
          nombre_mostrado?: string | null
          organizacion_activa_id?: string | null
          telefono?: string | null
          telefono_clave?: string | null
          ultimo_uso_en?: string | null
          usuario_id?: string
          vinculado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "vinculos_chat_organizacion_activa_id_fkey"
            columns: ["organizacion_activa_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_vencimientos_estado: {
        Row: {
          actualizado_en: string | null
          creado_en: string | null
          dias_para_vencer: number | null
          dominio: string | null
          estado: Database["public"]["Enums"]["estado_vencimiento"] | null
          estado_efectivo: Database["public"]["Enums"]["estado_efectivo"] | null
          fecha_vencimiento: string | null
          flota_id: string | null
          id: string | null
          moneda: string | null
          monto_estimado: number | null
          monto_real: number | null
          monto_vigente: number | null
          notas: string | null
          numero_boleta: string | null
          numero_cuota: number | null
          organizacion_id: string | null
          periodo: string | null
          regla_id: string | null
          tipo_codigo: string | null
          tipo_nombre: string | null
          tipo_obligacion_id: string | null
          url_pago: string | null
          vehiculo_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vencimientos_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_regla_id_fkey"
            columns: ["regla_id"]
            isOneToOne: false
            referencedRelation: "reglas_vencimiento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_tipo_misma_organizacion"
            columns: ["tipo_obligacion_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "tipos_obligacion"
            referencedColumns: ["id", "organizacion_id"]
          },
          {
            foreignKeyName: "vencimientos_vehiculo_misma_organizacion"
            columns: ["vehiculo_id", "organizacion_id"]
            isOneToOne: false
            referencedRelation: "vehiculos"
            referencedColumns: ["id", "organizacion_id"]
          },
        ]
      }
    }
    Functions: {
      aplicar_invitacion: {
        Args: {
          p_canal: Database["public"]["Enums"]["canal_chat"]
          p_identificador_externo: string
          p_invitacion_id: string
          p_nombre_mostrado: string
          p_telefono_verificado: string
          p_usuario_id: string
        }
        Returns: Json
      }
      cambiar_organizacion_activa: {
        Args: {
          p_canal: Database["public"]["Enums"]["canal_chat"]
          p_identificador_externo: string
          p_organizacion_id: string
        }
        Returns: Json
      }
      canjear_invitacion: {
        Args: {
          p_canal: Database["public"]["Enums"]["canal_chat"]
          p_codigo: string
          p_identificador_externo: string
          p_nombre_mostrado?: string
          p_usuario_id: string
        }
        Returns: Json
      }
      canjear_por_telefono: {
        Args: {
          p_canal: Database["public"]["Enums"]["canal_chat"]
          p_identificador_externo: string
          p_nombre_mostrado?: string
          p_telefono_verificado: string
          p_usuario_id: string
        }
        Returns: Json
      }
      clave_telefono: { Args: { p_telefono: string }; Returns: string }
      contexto_chat: {
        Args: {
          p_canal: Database["public"]["Enums"]["canal_chat"]
          p_identificador_externo: string
        }
        Returns: Json
      }
      crear_invitacion: {
        Args: {
          p_dias_validez?: number
          p_email?: string
          p_organizacion_id: string
          p_rol?: Database["public"]["Enums"]["rol_miembro"]
          p_telefono?: string
        }
        Returns: Json
      }
      desvincular_chat: {
        Args: {
          p_canal: Database["public"]["Enums"]["canal_chat"]
          p_identificador_externo: string
        }
        Returns: boolean
      }
      detalle_vehiculo: { Args: { p_vehiculo_id: string }; Returns: Json }
      es_miembro: { Args: { p_organizacion_id: string }; Returns: boolean }
      es_tarea_de_sistema: { Args: never; Returns: boolean }
      estado_segun_pagos: {
        Args: {
          p_estado_actual: Database["public"]["Enums"]["estado_vencimiento"]
          p_total: number
          p_vencimiento_id: string
        }
        Returns: Database["public"]["Enums"]["estado_vencimiento"]
      }
      estado_tarea_diaria: { Args: never; Returns: Json }
      fecha_de_cuota: {
        Args: { p_anio: number; p_dia: number; p_mes: number }
        Returns: string
      }
      generar_codigo_invitacion: { Args: never; Returns: string }
      generar_vencimientos: {
        Args: { p_horizonte_meses?: number; p_regla_id: string }
        Returns: number
      }
      generar_vencimientos_organizacion: {
        Args: { p_horizonte_meses?: number; p_organizacion_id: string }
        Returns: number
      }
      hoy_en_organizacion: {
        Args: { p_organizacion_id: string }
        Returns: string
      }
      importar_vehiculos: {
        Args: { p_filas: Json; p_flota_id: string; p_organizacion_id: string }
        Returns: Json
      }
      link_de_pago: { Args: { p_vencimiento_id: string }; Returns: Json }
      meses_por_frecuencia: {
        Args: { p_frecuencia: Database["public"]["Enums"]["frecuencia"] }
        Returns: number
      }
      normalizar_telefono: { Args: { p_telefono: string }; Returns: string }
      organizaciones_del_usuario: { Args: never; Returns: string[] }
      programar_avisos: {
        Args: { p_organizacion_id: string; p_ventana_dias?: number }
        Returns: number
      }
      puede_administrar: {
        Args: { p_organizacion_id: string }
        Returns: boolean
      }
      puede_operar: { Args: { p_organizacion_id: string }; Returns: boolean }
      recalcular_resumen_flota: {
        Args: { p_flota_id: string }
        Returns: undefined
      }
      registrar_organizacion: {
        Args: {
          p_cuit?: string
          p_email_admin?: string
          p_nombre: string
          p_nombre_flota?: string
          p_telefono_admin: string
          p_zona_horaria?: string
        }
        Returns: Json
      }
      reporte_gastos: {
        Args: {
          p_agrupar_por?: string
          p_desde: string
          p_hasta: string
          p_organizacion_id: string
        }
        Returns: {
          cantidad: number
          clave: string
          etiqueta: string
          monto: number
        }[]
      }
      resumen_flota: { Args: { p_flota_id: string }; Returns: Json }
      sembrar_catalogo_cordoba: {
        Args: { p_organizacion_id: string }
        Returns: number
      }
      tarea_diaria: { Args: { p_horizonte_meses?: number }; Returns: Json }
      tiene_rol: {
        Args: {
          p_organizacion_id: string
          p_roles: Database["public"]["Enums"]["rol_miembro"][]
        }
        Returns: boolean
      }
    }
    Enums: {
      accion_auditoria: "alta" | "modificacion" | "baja"
      canal_chat: "whatsapp"
      estado_efectivo:
        | "pendiente"
        | "parcial"
        | "vencido"
        | "pagado"
        | "condonado"
        | "anulado"
      estado_vehiculo: "activo" | "inactivo" | "vendido" | "baja"
      estado_vencimiento:
        | "pendiente"
        | "parcial"
        | "pagado"
        | "condonado"
        | "anulado"
      frecuencia:
        | "mensual"
        | "bimestral"
        | "trimestral"
        | "cuatrimestral"
        | "semestral"
        | "anual"
        | "unica"
      jurisdiccion: "provincial" | "municipal" | "nacional" | "privado"
      medio_pago:
        | "transferencia"
        | "debito_automatico"
        | "efectivo"
        | "tarjeta"
        | "homebanking"
        | "pago_facil"
        | "rapipago"
        | "otro"
      rol_miembro: "propietario" | "administrador" | "operador" | "lector"
      tipo_vehiculo:
        | "auto"
        | "camioneta"
        | "moto"
        | "camion"
        | "acoplado"
        | "utilitario"
        | "otro"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      accion_auditoria: ["alta", "modificacion", "baja"],
      canal_chat: ["whatsapp"],
      estado_efectivo: [
        "pendiente",
        "parcial",
        "vencido",
        "pagado",
        "condonado",
        "anulado",
      ],
      estado_vehiculo: ["activo", "inactivo", "vendido", "baja"],
      estado_vencimiento: [
        "pendiente",
        "parcial",
        "pagado",
        "condonado",
        "anulado",
      ],
      frecuencia: [
        "mensual",
        "bimestral",
        "trimestral",
        "cuatrimestral",
        "semestral",
        "anual",
        "unica",
      ],
      jurisdiccion: ["provincial", "municipal", "nacional", "privado"],
      medio_pago: [
        "transferencia",
        "debito_automatico",
        "efectivo",
        "tarjeta",
        "homebanking",
        "pago_facil",
        "rapipago",
        "otro",
      ],
      rol_miembro: ["propietario", "administrador", "operador", "lector"],
      tipo_vehiculo: [
        "auto",
        "camioneta",
        "moto",
        "camion",
        "acoplado",
        "utilitario",
        "otro",
      ],
    },
  },
} as const
