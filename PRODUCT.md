# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript (decisión del usuario). Consume `paquetes/compartido`
tal cual: los tipos generados del esquema real y los esquemas zod ya existen y
el bot los usa.

Detrás: Supabase (Postgres con RLS + Edge Functions en Deno), monorepo con
workspaces de npm. La web es un paquete más al lado de `paquetes/compartido`.

**Deploy: Vercel** (decisión del usuario). SPA estática con las dos rutas
resueltas por rewrite. Tres consecuencias que el diseño y la implementación
tienen que respetar:

- **El navegador nunca habla con WAHA.** El token de WAHA no puede viajar al
  cliente. El envío y la validación del código van del lado del servidor, en una
  Edge Function de Supabase como el resto del proyecto.
- **WAHA no corre en Vercel.** Sostiene una sesión de WhatsApp abierta: es un
  contenedor que necesita un host siempre encendido, no una función serverless.
  Dónde vive todavía no está decidido.
- Vercel sirve la web; la base y las funciones siguen en Supabase. El deploy de
  la web no toca ni migraciones ni Edge Functions.

## Users

**Usuario primario: el dueño o encargado de una flota chica o mediana en
Córdoba, Argentina.** Tiene entre 5 y 50 vehículos repartidos en una o más
flotas, y sobre cada uno pesan seis obligaciones con calendarios distintos:
impuesto automotor provincial, tasa municipal, seguro, VTV/RTO, oblea de GNC y
multas. No lleva contabilidad: lleva vencimientos, y los pierde. Vive en
WhatsApp y no va a abrir un panel todos los días.

**La flota que se administra hoy es la del propio usuario del proyecto**: hay
una organización real, no una cartera de clientes. El home de la web, en
cambio, le habla a alguien que **no conoce FlotaBot**, y el alta crea una
organización nueva para quien verifica su número. El mecanismo está abierto a
terceros; el modelo comercial no está decidido (ver *Capabilities and
Constraints*).

**Roles dentro de una organización** (enum `rol_miembro`): `propietario`,
`administrador`, `operador`, `lector`. `puede_administrar()` son los dos
primeros; `puede_operar()` agrega `operador`; `lector` solo lee.

## Product Purpose

FlotaBot avisa por WhatsApp antes de que se venza una obligación de un
vehículo, y acerca el link oficial de pago.

El problema no es contabilidad, es **no perder un vencimiento**. El éxito es
medible y negativo: que no haya una multa por mora que se podía evitar. Un
vencimiento que llega a vencido sin que nadie lo haya visto es la falla del
producto, no del usuario.

La web existe para una sola cosa que un chat no puede hacer: **capturar y
verificar un número de teléfono**. Después devuelve a la persona al chat.

## Positioning

El vencimiento existe en la base **antes** que el pago. Una cuota impaga es una
fila que existe, con fecha e importe, no la ausencia de un pago. Eso es lo que
permite consultarla, resumirla y —sobre todo— avisar por ella. Un sistema que
solo guarda pagos no puede avisar de lo que todavía no pasó.

Sobre eso: el aviso sale sin que nadie abra nada. `pg_cron` corre
`tarea_diaria()` a las 11:00 UTC (08:00 en Córdoba), genera las cuotas futuras
y encola los avisos; el bot los reparte por WhatsApp. La interfaz por defecto no
es una pantalla, es un mensaje que llega.

Y el catálogo es local, no genérico: Rentas Córdoba, la Municipalidad de
Córdoba, ENARGAS, con la URL oficial de pago y las instrucciones de cada
organismo ya cargadas (`sembrar_catalogo_cordoba()`).

## Operating Context

**El canal es WhatsApp.** Toda la funcionalidad de flota vive en el chat:
consultar vencimientos, registrar un pago, pedir el link, ver un reporte. La
web no duplica nada de eso.

**La web tiene dos rutas, y nada más:**

1. **Home** — le habla a alguien que no conoce FlotaBot. Tiene que explicar qué
   hace y por qué importa antes de pedir un número de teléfono.
