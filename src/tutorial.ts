import { actionKey } from './action-identity';
import {
  actionDestination,
  applyAction,
  createGameState,
  getLegalActionsForPiece,
  occupancyAt,
} from './engine';
import { equalHex } from './hex';
import type { Direction, GameAction, GameState, Hex, Piece } from './types';

export interface TutorialStep {
  id: string;
  section: number;
  title: string;
  paragraphs: string[];
  instruction: string;
  interaction: 'next' | 'inspect' | 'select' | 'prepare' | 'action' | 'free';
  pieceId?: string;
  target?: Hex;
  autoSelect?: boolean;
  /** Initial selection can differ from the piece the learner must select. */
  selectedId?: string;
  guided?: boolean;
  /** Limited hints in exercises that otherwise require independent play. */
  cue?: 'piece' | 'target';
  mode?: 'rotate' | 'orient' | 'transform';
  /** World direction; the Cian camera rotates the board by half a turn. */
  direction?: Direction;
}

const hex = (q: number, r: number): Hex => ({ q, r });
const NORTH: Direction = 3;
const NORTH_EAST: Direction = 4;
const NORTH_WEST: Direction = 2;

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: '0.1',
    section: 0,
    title: '¡Bienvenido!',
    paragraphs: [
      'En este tutorial aprenderás las reglas básicas del juego y descubrirás cómo utilizar las distintas unidades de tu ejército.',
      'A lo largo del tutorial tendrás que realizar diferentes acciones para poner en práctica lo aprendido.',
    ],
    instruction: 'Pulsa «Siguiente» para comenzar.',
    interaction: 'next',
    guided: false,
  },
  {
    id: '1.1',
    section: 1,
    title: 'La fortaleza',
    paragraphs: [
      'Esta es la fortaleza.',
      'El objetivo del juego es destruir la fortaleza enemiga antes de que el rival destruya la tuya.',
      'Puede tener 1, 2 o 3 puntos de vida, en función de la configuración de la partida.',
    ],
    instruction: 'Pulsa «Siguiente» para continuar.',
    interaction: 'next',
    pieceId: 'tutorial-cian-fortress',
  },
  {
    id: '2.1',
    section: 2,
    title: 'El escudo antiaéreo',
    paragraphs: [
      'Este es el escudo antiaéreo.',
      'Protege la fortaleza de los ataques aéreos y también protege las casillas que lo rodean.',
    ],
    instruction: 'Pulsa «Siguiente» para continuar.',
    interaction: 'next',
    pieceId: 'tutorial-cian-antiAir',
  },
  {
    id: '3.1',
    section: 3,
    title: 'El soldado (1/5)',
    paragraphs: [
      'Este es un soldado.',
      'Puede desplazarse o atacar a una unidad enemiga situada en cualquiera de las tres casillas que tiene delante.',
    ],
    instruction: 'Selecciona la casilla indicada para continuar.',
    interaction: 'select',
    pieceId: 'tutorial-cian-soldier',
  },
  {
    id: '3.2',
    section: 3,
    title: 'El soldado (2/5)',
    paragraphs: [
      'Al seleccionar una unidad, se indican mediante puntos verdes las casillas a las que puede desplazarse.',
      'Además, se muestra el panel de mando, donde se pueden consultar las características de la unidad seleccionada.',
    ],
    instruction: 'Selecciona la casilla indicada para desplazar al soldado hacia el norte.',
    interaction: 'prepare',
    pieceId: 'tutorial-cian-soldier',
    target: hex(4, -3),
    autoSelect: true,
  },
  {
    id: '3.3',
    section: 3,
    title: 'El soldado (3/5)',
    paragraphs: [
      'Para realizar una acción, debes confirmarla en el panel de mando pulsando el botón «Confirmar acción». También puedes hacer doble clic en la casilla de destino.',
    ],
    instruction: 'Confirma la acción para completar el desplazamiento.',
    interaction: 'action',
    pieceId: 'tutorial-cian-soldier',
    target: hex(4, -3),
    autoSelect: true,
  },
  {
    id: '3.4',
    section: 3,
    title: 'El soldado (4/5)',
    paragraphs: [
      'Ahora, el soldado enemigo está dentro de la zona de ataque de tu soldado. Al seleccionar a tu soldado, un punto rojo indicará que puedes atacar al soldado enemigo desplazándote hasta su casilla.',
    ],
    instruction:
      'Selecciona a tu soldado y ataca al soldado enemigo desplazándote hasta su casilla. No olvides confirmar la acción en el panel de mando o haciendo doble clic en la casilla de destino.',
    interaction: 'action',
    pieceId: 'tutorial-cian-soldier',
    target: hex(4, -2),
  },
  {
    id: '3.5',
    section: 3,
    title: 'El soldado (5/5)',
    paragraphs: [
      'El soldado también puede cambiar su orientación sin desplazarse. Al hacerlo, cambia la dirección en la que puede desplazarse y atacar, pero consume su turno.',
      'Para cambiar la orientación del soldado, utiliza el botón «Cambiar orientación» del panel de mando.',
    ],
    instruction: 'Selecciona al soldado y cambia su orientación hacia el noreste (NE).',
    interaction: 'action',
    pieceId: 'tutorial-cian-soldier',
    mode: 'rotate',
    direction: NORTH_EAST,
  },
  {
    id: '4.1',
    section: 4,
    title: 'El capturador (1/2)',
    paragraphs: [
      'Este es un capturador.',
      'Puede desplazarse a cualquiera de las seis casillas que lo rodean y capturar una unidad enemiga situada en una de ellas.',
    ],
    instruction:
      'Selecciona la casilla indicada y desplaza al capturador hacia el norte para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-capturer',
    target: hex(2, -2),
  },
  {
    id: '4.2',
    section: 4,
    title: 'El capturador (2/2)',
    paragraphs: [
      'Ahora, el soldado enemigo está dentro de la zona de captura de tu capturador. Al seleccionar al capturador, una red de color cian indicará que puedes capturar al soldado enemigo para convertirlo en aliado.',
    ],
    instruction: 'Selecciona al capturador y captura al soldado enemigo para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-capturer',
    target: hex(2, -1),
  },
  {
    id: '5.1',
    section: 5,
    title: 'El tanque (1/6)',
    paragraphs: [
      'Este es un tanque.',
      'Puede desplazarse a cualquiera de las seis casillas que lo rodean y disparar a las casillas situadas a dos hexágonos de distancia, en la dirección a la que apunta su cañón.',
    ],
    instruction: 'Selecciona la casilla indicada para continuar.',
    interaction: 'select',
    pieceId: 'tutorial-cian-medium',
  },
  {
    id: '5.2',
    section: 5,
    title: 'El tanque (2/6)',
    paragraphs: [
      'Al seleccionar una unidad con disparo a distancia, se indican mediante círculos rojos las casillas a las que puede disparar.',
      'Al seleccionar una casilla de desplazamiento, los círculos rojos se desplazan para mostrar la nueva zona de disparo de la unidad si se confirma el desplazamiento.',
    ],
    instruction: 'Selecciona la casilla indicada para desplazar al tanque hacia el norte.',
    interaction: 'prepare',
    pieceId: 'tutorial-cian-medium',
    target: hex(0, -1),
    autoSelect: true,
    direction: NORTH_EAST,
  },
  {
    id: '5.3',
    section: 5,
    title: 'El tanque (3/6)',
    paragraphs: [
      'El tanque puede cambiar la orientación de su cañón y desplazarse en el mismo turno.',
      'Para ello, una vez seleccionada la casilla de desplazamiento, selecciona la nueva orientación del cañón en la brújula del panel de mando.',
    ],
    instruction:
      'Cambia la orientación del cañón al noreste (NE) y confirma la acción para completar el desplazamiento.',
    interaction: 'action',
    pieceId: 'tutorial-cian-medium',
    target: hex(0, -1),
    autoSelect: true,
    direction: NORTH_EAST,
  },
  {
    id: '5.4',
    section: 5,
    title: 'El tanque (4/6)',
    paragraphs: [
      'Ahora, un soldado enemigo está dentro de la zona de disparo de tu tanque. Al seleccionar al tanque, una cruz roja indicará que puedes dispararle desde su posición.',
    ],
    instruction: 'Selecciona a tu tanque y dispara al soldado enemigo para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-medium',
    target: hex(-2, 1),
  },
  {
    id: '5.5',
    section: 5,
    title: 'El tanque (5/6)',
    paragraphs: [
      'El tanque también puede cambiar la orientación de su cañón sin desplazarse, pero esto consume su turno. Para hacerlo, utiliza el botón «Orientar cañón» del panel de mando.',
    ],
    instruction: 'Selecciona al tanque y cambia la orientación de su cañón hacia el norte (N).',
    interaction: 'action',
    pieceId: 'tutorial-cian-medium',
    mode: 'orient',
    direction: NORTH,
  },
  {
    id: '5.6',
    section: 5,
    title: 'El tanque (6/6)',
    paragraphs: [
      'El tanque puede ser abandonado para convertirse en soldado. El soldado que aparece al abandonar un vehículo puede elegir su orientación y realizar una acción inmediatamente.',
      'Para hacerlo, utiliza el botón «Abandonar vehículo» del panel de mando, elige la orientación del soldado y ejecuta la acción.',
    ],
    instruction: 'Selecciona al tanque, abandónalo y ataca al soldado enemigo para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-medium',
    target: hex(0, 0),
    mode: 'transform',
    direction: NORTH,
  },
  {
    id: '6.1',
    section: 6,
    title: 'El lanzamisiles (1/4)',
    paragraphs: [
      'Este es un lanzamisiles.',
      'Puede desplazarse a cualquiera de las seis casillas que lo rodean y disparar a cualquier casilla situada a tres hexágonos de distancia.',
      'Solo tiene dos misiles, por lo que puede disparar un máximo de dos veces durante la partida.',
    ],
    instruction:
      'Selecciona la casilla indicada y desplaza al lanzamisiles hacia el norte para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-long',
    target: hex(-2, 0),
  },
  {
    id: '6.2',
    section: 6,
    title: 'El lanzamisiles (2/4)',
    paragraphs: [
      'Ahora, el tanque enemigo está dentro de la zona de disparo de tu lanzamisiles. Al seleccionarlo, una cruz roja indicará que puedes dispararle desde su posición.',
    ],
    instruction: 'Selecciona al lanzamisiles y dispara al tanque enemigo para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-long',
    target: hex(-1, 2),
  },
  {
    id: '6.3',
    section: 6,
    title: 'El lanzamisiles (3/4)',
    paragraphs: [
      'Has gastado un misil, pero todavía te queda otro con el que puedes disparar al embestidor enemigo, que ahora está dentro de tu zona de disparo.',
    ],
    instruction: 'Selecciona al lanzamisiles y dispara al embestidor enemigo para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-long',
    target: hex(1, -3),
  },
  {
    id: '6.4',
    section: 6,
    title: 'El lanzamisiles (4/4)',
    paragraphs: [
      'Ahora ya no te quedan misiles.',
      'Cuando el lanzamisiles se queda sin misiles, puede seguir desplazándose con normalidad, pero ya no puede disparar. Sin embargo, al igual que el tanque, puede ser abandonado en cualquier momento para convertirse en soldado, incluso después de quedarse sin misiles.',
    ],
    instruction: 'Selecciona al lanzamisiles y abandónalo desplazándote hacia el noreste (NE).',
    interaction: 'action',
    pieceId: 'tutorial-cian-long',
    target: hex(-3, 1),
    mode: 'transform',
    direction: NORTH_EAST,
  },
  {
    id: '7.1',
    section: 7,
    title: 'El embestidor (1/2)',
    paragraphs: [
      'Este es un embestidor.',
      'Puede desplazarse en cualquier dirección y recorrer tantos hexágonos como quiera, siempre que el camino esté libre.',
    ],
    instruction:
      'Selecciona al embestidor y ataca al soldado enemigo en un solo movimiento, desplazándote hasta su casilla.',
    interaction: 'action',
    pieceId: 'tutorial-cian-fast',
    target: hex(-4, 3),
  },
  {
    id: '7.2',
    section: 7,
    title: 'El embestidor (2/2)',
    paragraphs: [
      'El embestidor, al igual que el tanque y el lanzamisiles, puede ser abandonado para convertirse en soldado.',
    ],
    instruction: 'Selecciona al embestidor y abandónalo desplazándote hacia el noroeste (NO).',
    interaction: 'action',
    pieceId: 'tutorial-cian-fast',
    target: hex(-3, 3),
    mode: 'transform',
    direction: NORTH_WEST,
  },
  {
    id: '8.1',
    section: 8,
    title: 'El dron (1/2)',
    paragraphs: [
      'Este es un dron.',
      'Puede desplazarse hasta tres hexágonos en cualquier dirección y sobrevolar otras unidades, excepto drones y aviones.',
    ],
    instruction:
      'Selecciona la casilla indicada y desplaza al dron hacia el noroeste para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-drone',
    target: hex(3, -5),
  },
  {
    id: '8.2',
    section: 8,
    title: 'El dron (2/2)',
    paragraphs: [
      'Ahora, el dron enemigo está dentro de la zona de ataque de tu dron. Al seleccionarlo, un punto rojo indicará que puedes atacarlo desplazándote hasta su casilla.',
    ],
    instruction: 'Selecciona a tu dron y ataca al dron enemigo desplazándote hasta su casilla.',
    interaction: 'action',
    pieceId: 'tutorial-cian-drone',
    target: hex(3, -2),
  },
  {
    id: '9.1',
    section: 9,
    title: 'El avión (1/4)',
    paragraphs: [
      'Este es un avión.',
      'Puede desplazarse hasta dos hexágonos hacia delante y sobrevolar otras unidades, excepto drones y aviones. También puede disparar a distancia a un total de ocho casillas.',
    ],
    instruction: 'Selecciona la casilla indicada para continuar.',
    interaction: 'select',
    pieceId: 'tutorial-cian-airplane',
  },
  {
    id: '9.2',
    section: 9,
    title: 'El avión (2/4)',
    paragraphs: [
      'La casilla indicada con un punto verde rodeado en rojo puede alcanzarse mediante un disparo o un desplazamiento, pero no permite realizar ambas acciones en el mismo turno.',
    ],
    instruction:
      'Selecciona la casilla indicada y desplaza al avión dos casillas hacia el norte para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-airplane',
    target: hex(-2, -1),
    autoSelect: true,
  },
  {
    id: '9.3',
    section: 9,
    title: 'El avión (3/4)',
    paragraphs: [
      'Ahora, el dron enemigo está dentro de la zona de disparo de tu avión. Al seleccionarlo, una cruz roja indicará que puedes dispararle desde su posición.',
    ],
    instruction: 'Selecciona a tu avión y dispara al dron enemigo para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-airplane',
    target: hex(-3, 1),
  },
  {
    id: '9.4',
    section: 9,
    title: 'El avión (4/4)',
    paragraphs: [
      'El avión también puede realizar un ataque kamikaze. Para ello, se desplaza hasta la casilla ocupada por una unidad enemiga. El avión y la unidad enemiga son destruidos.',
    ],
    instruction:
      'Selecciona a tu avión y realiza un ataque kamikaze contra el embestidor enemigo para continuar.',
    interaction: 'action',
    pieceId: 'tutorial-cian-airplane',
    target: hex(-1, -1),
  },
  {
    id: '10.1',
    section: 10,
    title: 'Ataques sobre casillas compartidas (1/5)',
    paragraphs: [
      'Cada casilla tiene dos capas: suelo y aire.',
      'Una misma casilla puede contener a la vez una unidad terrestre y una unidad aérea, pero nunca dos unidades en la misma capa.',
    ],
    instruction: 'Selecciona la casilla indicada para inspeccionarla.',
    interaction: 'inspect',
    target: hex(3, -1),
  },
  {
    id: '10.2',
    section: 10,
    title: 'Ataques sobre casillas compartidas (2/5)',
    paragraphs: [
      'El panel de mando indica que la casilla seleccionada contiene un dron y un soldado enemigos.',
      'Cuando dos unidades enemigas comparten una misma casilla y esta puede ser atacada por una unidad aliada, solo puede atacarse una de las dos unidades en cada acción. En ningún caso un mismo ataque puede destruir o afectar a ambas unidades.',
    ],
    instruction: 'Pulsa «Siguiente» para continuar.',
    interaction: 'next',
    target: hex(3, -1),
  },
  {
    id: '10.3',
    section: 10,
    title: 'Ataques sobre casillas compartidas (3/5)',
    paragraphs: [
      'Las unidades terrestres cuyo ataque implica ocupar la casilla enemiga —soldado y embestidor— solo pueden atacar a la unidad terrestre situada debajo de un dron o avión enemigo.',
      'Del mismo modo, el capturador solo puede capturar a la unidad terrestre situada debajo de un dron o avión enemigo.',
    ],
    instruction:
      'Elige al soldado, embestidor o capturador para atacar o capturar al soldado enemigo situado en la casilla indicada.',
    interaction: 'action',
    target: hex(3, -1),
    guided: false,
  },
  {
    id: '10.4',
    section: 10,
    title: 'Ataques sobre casillas compartidas (4/5)',
    paragraphs: [
      'Cuando el ataque sobre una casilla compartida lo realiza un dron, este solo puede atacar a la unidad aérea enemiga situada sobre la unidad terrestre.',
    ],
    instruction: 'Elige al dron para atacar al avión enemigo situado en la casilla indicada.',
    interaction: 'action',
    pieceId: 'tutorial-cian-drone',
    target: hex(0, 0),
    guided: false,
  },
  {
    id: '10.5',
    section: 10,
    title: 'Ataques sobre casillas compartidas (5/5)',
    paragraphs: [
      'Por último, las unidades que realizan sus ataques a distancia —tanque, lanzamisiles y avión— pueden elegir cuál de las dos unidades enemigas atacar, pero no pueden atacar a ambas en el mismo turno.',
    ],
    instruction:
      'Elige al tanque, lanzamisiles o avión para atacar a cualquiera de las dos unidades situadas en la casilla indicada.',
    interaction: 'action',
    target: hex(-3, 2),
    guided: false,
  },
  {
    id: '11.1',
    section: 11,
    title: 'Ataques entre unidades situadas en la misma casilla (1/2)',
    paragraphs: [
      'En la casilla señalada, un dron aliado ha quedado situado sobre una unidad terrestre enemiga tras atacar al avión enemigo que estaba situado encima.',
      'En esta situación, en el siguiente turno el dron puede atacar a la unidad terrestre inferior. Un avión, en cambio, no puede atacar a una unidad terrestre inferior.',
    ],
    instruction:
      'Selecciona al dron situado en la casilla señalada y ataca a la unidad terrestre inferior.',
    interaction: 'action',
    pieceId: 'tutorial-cian-drone',
    target: hex(0, 0),
  },
  {
    id: '11.2',
    section: 11,
    title: 'Ataques entre unidades situadas en la misma casilla (2/2)',
    paragraphs: [
      'En la casilla señalada, una unidad terrestre aliada ha quedado situada bajo un dron enemigo tras atacar o capturar al soldado enemigo que estaba bajo el dron.',
      'En esta situación, en el siguiente turno la unidad terrestre aliada puede atacar o capturar a la aeronave superior, tanto si es un dron como si es un avión.',
      'El soldado, el embestidor y el capturador pueden realizar el ataque o la captura directamente. En cambio, el tanque y el lanzamisiles no pueden atacar directamente a la aeronave superior, pero pueden ser abandonados para convertirse en soldados y realizar el ataque como tales en el mismo turno.',
    ],
    instruction:
      'Elige a la unidad terrestre situada en la casilla señalada y ataca a la aeronave superior.',
    interaction: 'action',
    target: hex(3, -1),
  },
  {
    id: '12.1',
    section: 12,
    title: 'Destruir el escudo antiaéreo (1/4)',
    paragraphs: [
      'Estás muy cerca de ganar la partida, pero la fortaleza enemiga está protegida por el escudo antiaéreo enemigo.',
    ],
    instruction: 'Selecciona al avión para continuar.',
    interaction: 'select',
    pieceId: 'tutorial-cian-airplane',
  },
  {
    id: '12.2',
    section: 12,
    title: 'Destruir el escudo antiaéreo (2/4)',
    paragraphs: [
      'Las casillas marcadas en ámbar están protegidas por el escudo antiaéreo. No es posible disparar a ninguna de estas casillas, aunque se encuentren dentro del área de disparo de una unidad aliada, como ocurre en este caso con el avión.',
    ],
    instruction: 'Selecciona al dron para continuar.',
    interaction: 'select',
    pieceId: 'tutorial-cian-drone',
    selectedId: 'tutorial-cian-airplane',
    guided: false,
    autoSelect: true,
    cue: 'piece',
  },
  {
    id: '12.3',
    section: 12,
    title: 'Destruir el escudo antiaéreo (3/4)',
    paragraphs: [
      'Al seleccionar al dron, una señal indica que, si atraviesa la zona protegida por el escudo antiaéreo, será interceptado. El dron tampoco puede destruir el escudo antiaéreo.',
    ],
    instruction:
      'Desplaza al dron a la casilla señalada para que sea interceptado por el escudo antiaéreo enemigo.',
    interaction: 'action',
    pieceId: 'tutorial-cian-drone',
    target: hex(0, 5),
    autoSelect: true,
    guided: false,
    cue: 'target',
  },
  {
    id: '12.4',
    section: 12,
    title: 'Destruir el escudo antiaéreo (4/4)',
    paragraphs: [
      'Por lo tanto, el escudo antiaéreo enemigo solo puede ser destruido mediante un ataque terrestre de un soldado o un embestidor, o capturado por un capturador.',
      'Destruir el escudo antiaéreo enemigo permite atacar la fortaleza enemiga con cualquier unidad, aunque no es imprescindible para ganar la partida.',
    ],
    instruction: 'Selecciona al embestidor y desplázalo hasta el escudo antiaéreo para destruirlo.',
    interaction: 'action',
    pieceId: 'tutorial-cian-fast',
    guided: false,
    cue: 'piece',
  },
  {
    id: '13.1',
    section: 13,
    title: 'Destruir la fortaleza enemiga (1/2)',
    paragraphs: [
      'Cuando la fortaleza recibe un ataque, pierde un punto de vida. Sin embargo, si el ataque lo realiza un soldado, un capturador o un embestidor, la unidad atacante es sacrificada tras realizar el ataque.',
      'El capturador no puede capturar la fortaleza enemiga; solo puede atacarla.',
    ],
    instruction:
      'Selecciona al embestidor y desplázalo hasta la fortaleza para quitarle un punto de vida.',
    interaction: 'action',
    pieceId: 'tutorial-cian-fast',
    guided: false,
  },
  {
    id: '13.2',
    section: 13,
    title: 'Destruir la fortaleza enemiga (2/2)',
    paragraphs: [
      'Ahora la fortaleza enemiga solo tiene un punto de vida. Al no haber escudo antiaéreo, puedes atacarla con el avión, ya sea mediante un disparo o un ataque kamikaze.',
    ],
    instruction: 'Selecciona al avión y destruye la fortaleza enemiga.',
    interaction: 'action',
    pieceId: 'tutorial-cian-airplane',
    guided: false,
  },
  {
    id: '14.1',
    section: 14,
    title: 'Práctica libre',
    paragraphs: [
      '¡Enhorabuena! Has destruido por completo la fortaleza enemiga.',
      'Ahora puedes practicar libremente con las unidades que hay sobre el tablero. Las unidades enemigas no te atacarán ni se moverán.',
      'Siéntete libre de destruir todas las que quieras.',
    ],
    instruction: 'El tutorial finalizará cuando destruyas por completo la fortaleza enemiga.',
    interaction: 'free',
    guided: false,
  },
];

