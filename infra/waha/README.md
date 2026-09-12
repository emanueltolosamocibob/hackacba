# WAHA para la demo local

Una sola cuenta de WhatsApp, propiedad del operador, atiende los OTP y el bot.
El operador escanea el QR una vez; la sesión persiste en `./sesiones/`.

## Puesta en marcha

```bash
cp .env.ejemplo .env            # completar con claves largas
docker compose -f compose.demo.yaml up -d
```

El puerto 3000 queda atado a `127.0.0.1`. Desde afuera solo se entra por el túnel.

## Parear la sesión del operador

```bash
source .env
curl -X POST http://localhost:3000/api/sessions \
  -H "X-Api-Key: $WAHA_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"operador","start":true}'
```

Abrir `http://localhost:3000/dashboard` con el usuario y la contraseña del `.env`
y escanear el QR con el teléfono del operador. Comprobar que quedó en `WORKING`:

```bash
curl http://localhost:3000/api/sessions/operador -H "X-Api-Key: $WAHA_API_KEY"
```

## Túnel HTTPS

Supabase (Edge Functions) necesita alcanzar este WAHA para enviar mensajes.
La dirección inversa, el webhook de WAHA hacia Supabase, no necesita túnel.

```bash
cloudflared tunnel --url http://localhost:3000
```

La URL `https://<aleatorio>.trycloudflare.com` que imprime es `WAHA_BASE_URL`
para los secretos de Supabase. Cambia en cada reinicio del túnel: hay que
volver a cargarla. Un túnel con nombre (requiere dominio en Cloudflare) da una
URL estable.

## Imagen

`devlikeapro/waha:arm-2026.7.1` es la variante arm64 nativa (Apple Silicon).
En un host amd64 usar `devlikeapro/waha:2026.7.1`. El motor se fija con
`WHATSAPP_DEFAULT_ENGINE=GOWS`.
