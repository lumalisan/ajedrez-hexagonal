import type { Direction, GameAction, Hex, Piece, Player } from './types';

export interface RuleSequenceStep {
  label: string;
  actorId: string;
  kind: GameAction['kind'];
  to?: Hex;
  targetId?: string;
  cannon?: Direction;
  kamikaze?: boolean;
}

export interface RuleSequence {
  pieces: Piece[];
  steps: RuleSequenceStep[];
}

const at = (q: number, r: number): Hex => ({ q, r });
// Directions are world coordinates; north in the cyan viewpoint is direction 3.
const soldier = (id: string, owner: Player, q: number, r: number): Piece => ({
  id,
  type: 'soldier',
  owner,
  position: at(q, r),
  facing: owner === 0 ? 3 : 0,
});
const tank = (
  id: string,
  owner: Player,
  q: number,
  r: number,
  cannon: Direction = owner === 0 ? 3 : 0,
): Piece => ({ id, type: 'medium', owner, position: at(q, r), cannon });
const plane = (id: string, owner: Player, q: number, r: number): Piece => ({
  id,
  type: 'airplane',
  owner,
  position: at(q, r),
  facing: owner === 0 ? 3 : 0,
});
const unit = (
  id: string,
  type: 'capturer' | 'long' | 'fast' | 'drone',
  owner: Player,
  q: number,
  r: number,
): Piece => ({ id, type, owner, position: at(q, r) });
const move = (
  label: string,
  actorId: string,
  q: number,
  r: number,
  cannon?: Direction,
): RuleSequenceStep => ({ label, actorId, kind: 'move', to: at(q, r), cannon });
const shoot = (label: string, actorId: string, targetId: string): RuleSequenceStep => ({
  label,
  actorId,
  kind: 'shoot',
  targetId,
});
const stack = (id: string, q: number, r: number, airplane = false): Piece[] => [
  soldier(`${id}-ground`, 1, q, r),
  airplane ? plane(`${id}-air`, 1, q, r) : unit(`${id}-air`, 'drone', 1, q, r),
];