function defenses(): Piece[] {
  return [
    { id: 'tutorial-cian-fortress', type: 'fortress', owner: 0, position: hex(0, -4), hp: 2 },
    { id: 'tutorial-cian-antiAir', type: 'antiAir', owner: 0, position: hex(0, -5) },
    { id: 'tutorial-amber-fortress', type: 'fortress', owner: 1, position: hex(0, 4), hp: 2 },
    { id: 'tutorial-amber-antiAir', type: 'antiAir', owner: 1, position: hex(0, 5) },
  ];
}

function initialScene(): GameState {
  return createGameState([
    ...defenses(),
    { id: 'tutorial-cian-soldier', type: 'soldier', owner: 0, position: hex(4, -4), facing: NORTH },
    { id: 'tutorial-cian-capturer', type: 'capturer', owner: 0, position: hex(2, -3) },
    { id: 'tutorial-cian-medium', type: 'medium', owner: 0, position: hex(0, -2), cannon: NORTH },
    {
      id: 'tutorial-cian-long',
      type: 'long',
      owner: 0,
      position: hex(-2, -1),
      missilesRemaining: 2,
    },
    { id: 'tutorial-cian-fast', type: 'fast', owner: 0, position: hex(-4, 0) },
    { id: 'tutorial-cian-drone', type: 'drone', owner: 0, position: hex(2, -5) },
    {
      id: 'tutorial-cian-airplane',
      type: 'airplane',
      owner: 0,
      position: hex(-2, -3),
      facing: NORTH,
    },
    ...[4, 2, 0, -2, -4].map((q): Piece => ({
      id: `tutorial-amber-soldier-${q}`,
      type: 'soldier',
      owner: 1,
      position: hex(q, 1 - q / 2),
      facing: 0,
    })),
    { id: 'tutorial-amber-drone-left', type: 'drone', owner: 1, position: hex(3, 1) },
    { id: 'tutorial-amber-fast-left', type: 'fast', owner: 1, position: hex(1, 2) },
    { id: 'tutorial-amber-medium', type: 'medium', owner: 1, position: hex(0, 2), cannon: 0 },
    { id: 'tutorial-amber-fast-right', type: 'fast', owner: 1, position: hex(-1, 3) },
    { id: 'tutorial-amber-drone-right', type: 'drone', owner: 1, position: hex(-3, 4) },
  ]);
}

