# 02 — Stack y arquitectura

## Criterio de decisión

El criterio dominante acá es **"mantenible por una persona"**, no "máxima escala teórica".
Un local promedio hace entre 20 y 200 reservas por día. Cien locales son ~10.000 reservas
diarias: eso es carga trivial para un Postgres. El cuello de botella de este proyecto es
tu tiempo, no el CPU. Por lo tanto: **un lenguaje, un repo, un deploy, y usar Postgres a
fondo en vez de agregar infraestructura.**

## Recomendación

| Capa | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript en todo | un solo lenguaje back/front, tipos compartidos entre API y UI |
| Framework | **Next.js (App Router)**, monolito modular | panel staff + web pública + API + webhook en un deploy |
| Base de datos | **PostgreSQL 16+** | `EXCLUDE` constraints, `tstzrange`, RLS, JSONB: resuelve solo la mitad de los problemas difíciles |
| Acceso a datos | **Drizzle ORM** | SQL-first; permite usar rangos y constraints de exclusión sin pelearse con el ORM |
| Jobs / cron | **pg-boss** (cola sobre Postgres) | recordatorios, lista de espera y reintentos sin sumar Redis |
| Auth staff | Auth.js (credentials) + Argon2 | usuario/contraseña alcanza, como pediste |
| Hosting | **Railway** o **Fly.io** (contenedor always-on) | el webhook de WhatsApp no puede ser serverless con cold start |
| Mail | **Resend** (o Postmark si la entregabilidad importa) | DX simple, plantillas en React |
| Errores/logs | Sentry + pino (logs estructurados con `tenant_id`) | sin esto, debuggear multi-tenant es a ciegas |
| Tests | Vitest | el motor de asignación se testea con fixtures, es lo único que *tiene* que estar testeado |

### Por qué Next.js y no otra cosa

Alternativas reales que consideré:

**A. NestJS (API) + React/Vite (SPA) — dos deploys.**
Mejor separación, y si mañana hacés una app móvil nativa la API ya está lista y desacoplada.
Costo: el doble de boilerplate, dos pipelines, auth entre dominios, CORS. Para una persona
sola en Fase 1 es fricción pura. *Si el brief hubiera dicho "app móvil nativa en Fase 2",
cambiaría la recomendación.*

**B. Django o Rails.**
Ventaja concreta y real: **el panel de super-admin sale gratis** con Django Admin / Rails
Admin, que es exactamente uno de los entregables de Fase 1. Batteries included para todo el
CRUD. Desventaja: el editor visual de plano y el drag & drop de mesas es React igual, así
que terminás con dos lenguajes y dos stacks de todos modos. Si ya supieras Python/Ruby
mejor que TS, elegiría esta.

**C. Next.js monolito modular (recomendado).**
Un deploy, un lenguaje, server components para el panel (que es casi todo tablas y
formularios), route handlers para webhook y API pública del widget. El costo a pagar es
disciplina: hay que mantener la lógica de dominio **fuera** de los componentes, en
`src/dominio/`, o en un año es imposible de testear.

> La regla no negociable con la opción C: el motor de asignación, el resolutor de canales
> de notificación y la lista de espera son **funciones puras de TypeScript sin imports de
> Next.js**. Reciben datos, devuelven decisiones. Así se testean sin levantar un servidor
> y se pueden mover a otro runtime si algún día hace falta.

### Estructura de carpetas propuesta

```
src/
  dominio/                 # lógica pura, sin I/O, 100% testeable
    asignacion/            # motor de mesas (el corazón)
    notificaciones/        # resolutor de canal (decide, no envía)
    espera/                # prioridad y matching de lista de espera
    turnos/                # duración, buffers, horarios de servicio
  datos/                   # esquema Drizzle, migraciones, repositorios
  servicios/               # orquestación: transacciones, casos de uso
  adaptadores/             # I/O hacia afuera: whatsapp, resend, sms, storage
  app/                     # Next.js: rutas, panel, web pública, webhook
  jobs/                    # workers de pg-boss
```

## Multi-tenancy

### Opciones

| Estrategia | Aislamiento | Costo operativo | Cuándo tiene sentido |
|---|---|---|---|
| Base de datos por tenant | máximo | inviable: N migraciones, N conexiones, N backups | enterprise, pocos clientes muy grandes |
| Schema por tenant | alto | se rompe alrededor de 50–100 tenants: cada migración recorre todos los schemas | decenas de tenants, requisito regulatorio |
| **Tabla compartida con `tenant_id` + RLS** | bueno si se hace bien | mínimo: una migración, un pool, un backup | **este caso** |

**Recomendación: tabla compartida con `tenant_id` en toda tabla de negocio, más Row Level
Security de Postgres activada desde el día uno.**

El argumento de RLS no es teórico. El bug clásico de este modelo es una consulta a la que
se le olvidó el `WHERE tenant_id = ...`, y el resultado es mostrarle a un local las
reservas de otro. Con RLS, esa consulta devuelve cero filas en vez de datos ajenos: el bug
pasa de "incidente de privacidad" a "página vacía". Es la diferencia entre un mal día y
perder todos los clientes.

Implementación concreta:

