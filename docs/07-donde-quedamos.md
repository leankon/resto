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

**La vista de la semana.** En `src/servicios/configuracion.ts` están escritas y tipadas
`horarioSemanal`, `cambiarHorarioDeUnDia`, `quitarDiaDeFranja` y `copiarHorarioDeDia`.
**Nadie las llama todavía**: no hay pantalla ni tests. Falta:

1. Tests de servicio, sobre todo del partido de franjas: cambiar el viernes de una franja
   que va de martes a domingo tiene que dejar el martes como estaba.
2. La sección "La semana" en `/panel/horarios`: siete filas, como el cartel de la puerta,
   con las horas editables por día y un "copiar de otro día".
3. Un paso en `humo:horarios` que cambie un solo día y verifique que los otros no se
   movieron.

Hasta que eso esté, el horario se sigue editando por franjas, que funciona.

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
- **Diseño.** Hay que definir si se arranca por maquetas o derecho al código. La página
  pública es la que más lo necesita: es la que ve el cliente del restaurante.

## Decisiones que ya tomó el dueño y no hay que volver a preguntar

- La reserva de la 01:00 del domingo va en la planilla del **sábado**.
- El plano salta de a **15 minutos**; el alta de mostrador acepta **cualquier** minuto.
- La limpieza **no computa**: es pasar un trapo.
- Los días especiales pueden **abrir antes** de lo habitual y tener **varias tandas**.
- Solo se cargan días especiales **hacia adelante**.
- Al dar de alta un local, la pantalla **queda como está**.
- La plataforma se llama **resto**.
