---
version: 1
slug: "paquetes-web-src-paginas-inicio-tsx"
primary_target: "paquetes/web/src/paginas/Inicio.tsx"
related_targets: ["paquetes/web/src/paginas/Agregar.tsx"]
---

Alcance: las dos rutas de la web, `/` (Persuade) y `/agregar` (Operate). Mismo
mundo visual, registro distinto.

Audiencia: dueño o encargado de una flota de 5 a 50 vehículos en Córdoba, en el
teléfono, entre viajes. En `/` no conoce FlotaBot; en `/agregar` ya decidió.

Trabajo: en `/`, entender que todo pasa en el chat y dejar el número. En
`/agregar`, completar número → código → activada, con una mano, en la calle,
con mala señal.

Prueba elegida por el usuario: el hilo de WhatsApp del bot, con varios avisos
de vehículos distintos, el pedido del link y el registro de un pago. Es dato de
demostración autorado y etiquetado como tal. No hay testimonios, métricas ni
capturas y no se fabrican.

Restricciones acordadas con el usuario: el peor fracaso posible es prometer más
de lo que el canal garantiza. Mundo oscuro en las dos rutas, con `/agregar`
reforzado en contraste, tamaño de tipo y área de toque para sol y una mano.

Momento memorable: el hilo llegando solo, con tres vehículos distintos y sus
organismos reales, y el campo del teléfono justo debajo de donde iría tu
respuesta.

Decisiones sin resolver: dónde se hospeda WAHA, así que el alta se maqueta y
valida en el cliente pero no completa el ciclo real; si FlotaBot es un producto
para terceros, así que no hay precios ni planes.

## Direction contract

THESIS: La página es el hilo donde los avisos llegan. Rechaza el arreglo que
esta categoría siempre entrega —hero centrado, subtítulo, botón y tres cards de
features con iconitos— y también rechaza el hero de objeto: acá no hay una
pieza que mirar, hay una conversación que ya está pasando.

OWN-WORLD: Fondo casi negro `#0A0C0D` con grano de fibra y el reglado de
recuadros de un formulario 08 apenas visible en azul. Azul Mercosur `#1B4CA1` y
azul claro `#4C7FD4` como familia de acento, en el canto de las burbujas, en
los tildes de entrega y en las etiquetas del registro. Blanco de chapa
`#F2F3F0` para la tinta, rojo `#B5302A` solo para vencido. Numerales tabulares
en fechas, importes y cuotas; reglas de un pixel como única división, nunca
cards. La luz se resta del negro y vive en el grano, nunca en un halo sin
offset.

STORY: Un desconocido lee un hilo donde el bot avisa por tres vehículos
distintos con sus organismos reales, ve que el dueño pide el link y registra un
pago sin abrir nada, entiende que el producto entero vive en el chat, y deja su
número abajo del hilo.

FIRST VIEWPORT: El título "Tus flotas al día, con FlotaBot" arriba, centrado y
grande. Debajo, el hilo de ejemplo como pieza principal, a escala plena, con
burbujas del bot a la izquierda y del dueño a la derecha, separador de día,
horas y tildes de entrega. Debajo del hilo, el campo del teléfono como único
control del viewport. Nada de kicker sobre el titular.

FORM: Dominio, candidata 2 de mi lista ordenada, registro safer pedido por el
usuario, seed `7a4852ce`. Redirigida por el usuario después del primer build:
la chapa sale y el hilo pasa a ser la pieza principal.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance
