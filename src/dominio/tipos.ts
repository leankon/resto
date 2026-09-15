/**
 * Tipos del dominio. Sin I/O, sin dependencias de framework.
 *
 * Todo lo que vive bajo `src/dominio/` es función pura: recibe datos, devuelve
 * decisiones. Es la regla que mantiene el motor testeable sin levantar un servidor.
 */

export type Id = string;
export type Minutos = number;
export type Centimetros = number;

/** 0 = domingo, 6 = sábado (igual que `Date.getDay`). */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Forma de la mesa. Solo importa para dibujarla y para una regla: una mesa redonda no
 * tiene puntas, así que no se le pueden agregar cabeceras.
 */
export type FormaMesa = 'rect' | 'cuadrada' | 'redonda' | 'barra';

export interface Salon {
  id: Id;
  nombre: string;
  orden: number;
}

export interface Mesa {
  id: Id;
  salonId: Id;
  /** Lo que dice el mozo: "12", "Barra 3". */
  nombre: string;
  /** Sillas que la mesa tiene puestas normalmente. */
  capacidadBase: number;
  /** Sillas que se pueden sumar en las puntas (0–2). Una mesa de 4 sienta 6 así. */
  cabeceras: number;
  /** Mínimo razonable de comensales: evita sentar una pareja en la mesa de 10. */
  capacidadMin: number;
  /** Centro de la mesa sobre el plano del salón. */
  x: Centimetros;
  y: Centimetros;
  forma: FormaMesa;
  /** `false` para lo que no se mueve: barra, mesas empotradas, bancos de pared. */
  combinable: boolean;
  activa: boolean;
}

export interface Periodo {
  desde: Date;
  /** Exclusivo. Incluye el buffer de limpieza. */
  hasta: Date;
}

export interface Ocupacion {
  mesaId: Id;
  reservaId: Id;
  periodo: Periodo;
}

/** Tramo con nombre dentro de un día: almuerzo, cena, after office. */
export interface FranjaServicio {
  id: Id;
  nombre: string;
  dias: DiaSemana[];
  /** Hora local del local, "HH:MM". Si `hasta <= desde`, la franja cruza medianoche. */
  desde: string;
  hasta: string;
  /** Última hora a la que se acepta un ingreso. */
  ultimoIngreso: string;
}

/**
 * Duración de turno por franja y tamaño de grupo (D1).
 *
 * `franjaId: null` es el comodín que aplica a cualquier franja. Que siempre haya un
 * fallback evita que un local mal configurado rompa el motor.
 */
export interface ReglaDuracion {
  franjaId: Id | null;
  personasMin: number;
  personasMax: number;
  duracionMin: Minutos;
  bufferMin: Minutos;
}

export interface PesosAsignacion {
  /** Sillas que sobran. Criterio principal. */
  desperdicio: number;
  /** Por cada mesa además de la primera. Una mesa siempre le gana a dos. */
  mesaExtra: number;
  /** Por metro que hay que arrimar las mesas. Implementa "no traer una del otro extremo". */
  distanciaPorMetro: number;
  /** Por silla de punta usada: real, pero se come el codo del de al lado. */
  cabecera: number;
  /**
   * Multiplicador: cuánto más caro es desperdiciar una silla en una mesa escasa que en
   * una común. No es un costo aparte del desperdicio, es un recargo sobre él.
   */
  escasez: number;
  /** Por cada hueco inservible que deja la reserva antes o después. */
  fragmentacion: number;
  /** Por caer en un salón distinto al que pidió el cliente. */
  salonNoPreferido: number;
}

export interface ConfigAsignacion {
  /** Dos mesas se pueden unir si sus centros están a menos de esta distancia. */
  radioCombinacionCm: Centimetros;
  /** Más de 3 es incómodo para el comensal y explota la combinatoria. */
  maxMesasPorCombo: number;
  /** Sillas que se pierden por cada unión. Arranca en 0; el local la sube si hace falta. */
  perdidaPorUnion: number;
  /** Un hueco más corto que esto es capacidad muerta. */
  duracionMinimaTurnoMin: Minutos;
  pesos: PesosAsignacion;
}

export const CONFIG_POR_DEFECTO: ConfigAsignacion = {
  radioCombinacionCm: 250,
  maxMesasPorCombo: 3,
  perdidaPorUnion: 0,
  duracionMinimaTurnoMin: 75,
  pesos: {
    desperdicio: 10,
    mesaExtra: 14,
    distanciaPorMetro: 4,
    cabecera: 6,
    escasez: 3,
    fragmentacion: 5,
    salonNoPreferido: 25,
  },
};