2. **Agregar FlotaBot a WhatsApp** — el alta: la persona deja su número, recibe
   un código por WhatsApp, lo ingresa en la web, y queda activada.

**El alta, de punta a punta:** número → código enviado por WhatsApp vía
**WAHA** → la persona lo ingresa en la web → se crea una **organización nueva y
vacía** con esa persona como `propietario` (`registrar_organizacion`, migración
`0014`) → sigue en el chat, donde carga flota y vehículos.

**La escena real:** la persona está en el teléfono. El navegador y WhatsApp
comparten la pantalla y va a alternar entre los dos para copiar el código. El
alta se completa con una mano, en la calle, con mala señal.

**Zona horaria:** `America/Argentina/Cordoba` (UTC-3). Ninguna fecha de negocio
sale de `current_date`: se usa `hoy_en_organizacion()`. Entre las 21:00 y las
24:00 locales, UTC ya está en el día siguiente.

**Avisos por defecto:** toda organización nace con la regla general D-30, D-15,
D-7, D-3, D-1, el día del vencimiento, y D+1, D+7, D+15. Se crea sola por
trigger, porque un sistema cuyo único trabajo es no perder un vencimiento no
puede depender de que alguien se acuerde de configurar los avisos.

## Capabilities and Constraints

**Terminado y verificado (la base):** multi-tenencia con RLS y FK compuestas
`(id, organizacion_id)`, motor de vencimientos con reglas y calendarios
irregulares, pagos parciales y su reversión, rollups por flota, reportes,
`link_de_pago()`, importación masiva, comprobantes en Storage, cola de avisos,
alta por teléfono verificado e invitaciones, y 152 comprobaciones en
`supabase/tests/` que corren contra el proyecto real.

**El sistema nunca mueve dinero.** `link_de_pago()` devuelve la URL oficial con
`{dominio}`, `{periodo}` y `{cuenta}` resueltos, más el importe y el período. El
pago lo hace una persona, en el sitio del organismo. No hay pasarela, no hay
débito, no hay plata en tránsito.

**"Vencido" no se guarda.** `vencimientos.estado` es solo liquidación
(`pendiente`, `parcial`, `pagado`, `condonado`, `anulado`); la condición de
vencido se deriva en `v_vencimientos_estado` comparando contra hoy en la zona de
la organización. `estado_efectivo` agrega `vencido` y solo existe en vistas.

**Los teléfonos se normalizan en la base.** El prefijo `15` de celular va en el
medio, después del código de área: comparar por los últimos dígitos no alcanza.
Es `clave_telefono()` (migración `0015`), no se reimplementa en el cliente.

**La lógica de negocio vive en Postgres, no en el frontend.** Si aparece una
regla de negocio nueva, casi siempre va en una migración. La web y el bot
conversan y despachan.

**El cliente nunca consulta datos de negocio con `service_role`.** Con el JWT
del usuario, RLS es la última línea de defensa. `service_role` es solo para
tareas de sistema: cron, despacho de avisos y el alta.

### Trabajo pendiente que este producto todavía no tiene

- **El canal es WhatsApp, sobre WAHA** (`wa-webhook`, `enviar-otp-whatsapp`,
  `finalizar-alta-landing`). El canal Telegram se descartó: la migración
  `0016_vinculos_chat_neutral` reemplazó `vinculos_telegram` por
  `vinculos_chat (canal, identificador_externo)`, y el código del bot de
  Telegram se eliminó del repo. La lógica de negocio en Postgres no se tocó.
- **WAHA es una API no oficial de WhatsApp.** Es la decisión tomada para enviar
  el código de verificación. Su consecuencia es parte del producto y no se puede
  disimular: Meta puede bloquear el número, no hay garantía de entrega ni de
  tiempo de llegada, y no existe el concepto de plantilla aprobada. La web no
  debe prometer una entrega que no controla, ni tratar la demora como un error
  del usuario.