function sharedScene(): GameState {
  return createGameState([
    ...defenses(),
    { id: 'tutorial-cian-soldier', type: 'soldier', owner: 0, position: hex(4, -2), facing: NORTH },
    { id: 'tutorial-cian-capturer', type: 'capturer', owner: 0, position: hex(2, -1) },
    { id: 'tutorial-cian-fast', type: 'fast', owner: 0, position: hex(3, -3) },
    { id: 'tutorial-cian-drone', type: 'drone', owner: 0, position: hex(0, -2) },
    { id: 'tutorial-cian-medium', type: 'medium', owner: 0, position: hex(-3, 0), cannon: NORTH },
    {
      id: 'tutorial-cian-long',
      type: 'long',
      owner: 0,
      position: hex(-2, -1),
      missilesRemaining: 2,
    },
    {
      id: 'tutorial-cian-airplane',
      type: 'airplane',
      owner: 0,
      position: hex(-4, 0),
      facing: NORTH,
    },
    {
      id: 'tutorial-shared-ground-left',
      type: 'soldier',
      owner: 1,
      position: hex(3, -1),
      facing: 0,
    },
    { id: 'tutorial-shared-air-left', type: 'drone', owner: 1, position: hex(3, -1) },
    {
      id: 'tutorial-shared-ground-center',
      type: 'medium',
      owner: 1,
      position: hex(0, 0),
      cannon: 0,
    },
    {
      id: 'tutorial-shared-air-center',
      type: 'airplane',
      owner: 1,
      position: hex(0, 0),
      facing: 0,
    },
    {
      id: 'tutorial-shared-ground-right',
      type: 'soldier',
      owner: 1,
      position: hex(-3, 2),
      facing: 0,
    },
    { id: 'tutorial-shared-air-right', type: 'drone', owner: 1, position: hex(-3, 2) },
  ]);
}

