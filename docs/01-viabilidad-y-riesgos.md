# 01 — Viabilidad técnica y riesgos

Estado: borrador para discusión. Nada de esto está implementado todavía.

## Veredicto corto

No hay nada técnicamente inviable en el brief. Todo lo descrito es construible por una
persona sola con un stack convencional. Lo que sí hay son **cinco puntos donde el costo
real es mucho mayor al que aparenta**, y conviene decidirlos ahora porque condicionan el
modelo de datos de la Fase 1.

## Los cinco puntos calientes

### 1. "Cada local tiene su propia página, ej. `fulano.com`"

Dominios propios por tenant es la parte del brief que más se subestima. Implica:

- DNS: el local apunta su dominio (CNAME o A) a nuestra infraestructura.
- TLS on-demand: emitir y renovar certificados por dominio automáticamente
  (Caddy con `on_demand_tls`, o la API de dominios de Vercel/Cloudflare for SaaS).
- Resolución de tenant por `Host` header en cada request.
- Soporte al local cuando el DNS no propaga, que va a pasar siempre.

**Recomendación:** Fase 2 arranca con subdominios de la plataforma
(`fulano.reservas.app`) + **widget embebible**, que es lo que el 90% de los locales
realmente va a usar (lo pegan en su web de Wix/WordPress o lo ponen de link en Instagram).
Dominio propio se deja para Fase 4 como feature de plan pago. El widget resuelve el caso
de uso real — "que el cliente no salga de mi marca" — a una fracción del costo.

Consecuencia para Fase 1: la tabla `tenants` debe tener desde el día uno `slug` único y
una tabla `tenant_dominios` (aunque esté vacía), así no hay migración dolorosa después.

### 2. Un número de WhatsApp para toda la plataforma vs. uno por local

Esta es la decisión más cara del proyecto y hay que tomarla antes de la Fase 3
(pero afecta el modelo de datos de la Fase 1).

| | Número compartido de la plataforma | Número propio por local |
|---|---|---|
| Alta de un local nuevo | inmediata, cero fricción | el local necesita un número, verificación de Meta, Business Manager |
| Lo que ve el cliente final | "Reservas App" — marca ajena | "Bar Fulano" — marca propia |
| Complejidad técnica | baja: un webhook, routear por contexto | alta: hay que ser **Tech Provider** de Meta e implementar **Embedded Signup** |
| Riesgo de calidad | **alto: si un local manda spam, cae el rating del número y se rompe para todos** | aislado por local |
| Plantillas | compartidas, genéricas | por local, personalizables |
| Costo | una línea | según BSP, puede ser por número |

El riesgo de calidad compartida es el que mata la opción 1 a mediano plazo: Meta baja el
límite de mensajería del número entero si acumula bloqueos/reportes.

**Recomendación:** empezar Fase 3 con el número que ya tenés (compartido, para validar el
flujo conversacional) pero modelar `tenant_canales_whatsapp` desde el principio como
relación 1:N, de forma que migrar a número por local sea configuración y no reescritura.

Problema adicional del número compartido: si el cliente escribe "quiero reservar para 4",
**no sabemos a qué local le está escribiendo**. Se resuelve con deep links
(`wa.me/<numero>?text=RESERVA-<slug>`) que prefijan el mensaje con el identificador del
local, y persistiendo el último tenant de la conversación. Funciona, pero es frágil si el
cliente escribe en frío. Con número por local esto desaparece.

### 3. Reserva confirmada sin seña

Técnicamente trivial, comercialmente riesgoso, y es un dato que hay que decirle al local:
**sin seña, el no-show histórico de la industria ronda 10–20%** (sube en fines de semana y
en horarios pico). Todo el valor del sistema de lista de espera + recordatorio depende de
recuperar esa capacidad a tiempo.

No es un problema a resolver ahora, pero sí a **medir desde el día uno**: por eso la Fase 1
ya guarda `no_shows` en el perfil del cliente y el log de eventos de reserva. El panel de
analítica de Fase 4 vende la suscripción justamente con ese número.

