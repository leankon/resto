# resto — plataforma SaaS de reservas multi-local

Plataforma multi-tenant de reservas para gastronomía: cada local tiene su propia página de
reservas, su plano de salón y su panel de staff, todo corriendo sobre la misma plataforma.
Asignación automática de mesas, lista de espera, notificaciones multi-canal y reservas por
WhatsApp.

## Cómo correrlo

No hace falta ninguna cuenta en la nube para trabajar en la Fase 1. El esquema usa
Postgres estándar, así que lo que corre local corre igual en Supabase, Neon o Railway.

```bash
npm install
npm run db:start     # levanta Postgres, crea la base y aplica migraciones
npm run db:demo      # carga un local de prueba con reservas
npm run dev          # panel en http://localhost:3000

npm test             # 107 tests
npm run test:unit    # solo el motor, sin base de datos
npm run humo         # recorrido de humo en navegador (requiere el server andando)
```

Usuarios de prueba que deja `db:demo`:

| Dónde | Usuario | Contraseña |
|---|---|---|
| Panel del local (`/login`) | `duenio@bardemo.test` | `bar-demo-123` |
| Plataforma (`/admin/login`) | `admin@plataforma.test` | `plataforma-123` |

## Estado

**Fase 1 completa.** Motor de asignación, esquema con sus dos invariantes, caso de uso
transaccional, login de staff, panel del local y panel de super-admin.

Sigue la Fase 2: web pública de reservas y widget embebible.

## Cómo está organizado

```
src/
  dominio/      lógica pura, sin I/O: motor, turnos, combinaciones, identidad, passwords
  datos/        esquema SQL, migraciones, repositorios, conexiones por rol
  servicios/    casos de uso: reservas, auth, panel, administración
  web/          helpers del panel: sesión, formato de fecha y hora
  app/          pantallas (Next.js App Router)
```

Todo lo que vive en `dominio/` es función pura: recibe datos, devuelve decisiones. No
toca la base, no conoce transacciones, no sabe qué es un tenant. Es lo que permite
testear el motor sin levantar un servidor.

## Documentos de decisión

Leer en orden:

| Doc | Contenido |
|---|---|
| [00 — Decisiones tomadas](docs/00-decisiones.md) | lo que ya está definido y por qué |
| [01 — Viabilidad y riesgos](docs/01-viabilidad-y-riesgos.md) | qué es viable, los cinco puntos caros del brief |
| [02 — Stack y arquitectura](docs/02-stack-y-arquitectura.md) | stack recomendado con alternativas, multi-tenancy, hosting, proveedores y costos |
| [03 — Modelo de datos y asignación](docs/03-modelo-de-datos-y-asignacion.md) | tablas, el motor de mesas, concurrencia, auditoría |
| [04 — Notificaciones](docs/04-notificaciones.md) | motor multi-canal, resolución de canal, consentimiento, outbox |
| [05 — Preguntas abiertas](docs/05-preguntas-abiertas.md) | lo que falta definir antes de la Fase 1 |
| [06 — Cómo desplegar](docs/06-desplegar.md) | pasar de la máquina a internet: base, hosting y qué falta para producción |

## Resumen de decisiones propuestas

- **Stack:** TypeScript + Next.js (App Router) + PostgreSQL + Drizzle + pg-boss.
- **Multi-tenancy:** tabla compartida con `tenant_id` + Row Level Security de Postgres.
- **Doble booking:** imposible por constraint `EXCLUDE USING gist` sobre `(mesa, periodo)`.
- **Concurrencia:** advisory lock por (tenant, fecha) + la constraint como red de seguridad.
- **Asignación:** mesa concreta al reservar, pero re-optimizable hasta 4hs antes mientras
  no esté fijada a mano por el staff. La confirmación al cliente no lleva número de mesa.
- **Turnos:** duración variable por tamaño de grupo y por franja horaria.
- **Notificaciones:** módulo agnóstico de canal, patrón outbox, un único resolutor de canal.
- **WhatsApp:** Cloud API directo detrás de una interfaz de proveedor. Número propio por
  local como destino; compartido con deep link para las pruebas de Fase 3.
- **Escala objetivo del primer año:** 5–20 locales, hasta ~50 mesas cada uno.

## Fases

1. Núcleo multi-tenant + motor de asignación + panel de staff + reservas manuales.
2. Web pública de reservas + widget embebible + vista visual del salón con reasignación.
3. Lista de espera + recordatorios + motor de notificaciones + bot de WhatsApp.
4. Analítica, onboarding autoguiado, preparación para planes y suscripciones.