function siegeScene(): GameState {
  return createGameState([
    ...defenses(),
    { id: 'tutorial-cian-drone', type: 'drone', owner: 0, position: hex(3, 2) },
    {
      id: 'tutorial-cian-airplane',
      type: 'airplane',
      owner: 0,
      position: hex(0, 2),
      facing: NORTH,
    },
    { id: 'tutorial-cian-fast', type: 'fast', owner: 0, position: hex(-3, 5) },
  ]);
}

const ACTION_KINDS: Record<string, GameAction['kind'][]> = {
  '3.2': ['move'],
  '3.3': ['move'],
  '3.4': ['move'],
  '3.5': ['rotate'],
  '4.1': ['move'],
  '4.2': ['convert'],
  '5.2': ['move'],
  '5.3': ['move'],
  '5.4': ['shoot'],
  '5.5': ['orient'],
  '5.6': ['transform'],
  '6.1': ['move'],
  '6.2': ['shoot'],
  '6.3': ['shoot'],
  '6.4': ['transform'],
  '7.1': ['move'],
  '7.2': ['transform'],
  '8.1': ['move'],
  '8.2': ['move'],
  '9.2': ['move'],
  '9.3': ['shoot'],
  '9.4': ['move'],
  '10.3': ['move', 'convert'],
  '10.4': ['move'],
  '10.5': ['shoot'],
  '11.1': ['attackBelow'],
  '11.2': ['attackAbove', 'convert'],
  '12.3': ['move'],
  '12.4': ['move'],
  '13.1': ['move'],
  '13.2': ['shoot', 'move'],
};