export const RULE_SEQUENCES: Record<string, RuleSequence[]> = {
  soldado: [
    {
      pieces: [soldier('actor', 0, 2, -3), tank('target', 1, 0, 0)],
      steps: [
        move('El Soldado avanza de [+2, −3] a [+1, −2] y se orienta al moverse.', 'actor', 1, -2),
        move('El Soldado continúa hasta [+1, −1].', 'actor', 1, -1),
        move('El Soldado ataca al Tanque y ocupa su casilla [+0, +0].', 'actor', 0, 0),
      ],
    },
  ],
  capturador: [
    {
      pieces: [unit('actor', 'capturer', 0, 2, -3), tank('target', 1, 0, 0)],
      steps: [
        move('El Capturador avanza de [+2, −3] a [+1, −2].', 'actor', 1, -2),
        move('El Capturador continúa hasta [+1, −1], junto al Tanque.', 'actor', 1, -1),
        {
          label: 'El Tanque de [+0, +0] pasa a ser cian; ambas unidades conservan su casilla.',
          actorId: 'actor',
          kind: 'convert',
          targetId: 'target',
        },
      ],
    },
  ],
  tanque: [
    {
      pieces: [tank('actor', 0, 2, -3), tank('target', 1, -1, 1)],
      steps: [
        move('El Tanque avanza hasta [+2, −2] y orienta su cañón hacia NE.', 'actor', 2, -2, 4),
        move('El Tanque avanza hasta [+1, −1] manteniendo el cañón hacia NE.', 'actor', 1, -1, 4),
        shoot('El Tanque dispara al Tanque ámbar situado en [−1, +1].', 'actor', 'target'),
      ],
    },
  ],
  lanzamisiles: [
    {
      pieces: [unit('actor', 'long', 0, 2, -3), tank('target', 1, -1, 2)],
      steps: [
        move('El Lanzamisiles avanza hasta [+1, −2].', 'actor', 1, -2),
        move('El Tanque ámbar avanza de [−1, +2] a [−1, +1].', 'target', -1, 1, 0),
        shoot(
          'El Lanzamisiles dispara al Tanque, ahora a tres casillas de distancia.',
          'actor',
          'target',
        ),
      ],
    },
  ],
  embestidor: [
    {
      pieces: [
        unit('actor', 'fast', 0, 0, -3),
        soldier('block-one', 0, 4, -3),
        soldier('block-two', 0, 0, -1),
        soldier('block-three', 0, -4, 1),
        tank('target', 1, 0, 3),
      ],
      steps: [
        move('El Embestidor recorre la línea libre hasta [−3, +0].', 'actor', -3, 0),
        move('El Embestidor cambia de dirección y avanza hasta [+0, +0].', 'actor', 0, 0),
        move('El Embestidor ataca al Tanque y ocupa [+0, +3].', 'actor', 0, 3),
      ],
    },
  ],
  dron: [
    {
      pieces: [
        unit('actor', 'drone', 0, 0, -3),
        unit('drone-one', 'drone', 0, 2, -3),
        unit('drone-two', 'drone', 0, -2, -1),
        soldier('ground', 0, 0, -1),
        tank('target', 1, -3, 2),
      ],
      steps: [
        move('El Dron vuela hasta [+0, −1] y se sitúa sobre el Soldado cian.', 'actor', 0, -1),
        move('El Dron ataca al Tanque y ocupa su casilla [−3, +2].', 'actor', -3, 2),
      ],
    },
  ],
  avion: [
    {
      pieces: [
        plane('actor', 0, 0, -3),
        unit('drone', 'drone', 0, 0, -1),
        soldier('ground-one', 0, 1, -2),
        soldier('ground-two', 0, -1, -1),
        tank('target-one', 1, -1, 2),
        tank('target-two', 1, -3, 1),
      ],
      steps: [
        move(
          'El Avión avanza en diagonal hasta [−1, −2] y cambia de orientación.',
          'actor',
          -1,
          -2,
        ),
        move('El Avión avanza hasta [−1, −1] y se sitúa sobre el Soldado.', 'actor', -1, -1),
        shoot('El Avión dispara al Tanque ámbar situado en [−1, +2].', 'actor', 'target-one'),
        {
          ...move(
            'El Avión realiza un ataque kamikaze contra el Tanque de [−3, +1]; ambos quedan destruidos.',
            'actor',
            -3,
            1,
          ),
          kamikaze: true,
        },
      ],
    },
  ],
  'casillas-compartidas': [
    {
      pieces: [
        ...stack('right', 3, -1),
        ...stack('left', -3, 2),
        ...stack('center', 0, 0, true),
        soldier('soldier', 0, 3, -2),
        unit('fast', 'fast', 0, 0, -3),
        unit('capturer', 'capturer', 0, -3, 1),
      ],
      steps: [
        move(
          'Animación 1 · El Soldado ataca al Soldado de [+3, −1]; el Dron ámbar permanece encima.',
          'soldier',
          3,
          -1,
        ),
        move(
          'Animación 1 · El Embestidor ataca al Soldado de [+0, +0]; el Avión ámbar permanece encima.',
          'fast',
          0,
          0,
        ),
        {
          label:
            'Animación 1 · El Capturador convierte al Soldado de [−3, +2]; el Dron continúa siendo ámbar.',
          actorId: 'capturer',
          kind: 'convert',
          targetId: 'left-ground',
        },
      ],
    },
    {
      pieces: [
        ...stack('right', 3, -1),
        ...stack('left', -3, 2),
        ...stack('center-right', 1, 0, true),
        ...stack('center-left', -1, 1, true),
        tank('tank', 0, 3, -3),
        unit('long', 'long', 0, 1, -3),
        plane('plane', 0, -1, -2),
        unit('drone', 'drone', 0, -3, 0),
      ],
      steps: [
        shoot(
          'Animación 2 · El Tanque dispara al Dron de [+3, −1]; el Soldado permanece.',
          'tank',
          'right-air',
        ),
        shoot(
          'Animación 2 · El Lanzamisiles dispara al Avión de [+1, +0]; el Soldado permanece.',
          'long',
          'center-right-air',
        ),
        shoot(
          'Animación 2 · El Avión dispara al Avión de [−1, +1]; el Soldado permanece.',
          'plane',
          'center-left-air',
        ),
        move(
          'Animación 2 · El Dron ataca al Dron de [−3, +2] y queda sobre el Soldado ámbar.',
          'drone',
          -3,
          2,
        ),
      ],
    },
  ],
};
