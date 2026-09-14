# resto — plataforma SaaS de reservas multi-local

Plataforma multi-tenant de reservas para gastronomía: cada local tiene su propia página de
reservas, su plano de salón y su panel de staff, todo corriendo sobre la misma plataforma.
Asignación automática de mesas, lista de espera, notificaciones multi-canal y reservas por
WhatsApp.

**Estado: fase de diseño. No hay código todavía.**

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
