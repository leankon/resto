# 06 — Cómo poner esto en internet

Guía para pasar de "corre en mi máquina" a "lo abro desde el celular". Pensada para
hacerse de una sentada, y en este orden.

## Antes de empezar: qué hace falta de verdad

**Crear la base de datos sola no alcanza para ver nada.** Una base es una base: no
tiene pantalla. Para abrir el panel desde afuera hacen falta las dos cosas:

| Pieza | Para qué | Cuánto tarda |
|---|---|---|
| Postgres gestionado (Neon o Supabase) | guardar los datos | ~5 min |
| Hosting de la app (Vercel, Railway o Fly) | servir las pantallas | ~10 min |

Con la base sola, el panel sigue existiendo únicamente en la máquina donde corre
`npm run dev`.

**Hasta que el proyecto facture, todo esto va en plan gratuito: Neon free + Vercel
Hobby, USD 0.** Es la decisión tomada y el resto del documento la asume. Pagar
infraestructura antes de tener un local suscripto es gasto sin contrapartida.

## 1. La base

**Neon** o **Supabase**, los dos tienen plan gratuito suficiente para el piloto.
Neon es Postgres pelado y arranca más limpio; Supabase suma auth y storage que este
proyecto no usa (el login del staff es propio), pero su pooler está muy probado.

Lo que el esquema necesita, y que los dos soportan:

- `btree_gist` y `pgcrypto` (las crea la migración).
- Row Level Security con políticas apuntadas a roles.
- Un rol con `CREATEROLE` para crear los tres roles de la app.

Lo que el esquema **no** necesita, y por eso se puede desplegar:

> **Ningún rol es superusuario ni tiene `BYPASSRLS`.** En Postgres gestionado el rol
> con el que uno entra no es superusuario de verdad, así que un esquema que dependa
> de eso directamente no se instala. El acceso ampliado del super-admin sale de
> políticas `TO resto_admin`, que además es más preciso: se ve exactamente qué puede
> tocar. Hay un test que falla si alguien vuelve a meter `BYPASSRLS`.

### Pasos

1. Crear el proyecto y copiar la cadena de conexión del **pooler** (Supabase la
   llama "Connection pooling", modo *transaction*; Neon, "Pooled connection").
   El pooler en modo transacción sirve: todo lo que hace la app es por transacción
   (`SET LOCAL app.tenant_id`, `pg_advisory_xact_lock`), nada depende de la sesión.
2. Aplicar las migraciones:

   ```bash
   export ADMIN="postgresql://postgres:CLAVE@HOST:5432/postgres"
   for f in src/datos/migraciones/*.sql; do psql "$ADMIN" -v ON_ERROR_STOP=1 -f "$f"; done
   ```

   Dos cosas que se descubren recién al correrlas contra Postgres gestionado, y que
   el esquema ya contempla:

   - El usuario con el que entrás **no es superusuario**, así que no puede tocar los
     atributos `SUPERUSER` ni `BYPASSRLS` de ningún rol. Las migraciones solo lo
     intentan si hace falta corregir algo, cosa que en una base nueva nunca pasa.
   - `FORCE ROW LEVEL SECURITY` aplica las políticas **también al dueño de las
     tablas**. O sea que después de instalar, un `SELECT * FROM reservas` desde el
     editor SQL te va a devolver cero filas: no es que falten datos, es que no sos
     ninguno de los roles con permiso. Para mirar, primero `SET ROLE resto_admin;`.

   `npm run db:portabilidad` simula todo esto en local (un usuario con `CREATEROLE`
   pero sin superusuario) para que estos errores no aparezcan recién en el despliegue.

3. **Ponerles contraseña a los tres roles.** Las migraciones los crean **sin**
   contraseña a propósito, así que hay que asignarlas al instalar:

   ```sql
   ALTER ROLE resto_app   PASSWORD 'una-clave-larga-y-distinta';
   ALTER ROLE resto_auth  PASSWORD 'otra-clave-larga-y-distinta';
   ALTER ROLE resto_admin PASSWORD 'otra-más';
   ```

   Dos cosas sobre esas contraseñas:

   - **Neon valida la fuerza y rechaza las débiles** con un error de su control plane
     (`insecure password`), no de Postgres. Pasa tanto en `ALTER ROLE` como en
     `CREATE ROLE`, y por eso las migraciones no traen ninguna adentro: una clave de
     desarrollo hardcodeada hacía que el esquema no se pudiera instalar. Necesitan
     mayúsculas, minúsculas, números y algún caracter especial.
   - Van adentro de una URL, así que **evitá `@ : / ? # & = + %` y `$`**: los primeros
     tienen significado en una URL y el último se interpola en algunos archivos de
     variables de entorno. Con `- _ . ! * ~` alcanza para cumplir el requisito sin
     romper nada.

