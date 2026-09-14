# 04 — Motor de notificaciones multi-canal

## Principio

El módulo de notificaciones **no sabe qué es una reserva**, y las features (confirmación,
recordatorio, lista de espera) **no saben qué es WhatsApp**. Entre medio hay un solo
contrato. Si esa separación se rompe una sola vez — por ejemplo, una función de
recordatorio que llama directo al cliente de la Cloud API — el sistema deja de ser
multi-canal y vuelve a ser un bot de WhatsApp con parches.

```
Feature                Motor                        Adaptadores
─────────              ─────                        ───────────
crearReserva()  ──┐
recordatorio()  ──┼──►  notificar({                 ┌──► WhatsApp (Cloud API)
ofertaEspera()  ──┘       tenantId, clienteId,      ├──► Email (Resend)
                          tipo, datos, urgencia     ├──► SMS  (no implementado)
                        })                          └──► Push (no implementado)
                          │
                          ├─ ResolutorDeCanal → orden de canales elegibles
                          ├─ Outbox (misma tx que la reserva)
                          └─ Worker → adaptador → registro de resultado
```

## El contrato

La feature pide **qué** comunicar, nunca **cómo** ni **por dónde**:

```ts
await notificar({
  tenantId,
  clienteId,
  tipo: 'recordatorio_asistencia',   // plantilla lógica, no texto
  datos: { reservaId, inicio, personas, mesas: ['12'] },
  urgencia: 'alta',                  // define ventana horaria y agresividad del fallback
  requiereRespuesta: true,           // el canal debe ofrecer sí/no
});
```

`tipo` es una **plantilla lógica**. Cada adaptador la traduce a su formato: WhatsApp a una
plantilla aprobada por Meta con variables posicionales, mail a asunto + HTML, SMS a texto
plano. El copy vive en el adaptador, nunca en la feature.

`requiereRespuesta: true` es lo que fuerza a cada canal a resolver el "¿venís? sí/no":
WhatsApp con botones de respuesta rápida; mail con dos links firmados (JWT de vida corta,
un solo uso) que confirman o cancelan **sin que el cliente tenga cuenta** — que es
justamente el requisito del brief.

## Resolutor de canal

Una sola función pura, en un solo archivo. Es "el lugar único" que pide el brief.

```ts
resolverCanales(cliente, tipo, contexto) -> Canal[]   // en orden de preferencia
```

Reglas de elegibilidad por canal:

| Canal | Requiere |
|---|---|
| WhatsApp | teléfono E.164 válido **y** consentimiento vigente **y** (ventana de 24hs abierta **o** existe plantilla aprobada para `tipo`) |
| Email | email presente y no rebotado permanentemente |
| SMS | teléfono **y** consentimiento **y** el tipo está habilitado para SMS en la config del tenant |
| Push | token de dispositivo activo (no existe todavía) |

Sobre la ventana de 24hs: si el cliente escribió hace menos de 24hs, se le puede mandar
texto libre. Fuera de eso, **solo plantilla aprobada categoría `utility`**. El resolutor
consulta `conversaciones_whatsapp.ventana_expira_en` y, si está cerrada y no hay plantilla
aprobada para ese `tipo`, **descarta WhatsApp y pasa al siguiente canal**. Esto no es un
detalle: es la diferencia entre que Meta entregue el mensaje o lo rechace en silencio.

Orden por defecto: `whatsapp → email → sms`. Overrideable por tenant y por tipo. Se puede
querer que la confirmación vaya por los dos canales a la vez y el recordatorio por uno solo.

### Cuando no hay ningún canal

Nunca se falla en silencio. La notificación queda en estado `sin_canal` con el motivo
(`sin contacto` / `sin consentimiento` / `plantilla no aprobada`), y **la reserva se marca
en el panel con un indicador visible**: "este cliente no va a recibir recordatorio". El
local decide si llama por teléfono. Un aviso que no se manda y nadie sabe es peor que no
tener la feature.

## Outbox: por qué no se envía directo