Dejar preparada (sin implementar) la opción de "seña para grupos de N+ personas" en la
config del tenant — es la feature que los locales piden apenas ven su tasa de no-show.

### 4. Meta exige opt-in y plantillas pre-aprobadas

Esto está bien identificado en el brief y no es negociable. Implicancias concretas:

- Un recordatorio enviado a las 24hs+ de la última respuesta del cliente **debe** ser una
  plantilla categoría `utility` aprobada por Meta. La aprobación tarda de minutos a días.
- Las plantillas tienen variables posicionales; el copy no se puede improvisar en runtime.
- Si el local quiere texto propio, cada local necesita sus propias plantillas aprobadas →
  otro argumento para número por local, y un flujo de onboarding más largo.
- El opt-in tiene que quedar **auditado**: cuándo, desde qué canal, con qué texto exacto.
  No alcanza un booleano; va tabla `consentimientos` con historial.

**Consecuencia de diseño:** el motor de notificaciones nunca decide el texto. Decide
*qué plantilla lógica* enviar (`recordatorio_24h`) y el adaptador de cada canal la traduce
a su formato (plantilla Meta / asunto+HTML de mail / texto de SMS).

### 5. El motor de asignación es el corazón, y tiene una trampa

Asignar mesa firme en el momento de la reserva es lo intuitivo, pero **desperdicia
capacidad**: si a las 21:00 entra una pareja y le doy la mesa de 6 porque es lo único
libre en ese instante, a las 21:15 rechazo un grupo de 6 que sí entraba si hubiese
puesto a la pareja en la mesa de 2 que se liberó.

Hay dos escuelas:

- **Asignación firme al reservar** (lo que pide el brief). Simple, explicable, el cliente
  sabe dónde se sienta. Pierde capacidad.
- **Inventario por capacidad** (lo que hacen OpenTable/Resy): al reservar solo se valida
  que *exista* una asignación factible; la mesa concreta se fija cerca del servicio.
  Aprovecha mucho mejor el salón, pero es más difícil de explicar y de mostrar en el panel.

**Recomendación: híbrido.** Asignar una mesa concreta al reservar (cumple el brief, el
panel siempre tiene algo que mostrar) **pero marcarla como tentativa y permitir que un
re-optimizador la mueva** mientras no esté fijada a mano por el staff y falten más de N
horas para el turno. Esto recupera casi toda la capacidad del modelo de inventario sin
perder la explicabilidad. El flag `fijada_manualmente` en la asignación es lo que hace
que el re-optimizador nunca pise una decisión humana — y es el mismo flag que necesitamos
para auditoría.

## Riesgos menores, para tener en el radar

- **Zonas horarias.** Guardar todo en `timestamptz`, guardar la zona del local, y calcular
  horarios de servicio en hora local. Argentina hoy no tiene DST, pero si el primer cliente
  de afuera sí lo tiene y el modelo asume que no, se rompe en silencio. Costo de hacerlo
  bien ahora: casi cero.
- **Datos personales.** Guardamos teléfono, mail e historial de consumo de personas que
  nunca crearon una cuenta. Aplica la ley de protección de datos personales (Ley 25.326 en
  Argentina) y, si alguna vez hay un local en la UE, GDPR. Mínimo desde el día uno:
  aislamiento real entre tenants, borrado por pedido, y no cruzar perfiles entre locales
  (el brief ya lo pide explícitamente — bien).
- **Normalización de teléfonos.** Es la clave de identidad del cliente. Hay que usar una
  librería seria (`libphonenumber`) con país por defecto por tenant, guardar E.164, e
  indexar por eso. Los celulares argentinos con el `9` y el `15` son un clásico de errores:
  `+5491123456789` vs `011 15 2345-6789` son la misma persona.
- **Webhook de WhatsApp siempre encendido.** Meta reintenta, pero si el endpoint está caído
  suficiente tiempo descarta el mensaje. Esto obliga a un proceso always-on: descarta
  arquitecturas 100% serverless con cold start agresivo para ese endpoint, y obliga a
  responder 200 en menos de ~5s (procesar async, encolar y contestar).