4. Armar las tres URLs con esas contraseñas. TLS se activa solo: `conexion.ts` cifra
   todo lo que no sea localhost.

## 1.bis Que las migraciones se apliquen solas

Cada cambio de esquema obligaba a entrar al panel del proveedor y pegar SQL a mano, y
olvidarse no daba un error claro: daba una pantalla de "Application error" en la página
que usaba la columna nueva. Eso ya no hace falta.

El build corre `scripts/migrar.ts` antes de compilar: aplica las migraciones pendientes,
lleva registro en la tabla `migraciones_aplicadas`, y corta el despliegue si alguna
falla — mejor no publicar que publicar código que su base no soporta.

Para que funcione hay que cargar **una variable de entorno más**, con la conexión del
**dueño** de la base:

```
DATABASE_URL_OWNER=postgresql://neondb_owner:CLAVE@HOST/neondb?sslmode=require
```

Es la única que necesita ser dueño: crear tablas y cambiar columnas requiere serlo, y
los tres roles de la aplicación no lo son a propósito. Solo se usa durante el build,
nunca en tiempo de ejecución.

Si la variable no está, el script no hace nada y avisa, así un build local no se cae
por no tener credenciales de migración.

## 2. El hosting

**Vercel, plan Hobby.** Gratis y es el camino más corto para Next.js: conectás el repo
y listo.

Dos cosas para tener presentes, ninguna bloquea nada hoy:

- **Hobby es para uso no comercial.** Mientras es tu proyecto está todo bien. El día
  que le cobres a un local, corresponde pasar a Pro.
- **En Fase 3 el webhook de WhatsApp necesita un proceso siempre encendido.** Meta
  espera respuesta en pocos segundos y reintenta, y un reintento puede terminar en una
  reserva duplicada; los recordatorios programados tampoco entran en el cron limitado
  del plan gratuito. Cuando lleguemos ahí se resuelve sumando un servicio chico aparte
  solo para eso, y el panel se queda donde está.

Eso es una decisión de infraestructura, no de código: **no cambia una línea de lo que
está escrito**. `src/dominio` no importa nada de Next.js y los servicios tampoco, así
que mover el webhook y los jobs a otro proceso es mover carpetas.

Si algún día preferís tener todo en una sola pieza, **Railway o Fly** corren un
contenedor siempre encendido por unos USD 5 al mes y el webhook entra ahí sin servicio
extra. Es la opción para cuando haya con qué pagarla.

Variables de entorno a cargar, las tres:

```
DATABASE_URL=postgresql://resto_app:...@HOST:5432/postgres
DATABASE_URL_AUTH=postgresql://resto_auth:...@HOST:5432/postgres
DATABASE_URL_ADMIN=postgresql://resto_admin:...@HOST:5432/postgres
```

## 3. Cargar datos y entrar

```bash
DATABASE_URL=... DATABASE_URL_ADMIN=... npm run db:demo
```

Deja un local de prueba con reservas y estos usuarios:

| Dónde | Usuario | Contraseña |
|---|---|---|
| Panel del local (`/login`) | `duenio@bardemo.test` | `bar-demo-123` |
| Plataforma (`/admin/login`) | `admin@plataforma.test` | `plataforma-123` |

Son de demostración: antes de mostrarle esto a un local real, borralos.

## Lo que falta para llamarlo producción

Esto alcanza para ver y mostrar el MVP. Para operar un local de verdad faltan, y
ninguna es difícil, pero ninguna está hecha:

- Contraseñas de rol distintas de `dev` (paso 3 de arriba).
- Backups automáticos configurados (Neon y Supabase los tienen, hay que prenderlos).
- Un job que limpie sesiones vencidas (`limpiarSesionesVencidas` ya existe, falta
  quién lo llame).
- Límite de intentos de login. Hoy el login es resistente a averiguar quién tiene
  cuenta, pero nada frena a alguien probando contraseñas.
- Sentry o equivalente: sin eso, un error en producción no se entera nadie.
