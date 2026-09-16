# Dónde quedamos

Apunte de trabajo, no documento de diseño. Se borra cuando la Fase 2 cierre.

## Lo que está terminado y andando

Fase 1 y Fase 2 completas y desplegadas. Además, en esta tanda:

| Qué | Decisión |
|---|---|
| La noche entera cuenta como un día de trabajo | [D15](00-decisiones.md) |
| El plano se mira de a cuartos de hora | [D16](00-decisiones.md) |
| Los días especiales reemplazan el horario en vez de recortarlo | [D17](00-decisiones.md) |
| La limpieza dejó de ocupar turno (arranca en cero) | migración 0005 |
| Cada cuánto ofrece horarios la web: 15, 30 o 60, lo elige el dueño | migración 0007 |

## Lo que quedó a medias

Nada de la parte funcional. La vista de la semana quedó terminada: grilla de siete días
con las horas editables una por una, cerrar un día, y reabrirlo copiando de otro.

## Lo pendiente acordado

- **Google.** Posicionar por la palabra "resto" no es posible: es genérica y compite con
  TripAdvisor y Google Maps. Lo que sí sirve, y es lo que hay que hacer:
  - Que la página de cada local aparezca cuando se googlea **ese local**: datos
    estructurados de restaurante, Open Graph para que el link se vea bien en WhatsApp e
    Instagram, `sitemap.xml` y `robots.txt`. No necesita nada de nadie, se puede hacer ya.
  - Una página de marca de la plataforma. El repo de referencia
    (`RamiroLangsam/irupe-code`) hace exactamente esto: verificación de Search Console,
    sitemap, OG y JSON-LD. Sale primero porque "irupe code" es un nombre propio y no
    compite con nadie; "resto" no tiene esa ventaja.
- **Diseño.** Hecho en la página pública. Si hay que seguir, el panel es el siguiente:
  funciona bien pero es denso, y eso ahí está bien; lo que le falta es respirar un poco.

## Decisiones que ya tomó el dueño y no hay que volver a preguntar

- La reserva de la 01:00 del domingo va en la planilla del **sábado**.
- El plano salta de a **15 minutos**; el alta de mostrador acepta **cualquier** minuto.
- La limpieza **no computa**: es pasar un trapo.
- Los días especiales pueden **abrir antes** de lo habitual y tener **varias tandas**.
- Solo se cargan días especiales **hacia adelante**.
- Al dar de alta un local, la pantalla **queda como está**.
- La plataforma se llama **resto**.