El envío **no** ocurre en el request que crea la reserva. Se escribe una fila en
`notificaciones` dentro de **la misma transacción** que la reserva, y un worker la despacha.

Esto resuelve dos bugs que aparecen sí o sí con envío directo:
- La transacción falla después de mandar el WhatsApp → el cliente tiene confirmación de una
  reserva que no existe.
- El proveedor está caído y el request revienta → la reserva no se guarda por un problema
  de mail.

Con outbox, la reserva o se guarda con su notificación pendiente, o no se guarda ninguna
de las dos. Como pg-boss vive en el mismo Postgres, encolar el job entra en la misma
transacción sin two-phase commit.

Campos clave de `notificaciones`: `tipo`, `canal_elegido`, `estado`
(`pendiente`/`enviada`/`entregada`/`leida`/`fallida`/`sin_canal`), `intentos`,
`proveedor_msg_id`, `error`, `programada_para`, `clave_idempotencia`.

`clave_idempotencia = (reserva_id, tipo)` con índice único: garantiza que un reintento del
worker o un webhook duplicado nunca manda dos recordatorios de la misma reserva.

`proveedor_msg_id` permite conciliar los webhooks de estado de Meta (`sent`, `delivered`,
`read`, `failed`) contra la fila, y ese estado es el que dispara el fallback: si a los N
minutos el recordatorio de WhatsApp no llegó a `delivered`, el worker intenta el siguiente
canal en vez de darlo por enviado.

## Consentimiento

Tabla `consentimientos` con historial, no un booleano en `clientes`:

```
id, tenant_id, cliente_id, canal, otorgado_en, revocado_en,
origen ('web_form'|'whatsapp_inbound'|'panel_staff'|'widget'),
texto_mostrado, ip, user_agent
```

Guardar el **texto exacto** que se le mostró al cliente es lo que permite demostrar el
opt-in si Meta o un organismo lo pide. Un `bool acepta_whatsapp` no prueba nada.

La revocación tiene que funcionar por los dos lados: si el cliente responde "BAJA" por
WhatsApp o clickea el unsubscribe del mail, se escribe `revocado_en` y el resolutor lo
excluye desde el siguiente envío.

## Los tres flujos que consumen el motor

Los tres usan exactamente la misma llamada; ninguno conoce los canales.

**1. Confirmación** — al crear la reserva, cualquiera sea el canal de origen.
Si vino por WhatsApp dentro de la conversación activa, el adaptador responde en la misma
conversación (gratis, sin plantilla). Si vino por web, sale por el canal que resuelva el
motor.

**2. Recordatorio + confirmación de asistencia** — job programado a T-24h y T-3h
(configurable). `requiereRespuesta: true`. Si el cliente no responde antes del corte
(por defecto T-2h), la reserva pasa a `en_riesgo` y se dispara la evaluación de lista de
espera. **El no-show no libera la mesa solo**: la política de liberar automáticamente vs.
esperar al comensal es configuración del tenant, porque liberar la mesa de alguien que sí
va a venir es un incidente peor que una mesa vacía 15 minutos.

**3. Oferta de lista de espera** — `urgencia: 'alta'`, TTL corto, `requiereRespuesta: true`.
Es el único tipo donde la latencia importa de verdad: si el aviso tarda 10 minutos, el
hold expira antes de que el cliente lo lea. Por eso el fallback de canal acá es agresivo y
el TTL se calcula desde la entrega confirmada, no desde el envío.

## Horarios y buen comportamiento

- Nada se manda fuera de la franja razonable del tenant (por defecto 09:00–22:00 hora
  local del local). Un recordatorio a las 3 AM genera bloqueos, y los bloqueos bajan el
  rating del número de WhatsApp.
- Tope de mensajes por cliente por día, para que una cadena de cancelaciones no dispare
  cinco avisos seguidos a la misma persona.
- Las ofertas de lista de espera son la excepción parcial: si el turno es hoy a las 21 y
  son las 20:15, se manda igual; si el turno es mañana, espera al horario permitido.
