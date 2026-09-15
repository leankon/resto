# 06 — Cómo poner esto en internet

Guía para pasar de "corre en mi máquina" a "lo abro desde el celular". Pensada para
hacerse de una sentada, y en este orden.

## Antes de empezar: qué hace falta de verdad

**Crear la base de datos sola no alcanza para ver nada.** Una base es una base: no
tiene pantalla. Para abrir el panel desde afuera hacen falta las dos cosas:

| Pieza | Para qué | Cuánto tarda |
|---|---|---|
| Postgres gestionado (Neon o Supabase) | guardar los datos | ~5 min |
| Hosting de la app (Railway, Fly o Vercel) | servir las pantallas | ~10 min |

Con la base sola, el panel sigue existiendo únicamente en la máquina donde corre
`npm run dev`.

## 1. La base

**Neon** o **Supabase**, los dos tienen plan gratuito suficiente para el piloto.
Neon es Postgres pelado y arranca más limpio; Supabase suma auth y storage que este
proyecto no usa (el login del staff es propio), pero su pooler está muy probado.

Lo que el esquema necesita, y que los dos soportan:

- `btree_gist` y `pgcrypto` (las crea la migración).
- Row Level Security con políticas apuntadas a roles.
- Un rol con `CREATEROLE` para crear los tres roles de la app.

Lo que el esquema **no** necesita, y por eso se puede desplegar:

> **Ningún rol es superusuario ni tiene `BYPASSRLS`.** En Postgres gestionado el rol
> con el que uno entra no es superusuario de verdad, así que un esquema que dependa
> de eso directamente no se instala. El acceso ampliado del super-admin sale de
> políticas `TO resto_admin`, que además es más preciso: se ve exactamente qué puede
> tocar. Hay un test que falla si alguien vuelve a meter `BYPASSRLS`.

### Pasos

1. Crear el proyecto y copiar la cadena de conexión del **pooler** (Supabase la
   llama "Connection pooling", modo *transaction*; Neon, "Pooled connection").
   El pooler en modo transacción sirve: todo lo que hace la app es por transacción
   (`SET LOCAL app.tenant_id`, `pg_advisory_xact_lock`), nada depende de la sesión.
2. Aplicar las migraciones:

   ```bash
   export ADMIN="postgresql://postgres:CLAVE@HOST:5432/postgres"
   for f in src/datos/migraciones/*.sql; do psql "$ADMIN" -v ON_ERROR_STOP=1 -f "$f"; done
   ```

3. **Cambiar las contraseñas de los tres roles.** Las migraciones los crean con `dev`,
   que está bien en tu máquina y no está bien en internet:

   ```sql
   ALTER ROLE resto_app   PASSWORD 'una-clave-larga-y-distinta';
   ALTER ROLE resto_auth  PASSWORD 'otra-clave-larga-y-distinta';
   ALTER ROLE resto_admin PASSWORD 'otra-más';
   ```

4. Armar las tres URLs con esas contraseñas. TLS se activa solo: `conexion.ts` cifra
   todo lo que no sea localhost.

## 2. El hosting

**Railway** o **Fly.io**: un contenedor siempre encendido, del orden de USD 5 por mes.

**Vercel** también sirve **para ver el panel ahora**, y es el camino más corto para
Next.js. La advertencia del doc 02 sigue en pie pero es de la Fase 3: el webhook de
WhatsApp no puede vivir en una función con arranque en frío, porque Meta espera
respuesta en pocos segundos y reintenta, y un reintento puede terminar en una reserva
duplicada. Para eso vamos a necesitar un proceso siempre encendido igual.

Variables de entorno a cargar, las tres:

```
DATABASE_URL=postgresql://resto_app:...@HOST:5432/postgres
DATABASE_URL_AUTH=postgresql://resto_auth:...@HOST:5432/postgres
DATABASE_URL_ADMIN=postgresql://resto_admin:...@HOST:5432/postgres
```

## 3. Cargar datos y entrar

```bash
DATABASE_URL=... DATABASE_URL_ADMIN=... npm run db:demo
```

Deja un local de prueba con reservas y estos usuarios:

| Dónde | Usuario | Contraseña |
|---|---|---|
| Panel del local (`/login`) | `duenio@bardemo.test` | `bar-demo-123` |
| Plataforma (`/admin/login`) | `admin@plataforma.test` | `plataforma-123` |

Son de demostración: antes de mostrarle esto a un local real, borralos.

## Lo que falta para llamarlo producción

Esto alcanza para ver y mostrar el MVP. Para operar un local de verdad faltan, y
ninguna es difícil, pero ninguna está hecha:

- Contraseñas de rol distintas de `dev` (paso 3 de arriba).
- Backups automáticos configurados (Neon y Supabase los tienen, hay que prenderlos).
- Un job que limpie sesiones vencidas (`limpiarSesionesVencidas` ya existe, falta
  quién lo llame).
- Límite de intentos de login. Hoy el login es resistente a averiguar quién tiene
  cuenta, pero nada frena a alguien probando contraseñas.
- Sentry o equivalente: sin eso, un error en producción no se entera nadie.
