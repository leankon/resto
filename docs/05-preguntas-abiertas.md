# 05 — Preguntas abiertas

Lo que falta definir para arrancar la Fase 1. Las **bloqueantes** cambian el modelo de
datos; las demás se pueden decidir sobre la marcha con un default razonable.

> Las preguntas 1, 2, 3 y 6 ya están resueltas — ver [doc 00](00-decisiones.md).

## Bloqueantes para Fase 1

**~~1. Duración del turno.~~** Resuelta → **D1**: variable por grupo y por franja.

**~~2. ¿Cuántas mesas y cuántos locales esperás?~~** Resuelta → **D3**: 5–20 locales,
hasta ~50 mesas. Sin podar el algoritmo, onboarding manual por ahora.

**~~3. ¿Reserva pinea la mesa?~~** Resuelta → **D2**: re-optimizable hasta 4hs antes,
salvo que el staff la haya fijado a mano.

**4. ¿El cliente elige mesa o zona?**
¿Puede pedir "terraza" o "adentro"? ¿Ve el número de mesa en la confirmación?
Parcialmente resuelta por **D2**: como la asignación es re-optimizable, la confirmación
**no** lleva número de mesa; se comunica recién en el recordatorio de T-3h, ya congelada.
**Lo que queda por definir:** ¿el cliente puede pedir zona o nivel ("terraza", "adentro",
"planta baja")? Recomiendo que sí, como preferencia blanda que el motor puntúa pero no
garantiza — si es garantía dura, un salón se fragmenta rápido.

**5. Estados de reserva.**
Propongo: `pendiente → confirmada → sentada → finalizada`, más `cancelada`, `no_show`,
`hold` (oferta de lista de espera) y `en_riesgo` (no respondió el recordatorio).
¿Falta alguno que uses en la operación real? ¿Hay algo tipo "lista de espera en puerta"
(walk-in) que también quieras modelar? Los walk-ins consumen mesas reales y si no están en
el sistema el motor asigna mesas que en la práctica están ocupadas — **esto es importante**
y el brief no lo menciona.

## Importantes, no bloqueantes

**~~6. WhatsApp: ¿número compartido o uno por local?~~** Resuelta → **D4**: número por
local como destino, compartido con deep link para probar. `tenant_canales_whatsapp` se
modela 1:N desde la primera migración.

**7. Dominio propio por local.**
¿Es requisito de lanzamiento o alcanza con `fulano.reservas.app` + widget embebible?
Recomiendo empezar con subdominio + widget (doc 01, punto 1).

**8. Multi-idioma.**
¿Solo español rioplatense, o hay que prever inglés/portugués?
Si la respuesta es "quizá después", igual conviene no hardcodear strings de cara al
cliente desde ahora — es barato hacerlo bien al principio y caro después. El contenido que
sí es caro de internacionalizar son las plantillas de WhatsApp (se aprueban por idioma).

**9. Roles y permisos del staff.**
¿Alcanza con `dueño` / `encargado` / `mozo`? ¿Un mozo puede cancelar una reserva, o solo
marcarla como sentada? ¿Hay que registrar quién hizo qué para el dueño?
Default: tres roles, con el log de eventos registrando siempre el actor.

**10. Política de no-show.**
Cuando el cliente no confirma el recordatorio, ¿se libera la mesa automáticamente y se
ofrece a la lista de espera, o queda marcada "en riesgo" y decide el local?
¿Cuántos minutos de tolerancia después del horario antes de marcar no-show?
Default recomendado: no liberar automáticamente; marcar `en_riesgo`, avisar al panel, y
que el encargado libere con un click. Liberar la mesa de alguien que sí venía es peor que
una mesa vacía 15 minutos.

**11. ¿Puede el mismo cliente tener reservas simultáneas en distintos locales?**
Sí, y el sistema no debería impedirlo: los perfiles no se cruzan entre tenants por diseño.
Lo que sí conviene limitar es **reservas duplicadas en el mismo local** (misma persona,
mismo día, mismo horario), que suele ser doble submit o un cliente ansioso. Default: se
detecta y se ofrece modificar la existente en vez de crear otra.

**12. Capacidad máxima simultánea del salón.**
Además de las mesas, ¿hay un límite de comensales que la cocina puede atender por franja
de 15 minutos (*pacing*)? Es una restricción real: un local puede tener 10 mesas libres a
las 21:00 y no poder sacar 40 platos juntos. Si lo necesitás, el motor lleva una regla
extra de "cupo por franja" que es fácil de sumar ahora y molesta de sumar después.

## Menores, con default asumido

- **Antelación de reserva.** Mínima (¿se puede reservar para dentro de 30 minutos?) y
  máxima (¿hasta 60 días?). Default: mínimo 60 min, máximo 90 días, configurable.
- **Cancelación por el cliente.** ¿Hasta cuándo puede cancelar solo? Default: hasta el
  horario del turno, con link firmado sin necesidad de cuenta.
- **Modificación de reserva.** ¿Puede cambiar horario/personas, o tiene que cancelar y
  volver a reservar? Default: puede modificar; internamente es cancelar + reasignar dentro
  de la misma transacción, con evento de auditoría.
- **Niveles/pisos.** ¿Cuántos por local, y hay reglas tipo "arriba no es accesible"?
  Default: N salones por local, con flag de accesibilidad por mesa.
- **Carga del plano.** ¿Dibujarlo en un editor propio, o subir una imagen de fondo y
  ubicar mesas encima? Lo segundo es mucho más rápido de construir y suele ser suficiente.
  Default recomendado: imagen de fondo + mesas posicionables encima.
- **Overbooking deliberado.** ¿Algún local va a querer sobrevender un % para compensar
  no-shows? Default: no, pero el modelo no lo impide a futuro.
