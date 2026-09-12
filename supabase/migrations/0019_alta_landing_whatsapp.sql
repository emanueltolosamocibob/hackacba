-- =============================================================================
-- 0019 - Alta desde la landing web con OTP y finalizador sin argumentos
--
-- CONTEXTO: hasta aca, entrar a una flota necesitaba una invitacion previa.
-- Esta migracion agrega el camino de autoservicio: la persona valida su
-- telefono por OTP en la landing (Supabase Auth + WAHA), y una sola llamada
-- de servidor, sin argumentos, deja todo listo. El identificador de quien
-- llama nunca viaja como parametro: se deriva de auth.uid() y del telefono
-- que Auth ya confirmo. Eso es lo que hace que el RPC sea seguro para un JWT
-- de usuario final.
--
-- FORMATO DE TELEFONO: el telefono que guarda Auth en auth.users.phone NO
-- lleva el signo "+" (ej. "5493511234567", no "+5493511234567"), aunque se lo
-- hayamos pedido con "+" al crear la cuenta. 0018_remediar_formato_telefono_auth
-- ya resolvio esto hacia adelante con canonicalizar_telefono_argentino(), que
-- acepta el telefono de Auth con o sin "+" y devuelve la forma canonica
-- "+54" + 10 digitos. Este finalizador reutiliza esa funcion en lugar de
-- volver a resolver el formato por su cuenta.
--
-- Tablas nuevas sin RLS de cliente ni GRANT de tabla: solo las tocan
-- funciones SECURITY DEFINER. Nacen sin permisos (0011 revoca EXECUTE por
-- defecto); cada funcion que el cliente deba llamar recibe su GRANT propio.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Entregas de OTP: solo el estado de la entrega, nunca el codigo
-- ---------------------------------------------------------------------------

create type public.estado_entrega_otp as enum ('en_curso', 'enviada', 'fallida', 'limitada');

