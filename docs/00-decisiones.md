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

---

| # | Decisión | Fecha |
|---|---|---|
| D5 | Sin límite de pacing de cocina: mejor lleno con demora | 2026-09-15 |
| D6 | Los walk-ins se cargan con un botón "ocupar mesa" en el panel | 2026-09-15 |
| D7 | Las combinaciones se derivan solas por cercanía física + cabeceras | 2026-09-15 |
| D8 | Grilla de reserva de 15 minutos | 2026-09-15 |
| D9 | Pisos como solapas en el panel | 2026-09-15 |
| D10 | El plano visual se difiere, pero las coordenadas x/y no | 2026-09-15 |

## D5 — Sin límite de pacing

No se modela cupo de cocina por franja. Si entran 40 personas a las 21:00, el sistema las
acepta: preferible lleno con demora que mesas vacías.

El motor no tiene nada que hacer con esto, pero sí el panel: la vista del día debería
mostrar **cuánta gente entra por franja de 15 minutos**, para que el encargado vea venir
el pico aunque el sistema no lo frene. La demora pasa a ser un riesgo de reputación del
local, no una restricción del software — y es información que el local quiere tener a la
vista, no un número que el sistema decide por él.

## D6 — Walk-ins

Botón "ocupar mesa" en el panel: el mozo marca mesa, cantidad de personas y hora de
ingreso. Internamente es una reserva con `canal_origen = walk_in`, sin `cliente_id`, en
estado `sentada`, con la duración de turno que corresponda al grupo y la franja.

Bloquea la mesa exactamente igual que cualquier otra reserva — misma tabla, misma
constraint `EXCLUDE`. **No hay un segundo mecanismo de ocupación que mantener en sincronía
con el primero**, que es donde estos sistemas se rompen.

Sin esto, el motor asigna mesas que físicamente están ocupadas y el error aparece en el
peor momento posible: con el cliente parado en la puerta.

## D7 — Combinaciones derivadas por cercanía

**El local no carga combinaciones.** Carga mesas con su capacidad, sus cabeceras y su
posición, y el sistema deduce qué se puede unir con qué. Detalle completo en el doc 03.

Dos ideas, las dos salidas de cómo funciona un salón de verdad:

1. **Cercanía, no adyacencia declarada.** Dos mesas se pueden unir si están a menos de
   cierta distancia. Arrimar dos mesas que están a un metro es normal; traer una del otro
   extremo del salón, no. Y la distancia **no es solo un filtro sí/no: es parte del
   puntaje**, así que entre dos combinaciones válidas el motor elige la que hace mover
   menos las mesas.
2. **Cabeceras.** Una mesa de 4 rectangular sienta 6 agregando una silla en cada punta.
   Se modela como capacidad extra disponible con una penalización leve, porque es real
   pero menos cómodo. Es lo que evita unir dos mesas cuando alcanzaba con dos sillas.

Así, un grupo de 6 se resuelve con la mejor de: una mesa de 6 libre → una de 4 con las dos
cabeceras → dos de 3 pegadas → una de 4 más una de 2 al lado. En ese orden, y el orden lo
produce el puntaje, no una lista de reglas escritas a mano.

**Escape hatch:** una tabla opcional de combinaciones vetadas, para el caso real de dos
mesas que están cerca pero no se pueden unir (una columna en el medio, tapan el paso al
baño). Arranca vacía y no requiere ninguna carga en el alta del local.

## D8 — Grilla de 15 minutos

El cliente reserva a :00, :15, :30 o :45. Suficientes opciones sin fragmentar el salón en
huecos de 8 minutos que no sirven para nada.

La grilla aplica a lo que **elige el cliente**. El staff puede cargar cualquier horario a
mano desde el panel, porque la realidad no se ajusta a la grilla.

## D9 — Pisos como solapas

Cada salón (`Planta baja`, `Terraza`, `Arriba`) es una solapa en la vista de ocupación.
Ventaja secundaria: hace evidente de un vistazo si un piso está quedando vacío mientras
el otro se llena, que es justo lo que el encargado quiere ver.

Las mesas **no se combinan entre salones**: unir una mesa de la terraza con una de adentro
no existe. La restricción cae sola del criterio de cercanía, pero se valida explícito.

## D10 — El plano se difiere, las coordenadas no

El plano visual (imagen de fondo, arrastrar mesas) queda para más adelante, como pediste.

**Pero hay una consecuencia de D7 que conviene tener clara:** al derivar las combinaciones
por cercanía, las coordenadas `x`/`y` dejaron de ser decoración del panel y pasaron a ser
**entrada del motor de asignación**. Sin posiciones, el sistema no sabe qué mesas se pueden
unir.

Esto **no bloquea** la Fase 1. El motor se construye y se testea con coordenadas en
fixtures. Para cargar un local real hacen falta las posiciones, pero alcanza con una
grilla simple de números — la imagen de fondo y el drag & drop son la capa linda encima,
y llegan en Fase 2.

Si cuando me pases el plano resulta que las posiciones exactas son un problema, el
fallback es agrupar mesas por sector (`ventana`, `fondo`, `barra`) y permitir unir dentro
del mismo sector. Pierde el matiz de "a qué distancia", pero no requiere coordenadas.

## D11 — El comensal no se registra: la reserva se abre con un link

El brief es explícito en que el cliente final nunca crea una cuenta. Pero después de
reservar tiene que poder volver a su reserva: para verla, y sobre todo para cancelarla.