/** Returns canonical engine actions, narrowed to the current exercise. */
export function getTutorialActions(state: GameState, stepIndex: number): GameAction[] {
  const step = TUTORIAL_STEPS[stepIndex];
  if (!step || state.outcome || state.activePlayer !== 0) return [];
  if (!['action', 'prepare', 'free'].includes(step.interaction)) return [];
  const actions = state.pieces
    .filter((piece) => piece.owner === 0 && (!step.pieceId || piece.id === step.pieceId))
    .flatMap((piece) => getLegalActionsForPiece(state, piece.id));
  if (step.interaction === 'free') return actions;
  // The engine terminates aircraft movement at the first protected cell. The
  // lesson still points to the intended destination behind that interception.
  const target =
    step.id === '12.3'
      ? hex(1, 4)
      : (step.target ??
        (step.id === '12.4' ? hex(0, 5) : step.section === 13 ? hex(0, 4) : undefined));
  return actions.filter((action) => {
    if (!ACTION_KINDS[step.id]?.includes(action.kind)) return false;
    if (target) {
      const destination = actionDestination(state, action);
      if (!destination || !equalHex(destination, target)) return false;
    }
    if (step.direction !== undefined) {
      const direction =
        'facing' in action ? action.facing : 'cannon' in action ? action.cannon : undefined;
      if (direction !== step.direction) return false;
    }
    if (step.id === '9.4') return action.kind === 'move' && action.kamikaze === true;
    if (step.id === '13.2')
      return action.kind === 'shoot' || (action.kind === 'move' && action.kamikaze === true);
    if (step.id === '10.3') {
      const actor = state.pieces.find((piece) => piece.id === action.pieceId);
      return (
        !!actor &&
        ['soldier', 'fast', 'capturer'].includes(actor.type) &&
        (action.kind !== 'convert' || action.targetId === 'tutorial-shared-ground-left')
      );
    }
    if (step.id === '10.5') {
      const actor = state.pieces.find((piece) => piece.id === action.pieceId);
      return (
        !!actor && ['medium', 'long', 'airplane'].includes(actor.type) && action.kind === 'shoot'
      );
    }
    if (step.id === '11.2') return occupancyAt(state, hex(3, -1)).ground?.id === action.pieceId;
    return true;
  });
}

