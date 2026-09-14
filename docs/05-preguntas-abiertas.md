# 05 — Preguntas abiertas

Lo que falta definir para arrancar la Fase 1. Las **bloqueantes** cambian el modelo de
datos; las demás se pueden decidir sobre la marcha con un default razonable.

## Bloqueantes para Fase 1

**1. Duración del turno.**
¿Fija por local (ej. 90 min para todos), variable por tamaño de grupo (la tabla propuesta
en el doc 03), o variable también por franja horaria?
Default si no decidís: variable por tamaño de grupo, con override por franja y por reserva.
Es lo más flexible y el costo extra de implementarlo ahora es bajo; migrar después implica
recalcular periodos de reservas existentes.

**2. ¿Cuántas mesas y cuántos locales esperás?**
Cambia el algoritmo. Hasta ~80 mesas por salón, la búsqueda exhaustiva de combos corre en
milisegundos y no hay nada que optimizar. Arriba de eso (salones de eventos, patios de
comidas) hay que podar. Y en cantidad de tenants: 10 vs. 1.000 no cambia la estrategia de
multi-tenancy recomendada, pero sí cuánto invertir ahora en onboarding automatizado.

**3. ¿Reserva pinea la mesa, o la mesa puede moverse sola hasta el servicio?**
Es el híbrido del doc 01 punto 5. Si aceptás el re-optimizador, el modelo necesita
`fijada_manualmente` y una política de "hasta cuándo se puede mover" desde el día uno.
Recomiendo aceptarlo: recupera capacidad real sin perder la vista del panel.

**4. ¿El cliente elige mesa o zona?**
¿Puede pedir "terraza" o "adentro"? ¿Ve el número de mesa en la confirmación?
Mostrar el número de mesa al cliente es lo que impide re-optimizar después de enviar el
aviso. Recomiendo: **no** mostrar número de mesa en la confirmación, sí permitir preferencia
de zona/nivel. El número se muestra recién en el recordatorio de T-3h, cuando ya está firme.

**5. Estados de reserva.**
Propongo: `pendiente → confirmada → sentada → finalizada`, más `cancelada`, `no_show`,
`hold` (oferta de lista de espera) y `en_riesgo` (no respondió el recordatorio).
¿Falta alguno que uses en la operación real? ¿Hay algo tipo "lista de espera en puerta"
(walk-in) que también quieras modelar? Los walk-ins consumen mesas reales y si no están en
el sistema el motor asigna mesas que en la práctica están ocupadas — **esto es importante**
y el brief no lo menciona.

## Importantes, no bloqueantes

**6. WhatsApp: ¿número compartido de la plataforma o uno por local?**
Ver el cuadro del doc 01. Afecta Fase 3, pero conviene decidirlo antes para modelar
`tenant_canales_whatsapp` con la cardinalidad correcta.

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