```sql
ALTER TABLE reservas ENABLE ROW LEVEL SECURITY;
CREATE POLICY reservas_tenant ON reservas
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

y del lado de la app, **toda** operación de negocio pasa por un helper:

```ts
await conTenant(tenantId, async (tx) => { /* ... */ });
// hace SET LOCAL app.tenant_id = $1 dentro de la transacción
```

Trade-off honesto: `SET LOCAL` obliga a que todo corra dentro de una transacción, lo cual
con un pooler en modo transaction (PgBouncer, Supabase pooler) funciona bien pero hay que
tenerlo presente. El super-admin usa un rol de base separado que bypassea las policies.

## Colas y trabajos programados

Necesitamos jobs para: recordatorios T-24h/T-3h, expiración de ofertas de lista de espera,
reintentos de notificación, re-optimización del salón, y procesamiento asíncrono del
webhook de WhatsApp.

**pg-boss** (cola persistida en Postgres) cubre todo eso sin agregar Redis ni un servicio
externo, y como comparte la base, un job se puede encolar **en la misma transacción** que
crea la reserva. Eso habilita el patrón outbox (ver doc 04) que garantiza que nunca se
manda un aviso de una reserva que falló, ni se pierde el aviso de una que se guardó.

Alternativas: BullMQ + Redis (más throughput del que jamás vamos a necesitar, +1 servicio
que mantener) o Inngest/Trigger.dev (gestionado, muy buena DX para retries y flujos
temporales, pero es un tercero en el camino crítico y cuesta plata al escalar).

## Hosting y costos aproximados del MVP

Verificar precios al momento de contratar; son órdenes de magnitud, no cotizaciones.

| Ítem | Opción | Costo mensual aprox. |
|---|---|---|
| App (contenedor always-on) | Railway / Fly.io / Render | USD 5–25 |
| PostgreSQL gestionado | Neon / Supabase / el del proveedor | USD 0–25 |
| Mail transaccional | Resend free 3k/mes → ~USD 20 por 50k | 0–20 |
| Almacenamiento (planos, imágenes) | S3 / R2 | < 1 |
| Errores | Sentry free tier | 0 |
| **Total MVP** | | **~USD 10–70** |

El webhook de WhatsApp **no** debe ir a Vercel/Lambda con cold start: Meta espera 200 en
pocos segundos y reintenta con backoff. Un contenedor chico siempre encendido en
Railway/Fly es más simple y más barato que pelear con cold starts.

Patrón obligatorio del webhook: **validar firma → encolar → responder 200**. Todo el
procesamiento (NLU, consulta de disponibilidad, respuesta) ocurre en un worker. Si el
procesamiento se hace inline, un pico de mensajes o una consulta lenta hace que Meta
reintente y se dupliquen reservas.

## WhatsApp: Cloud API directo vs. BSP

| | Meta Cloud API directo | Twilio | 360dialog |
|---|---|---|---|
| Costo por mensaje | solo el de Meta | el de Meta + markup por mensaje | el de Meta, sin markup |
| Costo fijo | 0 | 0 | tarifa mensual por número |
| Time-to-first-message | medio (Business Manager, verificación) | bajo, el más rápido para probar | bajo |
| Onboarding de clientes con número propio | requiere ser Tech Provider + Embedded Signup | soportado | soportado, es su fuerte |
| Dependencia | solo Meta | Twilio como intermediario | 360dialog como intermediario |
| Portabilidad | — | migrar después duele | migrar es más fácil |

**Recomendación:** como ya tenés cuenta de WhatsApp Business API, **quedarse en Cloud API
directo** y encapsular todo detrás de una interfaz `ProveedorWhatsApp` con un único
adaptador. Si más adelante querés Embedded Signup para dar de alta números por local, un
BSP como 360dialog se justifica, y el cambio queda contenido en un archivo.

Sobre precios de Meta: el esquema es **por mensaje**, con categorías (`utility`,
`marketing`, `authentication`, `service`) y precio por país. Los mensajes de servicio
dentro de la ventana de 24hs iniciada por el cliente son gratuitos, y los `utility`
dentro de esa ventana también. Los recordatorios fuera de la ventana caen en `utility`
pago (en Argentina, del orden de centavos de dólar por mensaje). **Confirmar la tabla de
precios vigente de Meta antes de proyectar costos**, porque la cambian seguido.

## Proveedores de mail y SMS

**Mail (necesario desde Fase 3, y es el fallback de todo):**

- **Resend** — DX excelente, plantillas en React, free 3k/mes. Recomendado para empezar.
- **Postmark** — la mejor entregabilidad de transaccional del mercado, ~USD 15 por 10k.
  Si los recordatorios empiezan a caer en spam, es la migración correcta.
- **Amazon SES** — imbatible en precio (~USD 0,10 por mil), peor DX, hay que gestionar
  reputación y salir del sandbox a mano.

En los tres casos hay que configurar **SPF, DKIM y DMARC** en el dominio desde el
principio, o los recordatorios van a spam y la feature no sirve.

**SMS (dejarlo para después, pero modelado):**

Es el canal más caro y con peor experiencia. En Argentina un SMS vía Twilio ronda USD
0,05–0,09, es decir **más caro que un template de WhatsApp** y sin botones de respuesta.
Tiene un solo caso de uso legítimo: el cliente dejó teléfono, no dio opt-in de WhatsApp o
el envío falló, y no dejó mail. Es raro. Recomendación: implementar la interfaz del canal,
dejar el adaptador sin proveedor, y activarlo solo si los datos muestran que hace falta.

**Push:** solo tiene sentido si existe una app propia (Fase 4+). El modelo de datos ya lo
contempla como un canal más; no hay nada que construir ahora.
