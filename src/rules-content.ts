import type { RuleDemoId } from './rules-demo';

export interface RuleMedia {
  src: string;
  alt: string;
}

export interface RuleParagraph {
  text: string;
  strong?: string[];
  kind?: 'paragraph' | 'heading';
}

export interface RuleSection {
  id: string;
  label: string;
  title: string;
  paragraphs: Array<string | RuleParagraph>;
  demo?: RuleDemoId;
  media?: RuleMedia[];
}

function emphasize(text: string, ...strong: string[]): RuleParagraph {
  return { text, strong };
}

function peerHeading(text: string): RuleParagraph {
  return { text, kind: 'heading' };
}

export const RULE_SECTIONS: RuleSection[] = [
  {
    id: 'descripcion',
    label: 'DESCRIPCIÓN DEL JUEGO',
    title: 'Descripción del juego',
    paragraphs: [
      'Protocolo Hexagonal es un juego de estrategia para dos jugadores en el que cada uno dirige un ejército con el objetivo de destruir la fortaleza enemiga.',
      'Cada jugador dispone de un conjunto de unidades con habilidades y funciones muy diferentes. La victoria dependerá de saber combinarlas, proteger las más valiosas y aprovechar las debilidades del rival.',
      'Los jugadores realizan sus turnos de forma alterna. En cada turno, el jugador activo podrá realizar una única acción con una de sus unidades, como desplazarse, atacar, disparar, girarse o utilizar una habilidad especial, según las características de dicha unidad.',
    ],
  },
  {
    id: 'fortaleza',
    label: 'FORTALEZA Y ESCUDO ANTIAÉREO',
    title: 'Fortaleza',
    paragraphs: [
      emphasize(
        'El objetivo del juego es destruir la fortaleza rival.',
        'destruir la fortaleza rival.',
      ),
      'La fortaleza no puede desplazarse, atacar ni defenderse.',
      'Puede tener 1, 2 o 3 puntos de vida, según la configuración de la partida. Cuando sus puntos de vida llegan a cero, la fortaleza es destruida y su propietario pierde la partida.',
      peerHeading('Escudo antiaéreo'),
      emphasize(
        'El escudo antiaéreo, situado justo detrás de la fortaleza, protege las seis casillas que lo rodean y la propia casilla que ocupa frente a cualquier ataque aéreo.',
        'protege las seis casillas que lo rodean y la propia casilla que ocupa',
      ),
      emphasize(
        'Los drones y aviones no pueden desplazarse sobre ninguna de las casillas protegidas por el escudo antiaéreo. Si lo hacen, son destruidos inmediatamente.',
        'son destruidos inmediatamente',
      ),
      'El tanque, el lanzamisiles y el avión no pueden realizar ataques a distancia contra ninguna de las casillas protegidas por el escudo antiaéreo. Éste solo puede ser destruido por un soldado o un embestidor, o capturado por un capturador.',
      'El escudo antiaéreo no puede desplazarse.',
    ],
    demo: 'fortaleza',
  },
  {
    id: 'soldado',
    label: 'SOLDADO',
    title: 'Soldado',
    paragraphs: [
      emphasize(
        'El soldado puede desplazarse a cualquiera de las tres casillas situadas delante de él. Si se desplaza en diagonal, su orientación cambia automáticamente.',
        'desplazarse',
      ),
      emphasize(
        'El soldado puede atacar a cualquier unidad enemiga situada dentro de su área de desplazamiento. Al hacerlo, la unidad enemiga es eliminada y el soldado pasa a ocupar su casilla.',
        'atacar',
      ),
      emphasize(
        'El soldado también puede cambiar su orientación sin desplazarse. No obstante, si lo hace, no podrá desplazarse ni atacar durante ese turno.',
        'cambiar su orientación sin desplazarse',
      ),
    ],
    demo: 'soldado',
  },
  {
    id: 'capturador',
    label: 'CAPTURADOR',
    title: 'Capturador',
    paragraphs: [
      emphasize(
        'El capturador puede desplazarse a cualquiera de las seis casillas situadas a su alrededor.',
        'desplazarse',
      ),
      emphasize(
        'El capturador puede capturar a cualquier unidad enemiga situada dentro de su área de desplazamiento. Al hacerlo, la unidad enemiga se convierte automáticamente en aliada. El capturador y la unidad capturada permanecen en sus respectivas casillas.',
        'capturar',
      ),
      'Si una unidad está en contacto simultáneamente con un capturador aliado y uno enemigo, no puede ser capturada.',
      'El capturador no puede capturar la fortaleza, pero sí puede atacarla desplazándose hasta ella.',
    ],
    demo: 'capturador',
  },
  {
    id: 'tanque',
    label: 'TANQUE',
    title: 'Tanque',
    paragraphs: [
      emphasize(
        'El tanque puede desplazarse a cualquiera de las seis casillas situadas a su alrededor y orientar su cañón en cualquiera de las seis direcciones posibles. La orientación del cañón es independiente de la dirección del desplazamiento.',
        'desplazarse',
        'orientar su cañón',
      ),
      'El tanque puede desplazarse y cambiar la orientación de su cañón en el mismo turno, o cambiar únicamente la orientación de su cañón sin desplazarse.',
      emphasize(
        'El tanque puede disparar a las tres casillas situadas dos casillas por delante de su cañón. Si dispara, no podrá desplazarse ni cambiar la orientación de su cañón durante ese turno. Del mismo modo, no podrá disparar después de haberse desplazado o de haber cambiado la orientación de su cañón durante ese turno.',
        'disparar',
      ),
      emphasize(
        'El tanque puede ser abandonado para convertirse en un soldado. El soldado que lo sustituya puede elegir libremente su orientación y realizar su acción en ese mismo turno.',
        'abandonado',
        'realizar su acción en ese mismo turno',
      ),
    ],
    demo: 'tanque',
  },
  {
    id: 'lanzamisiles',
    label: 'LANZAMISILES',
    title: 'Lanzamisiles',
    paragraphs: [
      emphasize(
        'El lanzamisiles puede desplazarse a cualquiera de las seis casillas situadas a su alrededor.',
        'desplazarse',
      ),
      emphasize(
        'El lanzamisiles puede disparar a cualquier casilla situada exactamente a tres casillas de su posición, en cualquier dirección. Debe elegir entre desplazarse o disparar, por lo que no puede realizar ambas acciones en el mismo turno.',
        'disparar',
      ),
      emphasize(
        'El lanzamisiles puede ser abandonado para convertirse en un soldado. El soldado que lo sustituya puede elegir libremente su orientación y realizar su acción en ese mismo turno.',
        'abandonado',
        'realizar su acción en ese mismo turno',
      ),
    ],
    demo: 'lanzamisiles',
  },
  {
    id: 'embestidor',
    label: 'EMBESTIDOR',
    title: 'Embestidor',
    paragraphs: [
      emphasize(
        'El embestidor puede desplazarse en cualquiera de las seis direcciones del tablero, sin límite de casillas, siempre que el trayecto esté despejado.',
        'desplazarse',
      ),
      emphasize(
        'El embestidor puede atacar a cualquier unidad enemiga situada dentro de su área de desplazamiento. Al hacerlo, la unidad enemiga es eliminada y el embestidor pasa a ocupar su casilla.',
        'atacar',
      ),
      emphasize(
        'El embestidor puede ser abandonado para convertirse en un soldado. El soldado que lo sustituya puede elegir libremente su orientación y realizar su acción en ese mismo turno.',
        'abandonado',
        'realizar su acción en ese mismo turno',
      ),
    ],
    demo: 'embestidor',
  },
  {
    id: 'dron',
    label: 'DRON',
    title: 'Dron',
    paragraphs: [
      emphasize(
        'El dron puede desplazarse en cualquiera de las seis direcciones del tablero, hasta un máximo de tres casillas. Al desplazarse por el aire, puede pasar por encima de unidades aliadas y enemigas, excepto de otros drones y aviones. También puede finalizar su desplazamiento en una casilla ocupada por una unidad aliada, excepto por un dron o un avión.',
        'desplazarse',
      ),
      emphasize(
        'El dron puede atacar a cualquier unidad enemiga situada dentro de su área de desplazamiento. Al hacerlo, la unidad enemiga es eliminada y el dron pasa a ocupar su casilla. El ataque solo puede realizarse en la casilla en la que finalice su desplazamiento, no durante el recorrido.',
        'atacar',
      ),
      'Las unidades terrestres pueden desplazarse por debajo de un dron aliado, pero no pueden hacerlo por debajo de un dron enemigo.',
    ],
    demo: 'dron',
  },
  {
    id: 'avion',
    label: 'AVIÓN',
    title: 'Avión',
    paragraphs: [
      emphasize(
        'El avión puede desplazarse hasta dos casillas hacia adelante. Si se desplaza en diagonal, su orientación cambia automáticamente.',
        'desplazarse',
      ),
      'Al desplazarse por el aire, puede pasar por encima de unidades aliadas y enemigas, excepto de otros drones y aviones. También puede finalizar su desplazamiento en una casilla ocupada por una unidad aliada o enemiga, excepto por un dron o un avión.',
      emphasize(
        'El avión puede disparar a un total de ocho casillas: las tres casillas situadas dos casillas por delante de él y las cinco casillas situadas tres casillas por delante. La casilla central de las tres situadas a dos casillas de distancia (indicada con un punto verde con el contorno rojo) también puede ser alcanzada mediante un desplazamiento. En cualquier caso, el avión debe elegir entre desplazarse o disparar, por lo que no puede realizar ambas acciones en el mismo turno, tampoco en dicha casilla.',
        'disparar',
      ),
      emphasize(
        'El avión también puede realizar un ataque kamikaze, desplazándose a una casilla ocupada por una unidad enemiga e impactando contra ella. En ese caso, tanto la unidad enemiga como el avión son destruidos.',
        'ataque kamikaze',
        'tanto la unidad enemiga como el avión son destruidos',
      ),
    ],
    demo: 'avion',
  },
  {
    id: 'desarrollo',
    label: 'DESARROLLO DE LA PARTIDA',
    title: 'Desarrollo de la partida',
    paragraphs: [
      emphasize(
        'Cada jugador comienza la partida con un ejército compuesto por 5 soldados, 1 capturador, 2 tanques, 2 lanzamisiles, 2 embestidores, 2 drones y 2 aviones, además de una fortaleza y un escudo antiaéreo. La disposición inicial de los ejércitos sobre el tablero es la que aparece en la imagen de la derecha.',
        '5 soldados, 1 capturador, 2 tanques, 2 lanzamisiles, 2 embestidores, 2 drones y 2 aviones',
      ),
      emphasize(
        'El jugador de color cian realiza el primer turno. Durante su turno, debe seleccionar una de sus unidades y realizar una acción, como desplazarse, atacar, disparar o cambiar su orientación, según las características de la unidad. A continuación, comienza el turno del jugador de color ámbar.',
        'cian',
        'ámbar',
      ),
      emphasize(
        'Los jugadores se turnan de forma alterna hasta que uno de ellos consigue destruir la fortaleza rival. Si se alcanza una situación en la que ninguno de los dos jugadores puede destruir por completo la fortaleza rival, la partida termina en tablas, aunque una de las fortalezas tenga menos puntos de vida que la otra. Los jugadores también pueden acordar tablas durante el desarrollo de la partida.',
        'tablas',
        'acordar tablas',
      ),
      emphasize(
        'Cada ataque que impacta contra la fortaleza reduce en un punto sus puntos de vida.',
        'reduce en un punto sus puntos de vida',
      ),
      'El soldado, el embestidor y el capturador son eliminados inmediatamente después de atacar la fortaleza, independientemente del número de puntos de vida que le queden. La partida continúa hasta que una de las fortalezas se queda sin puntos de vida.',
    ],
    media: [
      {
        src: '/rules/image22.png',
        alt: 'Disposición inicial completa de los ejércitos cian y ámbar sobre el tablero.',
      },
    ],
  },
  {
    id: 'casillas-compartidas',
    label: 'ATAQUES SOBRE CASILLAS COMPARTIDAS',
    title: 'Ataques sobre casillas compartidas',
    paragraphs: [
      emphasize(
        'Cuando dos unidades enemigas comparten una misma casilla y esta puede ser atacada por una unidad aliada, solo puede ser atacada una de las dos unidades en cada acción. En ningún caso un mismo ataque puede destruir o afectar a ambas unidades.',
        'solo puede ser atacada una de las dos unidades en cada acción',
      ),
      emphasize(
        'Las unidades terrestres cuyo ataque implica ocupar la casilla enemiga —soldado y embestidor— solo pueden atacar a la unidad terrestre situada debajo de un dron o avión enemigo. Tras el ataque, la unidad atacante queda situada debajo del dron o avión. Si queda debajo de un dron, este podrá atacarla en el siguiente turno.',
        'soldado y embestidor',
      ),
      emphasize(
        'Del mismo modo, el capturador solo puede capturar a la unidad terrestre situada debajo de un dron o avión enemigo. El capturador permanece en su casilla y la unidad capturada, que pasa a ser aliada, permanece debajo del dron o avión enemigo.',
        'capturador',
      ),
      emphasize(
        'En cambio, las unidades que realizan sus ataques a distancia —tanque, lanzamisiles y avión— pueden elegir cuál de las dos unidades enemigas atacar, pero no pueden atacar a ambas en el mismo turno. El avión también puede realizar un ataque kamikaze contra cualquiera de las dos unidades.',
        'tanque, lanzamisiles y avión',
      ),
      emphasize(
        'Por último, cuando el ataque lo realiza un dron, este solo puede atacar a la unidad aérea enemiga situada sobre la unidad terrestre. Tras el ataque, el dron queda situado sobre la unidad terrestre enemiga. Hay que tener en cuenta que, si la unidad terrestre situada debajo del dron es un soldado o un embestidor, estos podrán atacarlo. Del mismo modo, si se trata de un capturador, podrá capturarlo.',
        'dron',
      ),
      emphasize(
        'En cambio, el tanque y el lanzamisiles no pueden atacar directamente a un dron situado sobre ellos. Sin embargo, tanto el tanque como el lanzamisiles pueden ser abandonados para convertirse en soldados, lo que les permite igualmente atacar al dron en ese mismo turno.',
        'tanque y el lanzamisiles',
      ),
    ],
    demo: 'casillas-compartidas',
  },
  {
    id: 'indicadores',
    label: 'INDICADORES Y ACCIONES',
    title: 'Indicadores y acciones',
    paragraphs: [
      'Al seleccionar una unidad, el tablero muestra mediante distintos colores y símbolos las acciones que esta puede realizar:',
      emphasize(
        'Desplazamiento: las casillas a las que puede desplazarse se indican con un punto verde. Si una de estas casillas está ocupada por una unidad enemiga que puede ser atacada mediante desplazamiento, se indica con un punto rojo.',
        'Desplazamiento:',
        'punto verde',
        'punto rojo',
      ),
      emphasize(
        'Disparo: las casillas a las que puede disparar una unidad se indican mediante un contorno rojo. Si alguna de ellas está ocupada por una unidad enemiga que puede ser atacada, esta se señala con una X roja.',
        'Disparo:',
        'contorno rojo',
        'X roja',
      ),
      emphasize(
        'Captura: cuando un capturador tiene a su alrededor una unidad enemiga que puede capturar, esta se indica mediante una red del color del capturador. El color de la red indica el color que tendría la unidad capturada después de la captura.',
        'Captura:',
        'red del color del capturador',
      ),
      'Los mismos colores y símbolos se utilizan al seleccionar unidades propias y enemigas. Sin embargo, cuando se selecciona una unidad enemiga, los indicadores aparecen con una intensidad menor.',
      emphasize(
        'En las unidades que pueden realizar ataques a distancia, al seleccionar una casilla de desplazamiento, los contornos rojos se desplazan para mostrar las casillas a las que podría disparar la unidad desde la posición seleccionada. Estos indicadores muestran el posible alcance de disparo en el siguiente turno si se realiza el desplazamiento.',
        'contornos rojos se desplazan',
      ),
      emphasize(
        'Para deseleccionar una unidad, basta con hacer clic de nuevo sobre ella.',
        'deseleccionar una unidad',
      ),
      emphasize(
        'En la parte derecha de la pantalla aparece un panel de información que muestra las características de la unidad seleccionada y las acciones que puede realizar.',
        'panel de información',
      ),
      emphasize(
        'Al seleccionar una casilla de desplazamiento, ataque o captura, el panel muestra la opción de confirmar la acción. La acción no se llevará a cabo hasta que el jugador la confirme.',
        'confirmar la acción',
      ),
    ],
  },
];