const REPLIES: Record<string, { pieceId: string; to: Hex }> = {
  '3.3': { pieceId: 'tutorial-amber-soldier-4', to: hex(4, -2) },
  '4.1': { pieceId: 'tutorial-amber-soldier-2', to: hex(2, -1) },
  '4.2': { pieceId: 'tutorial-amber-soldier--2', to: hex(-2, 1) },
  '5.5': { pieceId: 'tutorial-amber-soldier-0', to: hex(0, 0) },
  '6.1': { pieceId: 'tutorial-amber-medium', to: hex(-1, 2) },
  '6.2': { pieceId: 'tutorial-amber-fast-left', to: hex(1, -3) },
  '8.1': { pieceId: 'tutorial-amber-drone-left', to: hex(3, -2) },
  '9.2': { pieceId: 'tutorial-amber-drone-right', to: hex(-3, 1) },
  '9.3': { pieceId: 'tutorial-amber-fast-right', to: hex(-1, -1) },
};

/** The only Amber action authorized after this exercise has been completed. */
export function getTutorialReply(state: GameState, stepIndex: number): GameAction | null {
  const step = TUTORIAL_STEPS[stepIndex];
  const reply = step && REPLIES[step.id];
  if (!reply || state.outcome) return null;
  return (
    getLegalActionsForPiece({ ...state, activePlayer: 1 }, reply.pieceId).find(
      (action) =>
        action.kind === 'move' &&
        equalHex(action.to, reply.to) &&
        (action.cannon === undefined || action.cannon === 0),
    ) ?? null
  );
}