- **No existe ningún frontend todavía.** No hay scaffold, ni rutas, ni assets.
- **No está decidido dónde se hospeda WAHA.** Necesita un host siempre
  encendido (VPS o servicio de contenedores) y no puede ser Vercel. Sin eso, el
  alta se puede diseñar y maquetar pero no puede funcionar de punta a punta.
- **No está decidido si FlotaBot es un producto para terceros.** No hay precios,
  planes, facturación ni límites por organización. El alta self-service ya crea
  organizaciones, pero eso es mecanismo, no modelo comercial. No inventar
  precios ni planes.
- **No hay tests de las Edge Functions**, solo de la base contra la que corren.
- **No se estableció ningún estándar de accesibilidad**, ni una necesidad
  concreta de usuario. Futuro trabajo no debe afirmar que se cumple uno.

## Brand Commitments

- **El nombre es FlotaBot.** Escrito por el usuario también como "flotabot".
- **El idioma es español de Argentina (es-AR), y es el único.** No hay i18n ni
  está pedido. "Dominio" es la patente; "cuota", "vencimiento", "oblea",
  "boleta", "CUIT" son los términos del dominio y del organismo: no se traducen
  ni se suavizan.
- **La voz del proyecto, tal como está escrita en su documentación:** directa,
  sin marketing, explica el porqué y admite lo que falta. Los encabezados de las
  migraciones documentan el bug que corrigen. Un "Aviso honesto" en el README
  advierte lo que nunca se probó. Esa franqueza es un compromiso, no un
  accidente: la web no debería sonar más segura de lo que el sistema es.
- **Sin logo, sin isotipo, sin tipografía ni paleta definida.** No existe ningún
  activo de marca todavía.

## Evidence on Hand

- **El catálogo real de obligaciones de Córdoba**, con organismo, URL oficial de
  pago e instrucciones, en `supabase/migrations/0002_tipos_obligacion_reglas.sql`
  (`sembrar_catalogo_cordoba`): impuesto automotor provincial (Rentas Córdoba),
  tasa municipal automotor (Municipalidad de Córdoba), multas e infracciones,
  seguro, RTO/VTV, oblea GNC (ENARGAS). Es verificable y es el activo más
  concreto que tiene el producto.
- **Las 152 comprobaciones** de `supabase/tests/` corren contra el proyecto real
  con usuarios y JWT reales. Es un hecho, y se puede nombrar.
- **La documentación del proyecto:** `README.md` (modelo de datos y puesta en
  marcha) y `CLAUDE.md`.

**Lo que NO existe y no se debe fabricar:**

- **Los datos de demostración son ficticios.** "Remises Centro", "Utilitarios",
  "Larga Distancia", los 16 vehículos, los ~650 vencimientos y el CUIT
  `30712345678` son de `supabase/semillas/demo.mjs`. Sirven para desarrollar.
  **No son un cliente y no se muestran como tal.**
- No hay testimonios, casos, clientes nombrables, logos de terceros, ni prensa.
- No hay métricas de uso, ni de dinero ahorrado, ni de multas evitadas.
- No hay precios, planes ni condiciones de servicio.
- No hay capturas del producto: el bot no está desplegado y el frontend no
  existe.
- No hay razón social, domicilio ni CUIT real para un pie legal.

## Product Principles

1. **No perder un vencimiento es el único trabajo.** Cualquier decisión que haga
   más probable que un aviso no llegue —o que llegue y no se entienda— está mal,
   por linda que sea.
2. **La web devuelve a la persona al chat.** No compite con el bot ni replica su
   funcionalidad: hace lo único que un chat no puede hacer y se aparta.
3. **El sistema nunca mueve dinero.** Acerca el link oficial; paga una persona.
   Nada en la interfaz debe insinuar que FlotaBot cobra, retiene o transfiere.
4. **La lógica de negocio vive en Postgres.** El frontend valida, formatea y
   conversa. Una regla nueva es una migración, no un `if` en un componente.
5. **No prometer lo que el canal no garantiza.** El código sale por una API no
   oficial: la interfaz dice la verdad sobre la demora y ofrece una salida
   cuando no llega.