create table public.entregas_otp (
  id_entrega     text primary key,
  telefono_clave text not null,
  estado         public.estado_entrega_otp not null default 'en_curso',
  intentos       smallint not null default 1 check (intentos between 1 and 3),
  id_proveedor   text,
  codigo_error   text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.entregas_otp is
  'Estado de cada intento de entrega de OTP por WhatsApp. Nunca guarda el codigo '
  'ni el payload del proveedor: solo lo necesario para deduplicar y limitar.';

comment on column public.entregas_otp.id_entrega is
  'Clave de idempotencia del hook de Auth (webhook-id de Standard Webhooks).';

create index entregas_otp_telefono_idx on public.entregas_otp (telefono_clave, creado_en);

alter table public.entregas_otp enable row level security;
-- Sin politicas ni GRANT de tabla: solo la tocan reservar/cerrar_entrega_otp.

-- ---------------------------------------------------------------------------
-- Auditoria minima de invocaciones de las Edge Functions de alta
-- ---------------------------------------------------------------------------

create table public.invocaciones_funcion (
  id          bigint generated always as identity primary key,
  funcion     text not null,
  resultado   text not null,
  latencia_ms integer,
  creado_en   timestamptz not null default now()
);

comment on table public.invocaciones_funcion is
  'Telemetria minima de las funciones de alta: que funcion, que resultado, '
  'cuanto tardo. Nunca telefono, JID, dominio ni cuerpo de la peticion.';

create index invocaciones_funcion_creado_idx on public.invocaciones_funcion (creado_en);

alter table public.invocaciones_funcion enable row level security;
-- Sin politicas ni GRANT de tabla: la escribe el runtime de las Edge Functions.

-- ---------------------------------------------------------------------------
-- reservar_entrega_otp / cerrar_entrega_otp: limites de envio de OTP
-- ---------------------------------------------------------------------------

create or replace function public.reservar_entrega_otp(
  p_id_entrega text,
  p_telefono_e164 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_clave  text;
  v_fila   record;
  v_conteo integer;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'reservar_entrega_otp solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_id_entrega is null or btrim(p_id_entrega) = '' then
    raise exception 'Falta el identificador de entrega'
      using errcode = 'invalid_parameter_value';
  end if;

  v_clave := public.clave_telefono(p_telefono_e164);
  if v_clave is null or char_length(v_clave) <> 10 then
    raise exception 'Telefono invalido para reservar una entrega de OTP'
      using errcode = 'invalid_parameter_value', detail = 'telefono_argentino_invalido';
  end if;

  -- Serializa por telefono: dos entregas para el mismo numero nunca se cuentan
  -- ni se deciden con datos a medio confirmar del otro.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('otp:' || v_clave, 0)
  );

  select * into v_fila
  from public.entregas_otp
  where id_entrega = btrim(p_id_entrega)
  for update;

  if found then
    -- Un webhook-id ya enviado nunca vuelve a disparar el proveedor.
    if v_fila.estado = 'enviada' then
      return jsonb_build_object('estado', 'duplicada');
    end if;

    if v_fila.intentos >= 3 then
      return jsonb_build_object('estado', 'agotada');
    end if;

    update public.entregas_otp
    set intentos = intentos + 1, estado = 'en_curso', actualizado_en = now()
    where id_entrega = v_fila.id_entrega;

    return jsonb_build_object('estado', 'procesar');
  end if;

  select count(*) into v_conteo
  from public.entregas_otp
  where telefono_clave = v_clave
    and creado_en >= now() - interval '15 minutes';

  if v_conteo >= 3 then
    return jsonb_build_object('estado', 'limitada');
  end if;

  insert into public.entregas_otp (id_entrega, telefono_clave, estado, intentos)
  values (btrim(p_id_entrega), v_clave, 'en_curso', 1);

  return jsonb_build_object('estado', 'procesar');
end;
$fn$;

comment on function public.reservar_entrega_otp(text, text) is
  'Decide si el hook de Send SMS debe llamar al proveedor: procesar, duplicada, '
  'limitada (3 cada 15 min) o agotada. Solo service_role.';

create or replace function public.cerrar_entrega_otp(
  p_id_entrega text,
  p_estado public.estado_entrega_otp,
  p_id_proveedor text default null,
  p_error_codigo text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actualizadas integer;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'cerrar_entrega_otp solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_estado = 'en_curso' then
    raise exception 'cerrar_entrega_otp no puede dejar una entrega en curso'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.entregas_otp
  set estado         = p_estado,
      id_proveedor   = coalesce(p_id_proveedor, id_proveedor),
      codigo_error   = p_error_codigo,
      actualizado_en = now()
  where id_entrega = btrim(p_id_entrega);
  get diagnostics v_actualizadas = row_count;

  return v_actualizadas > 0;
end;
$fn$;

comment on function public.cerrar_entrega_otp(text, public.estado_entrega_otp, text, text) is
  'Cierra una entrega ya reservada como enviada o fallida. Solo service_role.';

-- ---------------------------------------------------------------------------
-- finalizar_alta_landing: sin argumentos, deriva todo de auth.uid()
-- ---------------------------------------------------------------------------

create or replace function public.finalizar_alta_landing()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_usuario       uuid := (select auth.uid());
  v_telefono_auth text;
  v_confirmado_en timestamptz;
  v_telefono      text;
  v_clave         text;
  v_identificador text;
  v_vinculo       record;
  v_org           uuid;
  v_org_nombre    text;
  v_activa        uuid;
  v_total_miembro integer;
  v_flota         uuid;
  v_flota_nombre  text;
  v_inv           record;
  v_estado        text;
  v_actualizadas  integer;
begin
  if v_usuario is null then
    raise exception 'La sesion no esta autenticada'
      using errcode = 'insufficient_privilege', detail = 'alta_no_autenticada';
  end if;

  select u.phone, u.phone_confirmed_at
  into v_telefono_auth, v_confirmado_en
  from auth.users u
  where u.id = v_usuario;

  if not found or v_confirmado_en is null then
    raise exception 'El telefono de esta cuenta no esta verificado'
      using errcode = 'invalid_parameter_value', detail = 'telefono_no_verificado';
  end if;

  -- canonicalizar_telefono_argentino (0018) ya resuelve el telefono de Auth
  -- con o sin "+" inicial y devuelve la forma canonica "+54" + 10 digitos.
  v_telefono := public.canonicalizar_telefono_argentino(v_telefono_auth, false);
  if v_telefono is null then
    raise exception 'El telefono verificado no es un E.164 argentino valido'
      using errcode = 'invalid_parameter_value', detail = 'telefono_argentino_invalido';
  end if;

  v_clave := public.clave_telefono(v_telefono);
  if v_clave is null or char_length(v_clave) <> 10 then
    raise exception 'No se pudo derivar la identidad del telefono verificado'
      using errcode = 'invalid_parameter_value', detail = 'telefono_argentino_invalido';
  end if;

  v_identificador := v_clave || '@whatsapp';

  -- Misma clave de bloqueo que usan aplicar_invitacion/canjear_* de 0017:
  -- una identidad de WhatsApp se serializa igual, la toque el landing o el bot.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('identidad:whatsapp:' || v_identificador, 0)
  );

  perform 1
  from public.vinculos_chat v
  where (v.canal = 'whatsapp' and v.identificador_externo = v_identificador)
     or v.telefono_clave = v_clave
     or (v.canal = 'whatsapp' and v.usuario_id = v_usuario)
  for update;

  if exists (
    select 1
    from public.vinculos_chat v
    where (
      (v.canal = 'whatsapp' and v.identificador_externo = v_identificador)
      or v.telefono_clave = v_clave
    )
    and v.usuario_id <> v_usuario
  ) then
    raise exception 'La identidad verificada ya pertenece a otro usuario'
      using errcode = 'invalid_parameter_value', detail = 'identidad_en_uso';
  end if;

  select * into v_vinculo
  from public.vinculos_chat v
  where v.usuario_id = v_usuario and v.canal = 'whatsapp';

  if found then
    -- Reintento: el vinculo ya existe, no se consume una segunda invitacion.
    v_estado := 'existente';
    v_org    := v_vinculo.organizacion_activa_id;
  else
    select m.organizacion_id, count(*) over ()
    into v_org, v_total_miembro
    from public.miembros m
    where m.usuario_id = v_usuario
    order by m.creado_en
    limit 1;

    if v_org is not null then
      -- Ya es miembro de alguna organizacion: solo falta atar el chat.
      v_activa := case when v_total_miembro = 1 then v_org else null end;

      insert into public.vinculos_chat (
        usuario_id, canal, identificador_externo, jid_crudo, telefono,
        organizacion_activa_id, ultimo_uso_en
      ) values (
        v_usuario, 'whatsapp', v_identificador, null, v_telefono, v_activa, now()
      ) returning * into v_vinculo;

      v_estado := 'existente';
    else
      select i.* into v_inv
      from public.invitaciones i
      where i.telefono_clave = v_clave
        and not i.anulada
        and i.usada_en is null
        and i.expira_en >= now()
      order by i.creado_en, i.id
      limit 1
      for update;

      if found then
        v_org := v_inv.organizacion_id;

        insert into public.miembros (organizacion_id, usuario_id, rol)
        values (v_org, v_usuario, v_inv.rol)
        on conflict (organizacion_id, usuario_id) do nothing;

        update public.invitaciones
        set usada_en = now(), usada_por = v_usuario
        where id = v_inv.id
          and not anulada
          and usada_en is null
          and expira_en >= now();
        get diagnostics v_actualizadas = row_count;

        if v_actualizadas <> 1 then
          -- Defensivo, igual que aplicar_invitacion en 0017: bajo el candado
          -- de identidad y el FOR UPDATE de arriba no deberia ser alcanzable.
          raise exception 'La invitacion ya no esta disponible'
            using errcode = 'invalid_parameter_value', detail = 'invitacion_no_disponible';
        end if;

        insert into public.vinculos_chat (
          usuario_id, canal, identificador_externo, jid_crudo, telefono,
          organizacion_activa_id, ultimo_uso_en
        ) values (
          v_usuario, 'whatsapp', v_identificador, null, v_telefono, v_org, now()
        ) returning * into v_vinculo;

        v_estado := 'invitacion_canjeada';
      else
        insert into public.organizaciones (nombre) values ('Mi flota')
        returning id into v_org;

        -- trg_organizaciones_alta_propietario (0001) ya deja a auth.uid() como
        -- propietario: auth.uid() sigue siendo el llamador real dentro de una
        -- funcion SECURITY DEFINER, porque lee el JWT de la peticion, no el
        -- dueno de la funcion.
        perform public.sembrar_catalogo_cordoba(v_org);

        insert into public.flotas (organizacion_id, nombre) values (v_org, 'Principal')
        returning id into v_flota;

        insert into public.vinculos_chat (
          usuario_id, canal, identificador_externo, jid_crudo, telefono,
          organizacion_activa_id, ultimo_uso_en
        ) values (
          v_usuario, 'whatsapp', v_identificador, null, v_telefono, v_org, now()
        ) returning * into v_vinculo;

        v_estado := 'registrado';
      end if;
    end if;
  end if;

  select o.nombre into v_org_nombre from public.organizaciones o where o.id = v_org;

  if v_flota is null then
    select f.id, f.nombre
    into v_flota, v_flota_nombre
    from public.flotas f
    where f.organizacion_id = v_org and f.activa
    order by f.creado_en
    limit 1;
  else
    select f.nombre into v_flota_nombre from public.flotas f where f.id = v_flota;
  end if;

  return jsonb_build_object(
    'estado', v_estado,
    'organizacion', jsonb_build_object('id', v_org, 'nombre', v_org_nombre),
    'flota', jsonb_build_object('id', v_flota, 'nombre', v_flota_nombre),
    'vinculo', jsonb_build_object(
      'id', v_vinculo.id,
      'canal', v_vinculo.canal,
      'identificador_externo', v_vinculo.identificador_externo,
      'jid_crudo', v_vinculo.jid_crudo
    ),
    'siguiente', 'whatsapp'
  );
exception
  when unique_violation then
    raise exception 'La identidad verificada ya pertenece a otro usuario'
      using errcode = 'invalid_parameter_value', detail = 'identidad_en_uso';
end;
$fn$;

comment on function public.finalizar_alta_landing() is
  'Alta o recuperacion de la cuenta de WhatsApp de quien llama, derivado de '
  'auth.uid() y su telefono confirmado. Sin argumentos: nada de eso es negociable '
  'desde el cliente. Idempotente ante reintentos. Solo authenticated.';

-- ---------------------------------------------------------------------------
-- Mantenimiento: purga de entregas de OTP e invocaciones
-- ---------------------------------------------------------------------------

create or replace function public.mantenimiento_alta_whatsapp()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'mantenimiento_alta_whatsapp solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.entregas_otp
  where creado_en < now() - interval '24 hours';

  delete from public.invocaciones_funcion
  where creado_en < now() - interval '90 days';
end;
$fn$;

comment on function public.mantenimiento_alta_whatsapp() is
  'Purga entregas de OTP (24h) e invocaciones de funcion (90 dias). Solo cron/service_role.';

-- ---------------------------------------------------------------------------
-- Permisos: cada funcion nueva nace sin GRANT (0011); se conceden uno a uno
-- ---------------------------------------------------------------------------

revoke execute on function public.reservar_entrega_otp(text, text)
  from public, anon, authenticated;
revoke execute on function public.cerrar_entrega_otp(text, public.estado_entrega_otp, text, text)
  from public, anon, authenticated;
revoke execute on function public.finalizar_alta_landing()
  from public, anon, authenticated;
revoke execute on function public.mantenimiento_alta_whatsapp()
  from public, anon, authenticated;

-- reservar/cerrar_entrega_otp y mantenimiento_alta_whatsapp quedan sin GRANT:
-- solo service_role y el cron. finalizar_alta_landing es la unica que un
-- usuario final llama, con su propio JWT.
grant execute on function public.finalizar_alta_landing() to authenticated;

-- ---------------------------------------------------------------------------
-- Cron de mantenimiento (guardado igual que 0006: pg_cron puede no estar listo)
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    perform cron.unschedule('flota-mantenimiento-alta-whatsapp')
    where exists (
      select 1 from cron.job where jobname = 'flota-mantenimiento-alta-whatsapp'
    );

    perform cron.schedule(
      'flota-mantenimiento-alta-whatsapp',
      '30 11 * * *',
      'select public.mantenimiento_alta_whatsapp();'
    );

    raise notice 'pg_cron: mantenimiento de alta WhatsApp programado a las 11:30 UTC.';
  else
    raise notice 'pg_cron no disponible: habilitarlo en Database > Extensions y reejecutar este bloque.';
  end if;
exception when others then
  raise notice 'No se pudo programar el cron (%). Habilitar pg_cron y reejecutar.', sqlerrm;
end;
$cron$;