function resolve(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action, { repetition: null, noProgressPlyLimit: null });
  if (!result.ok)
    throw new Error(`Acción de tutorial inválida: ${actionKey(action)}. ${result.error ?? ''}`);
  return result.state;
}

export interface TutorialCheckpoint {
  state: GameState;
  selectedId: string | null;
  pendingAction: GameAction | null;
}

/** Replays the canonical route; calls never share mutable game state. */
export function createTutorialCheckpoint(index: number): TutorialCheckpoint {
  if (!Number.isInteger(index) || index < 0 || index >= TUTORIAL_STEPS.length) {
    throw new RangeError('Paso de tutorial fuera de rango.');
  }
  let state = initialScene();
  for (let cursor = 0; cursor <= index; cursor += 1) {
    const step = TUTORIAL_STEPS[cursor];
    if (step.id === '10.1') state = sharedScene();
    if (step.id === '12.1') state = siegeScene();
    if (step.id === '14.1') state = initialScene();
    state = { ...state, activePlayer: 0 };
    if (cursor === index) break;
    if (step.interaction !== 'action') continue;
    const action = getTutorialActions(state, cursor)[0];
    if (!action) throw new Error(`El paso ${step.id} no tiene ninguna acción legal.`);
    state = resolve(state, action);
    const reply = getTutorialReply(state, cursor);
    if (REPLIES[step.id] && !reply)
      throw new Error(`La respuesta del paso ${step.id} no es legal.`);
    if (reply) state = resolve({ ...state, activePlayer: 1 }, reply);
  }
  const step = TUTORIAL_STEPS[index];
  const selectedId = step.selectedId ?? (step.autoSelect ? (step.pieceId ?? null) : null);
  let pendingAction: GameAction | null = null;
  if (step.id === '3.3') pendingAction = getTutorialActions(state, index)[0] ?? null;
  if (step.id === '5.3' && step.pieceId && step.target) {
    pendingAction =
      getLegalActionsForPiece(state, step.pieceId).find(
        (action) =>
          action.kind === 'move' && equalHex(action.to, step.target!) && action.cannon === NORTH,
      ) ?? null;
  }
  return { state, selectedId, pendingAction };
}

/** Navigation skips the remaining exercises in a section, as in the manual. */
export function nextTutorialSection(index: number, delta: 1 | -1): number {
  const safeIndex = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, index));
  const section = TUTORIAL_STEPS[safeIndex].section;
  const nextSection = Math.max(0, Math.min(14, section + delta));
  return TUTORIAL_STEPS.findIndex((step) => step.section === nextSection);
}