La solución es un **link con un token al azar de 256 bits**. Quien tiene el link puede
ver y cancelar esa reserva y ninguna otra. No hay contraseña que recordar, ni mail de
verificación, ni un "olvidé mi contraseña" que mantener.

En la base se guarda **solo el hash del token**, igual que con las sesiones del staff:
con una copia de la base robada no se puede cancelar la cena de nadie. La consecuencia
práctica es que el token existe una sola vez, en el momento de crearlo. Emitir uno nuevo
—para reenviar el link por mail en la Fase 3— **invalida el anterior**, que es lo correcto
si el primero se mandó a la dirección equivocada.

**Lo que se resigna:** alguien que reenvía el link se lo pasa a otra persona, y esa otra
persona puede cancelar. Es aceptable: el daño máximo es perder una mesa, no una cuenta,
y el local ve la cancelación en su planilla con el motivo registrado.

## D12 — La web pública arranca apagada

Un local recién dado de alta tiene `web_publica = false`. El link existe pero muestra el
teléfono en lugar del formulario.

Es deliberado: entre que se crea el local y que se carga el salón con sus mesas y los
horarios reales, hay horas o días. Una página que acepta reservas en ese intervalo las
asigna contra un salón de ejemplo, y el primer cliente real llega a un local que no sabe
que lo espera. Prenderla es un checkbox, y la pantalla dice qué falta.

## D13 — Cuatro límites de cara al público, y ninguno más

La página pública no es un panel de administración. Lo que el local decide es:

| Límite | Por defecto | Para qué |
|---|---|---|
| Anticipación mínima | 60 min | Que la cocina se entere antes de que la gente esté en la puerta |
| Plazo máximo | 60 días | No tomar reservas para un menú que todavía no existe |
| Grupo más grande | 10 | Un grupo de 20 se arma hablando, no con un formulario |
| Cancelar hasta | 120 min antes | Cerca de la hora ya se compró la mercadería |

Todo lo demás —qué horarios se ofrecen, cuánto dura el turno, qué mesa toca— sale de la
configuración que ya existe. **La grilla de horarios corre el mismo motor que una reserva
real**, mesa por mesa: si la web ofreciera horarios con un criterio propio, el cliente
elegiría uno que después el motor rechaza, y se enteraría recién con los datos cargados.

## D14 — El plano ofrece mesas por turno, no por instante

La vista del salón muestra un momento: "el salón a las 21:00". Pero una reserva no es un
instante, es un turno de una hora y media más el buffer de limpieza.

La primera versión ofrecía como destino cualquier mesa libre **en ese instante**. El
efecto era el peor posible: el mozo veía la mesa 2 libre, movía ahí la reserva de las
20:30, y la base rechazaba el movimiento porque la mesa 2 está tomada desde las 21:15.
El sistema tenía razón y la pantalla mentía.

Ahora el plano carga, por mesa, **todas las ocupaciones del turno**, y solo marca como
destino las que están libres durante el período completo de la reserva que se está
moviendo. Las que no sirven quedan apagadas y no responden al toque, con el motivo en el
título. La constraint `EXCLUDE` sigue ahí como red de seguridad; lo que cambió es que
ahora casi nunca se llega a tocarla.

**Consecuencia:** mover una reserva armada con varias mesas las mueve todas. Es lo
correcto —una reserva de seis en dos mesas unidas no se parte en dos— y el cartel lo dice
antes de que se confirme.

## D15 — El día es el día de servicio, no el del almanaque

Para un bar que cierra a las 02:00, la reserva de la 01:00 del domingo **es la noche del
sábado**. El mozo que a esa hora sigue trabajando está haciendo el sábado, y su planilla
tiene que decir lo mismo. Antes el sistema cortaba a la medianoche y partía la noche en
dos planillas: la mitad de las mesas de un servicio aparecían en el día siguiente, donde
no las miraba nadie.

El corte **sale de las franjas**, no de un valor aparte: es la hora de cierre más tardía
entre las franjas que cruzan medianoche. Un local que cierra a las 02:00 tiene corte 120;
uno que cierra a las 23:00 tiene corte 0, y ahí día de servicio y día de almanaque son lo
mismo. Si el local cambia su horario de cierre, el corte lo sigue solo.

Todo lo que mira un día usa el mismo corte —la planilla, el gráfico de ingresos, las horas
del plano, el alta de mostrador, el botón "volver al día"—. Si dos pantallas contaran el
día distinto, la del sábado no cerraría con la del domingo y nadie sabría cuál creer.

**Consecuencia menos obvia:** cargar una reserva "a la 01:00 del sábado" desde el panel
guarda la 01:00 del **domingo**, que es cuando esa gente va a estar sentada. La fecha que
elige el staff es el día de trabajo, no el que marca el reloj.

## D16 — El plano se mira de a cuartos de hora

El selector de hora del salón avanza de 15 en 15 minutos y no admite un valor intermedio:
no se puede mirar el salón "a las 23:01". Dos personas mirando la misma pantalla tienen
que estar viendo el mismo momento, y un minuto suelto no le sirve a nadie para decidir.

Entre el almuerzo y la cena hay más de cuarenta cuartos de hora, así que la fila de
botones se reemplazó por un desplegable con flechas a los costados. Las flechas son para
el uso real —correrse un rato y ver qué pasa—; el desplegable, para saltar lejos.

**Cargar una reserva a mano no tiene esa restricción.** El que llama por teléfono pide las
21:10, y obligar al mozo a redondear lo hace perder la mesa o anotar una hora que no es.
