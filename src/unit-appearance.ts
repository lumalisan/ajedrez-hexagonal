import type { PieceType } from './types';

/** Visual identity only. Movement, weapons and damage remain defined by the engine. */
export const UNIT_APPEARANCE = {
  soldier: {
    name: 'Asaltador',
    description:
      'Vehículo pequeño y bajo, con chasis triangular, cuatro ruedas y un sensor frontal. Es la máquina terrestre básica del ejército.',
  },
  capturer: {
    name: 'Capturador',
    description:
      'Vehículo compacto de cuerpo circular abierto y dos pinzas mecánicas delanteras, con un núcleo de control central.',
  },
  medium: {
    name: 'Tanque',
    description:
      'Vehículo de casco rectangular achaflanado, dos orugas laterales y una torreta circular baja con un único cañón largo.',
  },
  long: {
    name: 'Lanzamisiles',
    description:
      'Plataforma móvil rectangular con dos misiles paralelos sobre raíles abiertos y un sensor central. Los raíles quedan vacíos al agotar la munición.',
  },
  fast: {
    name: 'Embestidor',
    description:
      'Vehículo bajo y alargado con dos orugas, pistones traseros y una cuña frontal reforzada que termina en una punta de impacto.',
  },
  drone: {
    name: 'Dron',
    description:
      'Máquina aérea con núcleo central romboidal y cuatro brazos, cada uno terminado en un rotor circular protegido.',
  },
  airplane: {
    name: 'Caza',
    description:
      'Aeronave sin cabina, con fuselaje estrecho, alas en flecha, morro afilado y una tobera trasera.',
  },
  antiAir: {
    name: 'Escudo antiaéreo',
    description:
      'Instalación fija de dos apoyos, con un emisor de radar central y un reflector curvo orientado hacia arriba.',
  },
  fortress: {
    name: 'Fortaleza',
    description:
      'Bastión automatizado de planta rectangular, dos torres laterales, coronación almenada y una compuerta central.',
  },
} as const satisfies Record<PieceType, { name: string; description: string }>;

export const RULE_UNIT_APPEARANCES: Record<string, readonly PieceType[]> = {
  soldado: ['soldier'],
  capturador: ['capturer'],
  tanque: ['medium'],
  lanzamisiles: ['long'],
  embestidor: ['fast'],
  dron: ['drone'],
  avion: ['airplane'],
  fortaleza: ['fortress', 'antiAir'],
};
