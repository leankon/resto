# 03 — Modelo de datos y motor de asignación

## Modelo de datos (Fase 1)

Toda tabla de negocio lleva `tenant_id`. Toda tabla lleva `creado_en` / `actualizado_en`.
IDs `uuid v7` (ordenables por tiempo, no filtran volumen como los seriales).

**Plataforma**
- `tenants` — el local. `slug` único, zona horaria, país por defecto (para normalizar
  teléfonos), moneda, estado (`activo`/`suspendido`), plan.
- `tenant_dominios` — dominios propios. Vacía en Fase 1, existe para no migrar después.
- `usuarios` — staff. Email + hash Argon2.
- `usuarios_tenants` — N:M con `rol` (`dueño`/`encargado`/`mozo`). Permite que una persona
  trabaje en dos locales sin duplicar cuenta.
- `admins_plataforma` — super-admin. Tabla separada a propósito: un admin de plataforma no
  es un usuario de tenant con un flag, y mezclarlos es cómo se filtran privilegios.

**Salón**
- `salones` — un nivel/piso. (`Planta baja`, `Terraza`). Un tenant tiene N.
- `mesas` — `salon_id`, `nombre` (lo que dice el mozo: "12", "Barra 3"), `capacidad_min`,
  `capacidad_max`, `x`, `y`, `ancho`, `alto`, `forma`, `rotacion`, `activa`.
  `capacidad_min` existe para no sentar una pareja en una mesa de 10 salvo que no haya otra.
- `mesas_adyacencias` — par de mesas que se pueden unir. Grafo no dirigido.
- `combinaciones` — combos válidos **precalculados** a partir del grafo, con capacidad
  resultante y un costo. Se recalculan cuando cambia el plano, no en cada búsqueda.
- `horarios_servicio` — por día de semana: apertura, cierre, último ingreso, salón activo.
- `excepciones_calendario` — feriados, cierres, horarios especiales, eventos privados.
- `bloqueos` — mesa fuera de servicio en un rango (mantenimiento, evento).

**Clientes y reservas**
- `clientes` — `tenant_id`, `telefono_e164`, `email`, `nombre`, `visitas`, `no_shows`,
  `cancelaciones`, `ultima_visita_en`, `notas`, `etiquetas`.
  `UNIQUE (tenant_id, telefono_e164)` y `UNIQUE (tenant_id, email)` parciales.
  **Nunca** se cruzan entre tenants: dos locales que tienen al mismo comensal ven dos filas
  distintas, con historiales distintos. Es lo que pide el brief y además es lo correcto
  legalmente.
- `reservas` — `tenant_id`, `cliente_id`, `inicio` (timestamptz), `duracion_min`,
  `personas`, `estado`, `canal_origen` (`web`|`whatsapp`|`manual`|`widget`), `notas`,
  `creada_por_usuario_id` (null si vino del cliente).
- `reservas_mesas` — **la tabla de inventario**. `reserva_id`, `mesa_id`, `periodo`
  (`tstzrange`, incluye el buffer de limpieza), `fijada_manualmente` (bool).
  Una reserva tiene N filas acá si ocupa un combo.
- `reservas_eventos` — append-only. Toda transición de estado y toda reasignación.
- `asignaciones_log` — por qué el motor decidió lo que decidió (ver más abajo).

**Fases 3–4 (modelar ya, implementar después)**
- `lista_espera`, `ofertas_espera`, `notificaciones` (outbox), `consentimientos`,
  `conversaciones_whatsapp`, `tenant_canales_whatsapp`.

### La restricción que hace imposible el doble booking

Esto es lo más importante del modelo y reemplaza una montaña de lógica defensiva:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservas_mesas
  ADD CONSTRAINT reservas_mesas_sin_solape
  EXCLUDE USING gist (mesa_id WITH =, periodo WITH &&)
  WHERE (bloqueante);
```

`bloqueante` es una columna generada: true cuando el estado de la reserva es
`pendiente`, `confirmada`, `hold` o `sentada`; false cuando es `cancelada`, `no_show`
o `finalizada`.

Con esa constraint, **la base de datos hace físicamente imposible sentar dos reservas en
la misma mesa a la misma hora**, sin importar qué bug tenga la aplicación, cuántos
procesos corran en paralelo, o si alguien inserta a mano desde psql. Es el único invariante
del sistema que no se puede delegar al código de aplicación.

Las ofertas de lista de espera usan la misma tabla con estado `hold`: un hold *es* una
reserva provisional, y por eso bloquea la mesa mientras el cliente decide. No hay un
segundo mecanismo de reserva temporal que mantener en sincronía.

## Motor de asignación

### Entrada y salida

```
asignar(tenant, inicio, personas, preferencias?) ->
  | { tipo: 'asignada', mesas: Mesa[], log: Explicacion }
  | { tipo: 'sin_lugar', alternativas: Horario[], log: Explicacion }
