# 00 — Decisiones tomadas

Registro de lo que ya está definido. Lo que no está acá sigue abierto (ver doc 05).

| # | Decisión | Fecha |
|---|---|---|
| D1 | Duración de turno variable por tamaño de grupo **y** por franja horaria | 2026-09-14 |
| D2 | Asignación firme al reservar, pero re-optimizable hasta 4hs antes del turno | 2026-09-14 |
| D3 | Escala objetivo del primer año: 5–20 locales, hasta ~50 mesas por local | 2026-09-14 |
| D4 | WhatsApp: número propio por local como destino; compartido con identificador de tenant solo para probar | 2026-09-14 |

---

## D1 — Duración de turno por grupo y por franja

Una tabla de reglas `duraciones_turno (franja, rango de personas) → duración + buffer`,
no un número en la config. Detalle y valores sembrados en el doc 03.

**Por qué importa:** el almuerzo rota más rápido que la cena. Modelarlo es la diferencia
entre vender dos turnos de mediodía o uno solo, y es el tipo de cosa que un local nota
enseguida si el sistema no la contempla.

**Costo de la decisión:** una tabla extra y un resolutor con fallback en cascada. Bajo
ahora; migrar después obliga a recalcular los `periodo` de todas las reservas cargadas.

## D2 — Asignación re-optimizable

La reserva recibe una mesa concreta en el momento de reservar (el panel siempre tiene algo
que mostrar), pero un job puede reacomodarla mientras se cumplan **todas** estas
condiciones:

- `fijada_manualmente = false` — el staff nunca es pisado por el automatismo.
- Faltan más de **4 horas** para el turno (configurable por tenant).
- Al cliente no se le comunicó todavía el número de mesa.

**Por qué importa:** pinear la mesa temprano desperdicia capacidad. Si a las 21:00 entra
una pareja y se lleva la mesa de 6 porque es lo único libre en ese instante, a las 21:15
se rechaza un grupo de 6 que sí entraba reacomodando. El re-optimizador recupera esa
capacidad sin perder la explicabilidad del modelo de mesa firme.

**Consecuencias de diseño:**
- `reservas_mesas.fijada_manualmente` existe desde la primera migración.
- El re-optimizador corre dentro del mismo advisory lock que el motor de asignación.
- Toda corrida escribe eventos `reoptimizada` en `reservas_eventos`.
- **La confirmación al cliente no incluye número de mesa.** Se comunica recién en el
  recordatorio de T-3h, cuando la asignación ya está congelada. (Ver pregunta 4 del doc 05
  — esta decisión la responde parcialmente.)

## D3 — Escala del primer año: 5–20 locales, ~50 mesas

**Lo que habilita:**
- Búsqueda exhaustiva de combinaciones sin podar: con ≤50 mesas y combos de máximo 3, el
  espacio de candidatos es chico y corre en milisegundos. **No optimizar nada todavía.**
- Onboarding manual o semi-asistido: el alta de un local la puede hacer el super-admin.
  El onboarding autoguiado se posterga a Fase 4, como dice el brief.
- Un solo contenedor y una sola base alcanzan de sobra. Nada de sharding ni réplicas.

**Lo que igual se hace ahora porque es barato ahora y caro después:** `tenant_id` + RLS,
logs estructurados con `tenant_id`, y el límite de 3 mesas por combo como configuración y
no como constante hardcodeada.

## D4 — WhatsApp: número por local, compartido para probar

Destino: cada local con su número. Para probar el flujo conversacional en Fase 3 se usa el
número existente, con deep links `wa.me/<numero>?text=RESERVA-<slug>` para identificar a
qué local le escribe el cliente.

**Consecuencia de diseño:** `tenant_canales_whatsapp` es 1:N desde la primera migración.
El número compartido es una fila con `es_compartido = true`. El ruteo entrante resuelve el
tenant por `(numero_destino → conversación activa → deep link)` en ese orden. Cuando un
local trae su número propio, se carga una fila y el prefijo deja de aplicarse para él.

**Lo que hay que presupuestar:** llegar al destino requiere ser Tech Provider de Meta con
Embedded Signup, o un BSP que ya lo tenga resuelto (360dialog). Es un bloque de trabajo
propio — cierre de Fase 3 o comienzo de Fase 4, no parte del MVP conversacional.

**Riesgo mientras tanto:** con número compartido, un local que genere bloqueos o reportes
baja el rating del número para todos. Aceptable en piloto con 5–20 locales conocidos;
no aceptable como estado final. Es la razón por la que el destino es número por local.