```

Función pura: recibe el estado del salón y las reservas del día ya cargados, devuelve una
decisión. No toca la base. Eso la hace testeable con fixtures y determinista.

### Duración del turno

Configurable por tenant, con esta forma por defecto (a confirmar con vos):

| Personas | Duración | + buffer |
|---|---|---|
| 1–2 | 90 min | 15 min |
| 3–4 | 105 min | 15 min |
| 5–8 | 120 min | 20 min |
| 9+ | 150 min | 20 min |

Con override por franja horaria (un almuerzo de oficina rota más rápido que una cena de
sábado) y override manual por reserva desde el panel. El buffer se suma al `periodo` de
`reservas_mesas` pero no se le muestra al cliente.

### Algoritmo

1. **Resolver turno.** Duración + buffer → `periodo = [inicio, inicio+duracion+buffer)`.
2. **Validar calendario.** Horario de servicio del día, excepciones, último ingreso.
   Si falla acá, no se busca nada: se responde con el motivo.
3. **Generar candidatos.**
   - Mesas individuales con `capacidad_min <= personas <= capacidad_max`.
   - Si no hay ninguna que entre, combos precalculados con capacidad suficiente,
     limitados a **máximo 3 mesas** (más que eso es incómodo para el comensal y
     explota la combinatoria).
4. **Filtrar por disponibilidad.** Descartar los que solapan con `reservas_mesas`
   bloqueantes y con `bloqueos` en ese periodo.
5. **Puntuar.** Menor puntaje gana:
   - `desperdicio` = capacidad − personas, con peso alto. Es el criterio principal.
   - `penalizacion_combo` = (cantidad de mesas − 1) × peso. Una mesa siempre le gana a dos.
   - `escasez`: penalizar consumir una mesa que es de las pocas que sirven para grupos
     grandes. Se calcula como "cuántos tamaños de grupo quedarían sin opción si uso esta".
     Es lo que evita regalar la mesa de 8 a una pareja.
   - `fragmentacion`: si usar este candidato deja un hueco libre más corto que la duración
     mínima de un turno, ese hueco es capacidad muerta. Penalizar.
   - `preferencia`: zona/nivel pedido por el cliente o configurado por el local.
   - Desempate **determinista** por id de mesa, para que el mismo input dé siempre el
     mismo output (imprescindible para testear).
6. **Si no hay candidato:** buscar en una grilla de ±15/30/60 minutos y devolver los
   horarios que sí tienen lugar. Solo si tampoco hay, ofrecer lista de espera.

### Grupos que no entran en ninguna mesa ni combo

Orden de respuestas, de mejor a peor:
1. Otro horario el mismo día que sí entra.
2. Otro día cercano.
3. Lista de espera para el horario pedido.
4. Derivar al local: marcar la consulta en el panel como "grupo grande sin resolver
   automáticamente" para que alguien llame. Un grupo de 14 en un salón de mesas de 4 es
   una negociación (¿unen mesas en el medio del salón?, ¿privatizan la terraza?), no un
   problema de algoritmo, y el local va a querer atender esa llamada.

El límite de mesas por combo y si se permite el paso 4 son configuración del tenant.

### Explicabilidad

Cada ejecución escribe en `asignaciones_log`:

```json
{
  "version_algoritmo": "1.0.0",
  "entrada": { "inicio": "...", "personas": 6, "duracion_min": 120 },
  "candidatos": [
    { "mesas": [12], "capacidad": 6, "puntaje": 1.0,
      "detalle": { "desperdicio": 0, "escasez": 1.0, "fragmentacion": 0 } },
    { "mesas": [3, 4], "capacidad": 8, "puntaje": 4.2,
      "detalle": { "desperdicio": 2, "penalizacion_combo": 1.5 } }
  ],
  "descartados": [ { "mesas": [7], "motivo": "solapa con reserva 9f2c" } ],
  "elegido": { "mesas": [12] },
  "ms": 4
}
```

Guardar también los descartados con el motivo es lo que permite responder la pregunta que
el local va a hacer siempre: *"¿por qué me dijo que no había lugar si la mesa 7 estaba
vacía?"*. Sin eso, cada reclamo es una sesión de debugging a ciegas.

`version_algoritmo` permite comparar decisiones viejas contra la lógica nueva cuando se
cambian los pesos.

## Concurrencia

Tres escenarios de carrera y su resolución:

### 1. Dos reservas simultáneas para el mismo horario (web + WhatsApp)

**Defensa primaria — advisory lock por (tenant, fecha):**

```sql
SELECT pg_advisory_xact_lock(hashtext($tenant_id || ':' || $fecha));
```

Serializa las asignaciones de un mismo local y un mismo día. El volumen real hace que esto
sea gratis: un local con 200 reservas/día tiene contención cero, y el lock se libera al
terminar la transacción. A cambio, el motor siempre ve un estado estable y no hace falta
un loop de reintentos en el camino feliz.

**Defensa secundaria — la constraint `EXCLUDE`:** si por lo que sea dos escrituras llegan
sin el lock (un script, un bug, una migración), Postgres rechaza con `23P01` y la app
reintenta re-ejecutando el motor. El invariante nunca depende de que el código se acuerde.

Las dos defensas juntas, no una u otra: el lock da rendimiento y previsibilidad, la
constraint da corrección.

### 2. Lista de espera: se libera una mesa y hay dos anotados

Cuando una cancelación libera capacidad, se encola `evaluar_lista_espera(tenant, periodo)`.
Ese job, **de a uno por tenant** (clave de concurrencia de pg-boss = `tenant_id`):

1. Toma el advisory lock del tenant+fecha.
2. `SELECT ... FROM lista_espera ... ORDER BY prioridad FOR UPDATE SKIP LOCKED`.
3. Para el primero cuyo pedido entra en la capacidad liberada, crea una **oferta**:
   una fila en `reservas_mesas` con estado `hold` y `expira_en = now() + 10 min`.
   Como el hold bloquea vía la misma constraint, **esa mesa deja de estar disponible para
   cualquier otro canal en el mismo instante**. No existe la ventana en la que dos personas
   reciben la misma mesa.
4. Envía la notificación con un link/botón de confirmación.
5. Si confirma → `hold` pasa a `confirmada`. Si expira o rechaza → se libera y el job se
   re-encola para el siguiente de la lista.

La alternativa "avisar a los primeros 3 y que gane el más rápido" convierte cada
cancelación en una carrera entre clientes: dos reciben el aviso y uno se come un "ya no
está disponible". Mala experiencia y reclamo al local. **Recomendación: oferta secuencial
con TTL corto** (10 minutos de noche, quizá 5 si faltan menos de 2 horas para el turno).

Orden de prioridad por defecto: FIFO por fecha de anotación. Configurable por tenant hacia
"mejor fit primero" (evita darle una mesa de 6 al primero de la fila que es una pareja,
cuando el segundo es justo un grupo de 6). El trade-off es justicia vs. ocupación; que lo
decida el local, y dejarlo logueado en cualquier caso.

### 3. El re-optimizador mueve una mesa que alguien está editando

El re-optimizador (ver doc 01, punto 5) corre dentro del mismo advisory lock, y **nunca**
toca filas con `fijada_manualmente = true` ni reservas cuyo turno empieza en menos de N
horas (configurable, por defecto 4) o que ya recibieron un aviso con el número de mesa.

## Auditoría de cambios manuales

`reservas_eventos` es append-only y **es la fuente de verdad de la historia**, no un log
de conveniencia:

```
id, tenant_id, reserva_id, tipo, actor_tipo, actor_id, en, datos
```

- `tipo`: `creada`, `asignada_auto`, `reasignada_manual`, `confirmada`, `cancelada`,
  `no_show`, `sentada`, `turno_modificado`, `oferta_enviada`, `oferta_expirada`,
  `reoptimizada`.
- `actor_tipo`: `cliente` | `staff` | `sistema` | `admin_plataforma`.
- `datos`: JSONB con `antes` / `despues` y, en reasignaciones manuales, el motivo opcional
  que escribió el encargado.

Cuando el staff mueve una reserva de mesa en el panel:
1. Se escribe el evento `reasignada_manual` con las mesas antes y después.
2. Se marca `fijada_manualmente = true` en las nuevas filas de `reservas_mesas`.
3. Si la mesa destino está ocupada, la constraint rechaza y la UI lo muestra como
   conflicto — con la opción explícita de intercambiar ambas reservas (swap), que se
   registra como dos eventos vinculados por un mismo `correlacion_id`.

Con esto, "quién movió a los Pérez de la 4 a la 12 y cuándo" se responde con una consulta,
y el re-optimizador automático nunca puede pisar una decisión humana sin dejar rastro.
