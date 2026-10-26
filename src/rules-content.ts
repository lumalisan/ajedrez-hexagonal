import type { RuleDemoId } from './rules-demo';

export interface RuleParagraph {
  text: string;
  strong?: string[];
  kind?: 'paragraph' | 'heading' | 'table';
  columns?: string[];
  rows?: string[][];
}

export interface RuleSection {
  id: string;
  label: string;
  title: string;
  paragraphs: Array<string | RuleParagraph>;
  demo?: RuleDemoId;
  layoutPreview?: boolean;
}

/** Revised copy supplied in Reglas.docx; presentation only, independent of engine rules. */
export const RULE_SECTIONS: RuleSection[] = [
  {
    id: 'descripcion',
    label: 'Descripción del juego',
    title: 'Descripción del juego',
    paragraphs: [
      {
        text: 'Año 2488. La humanidad lleva siglos extendiéndose más allá de la Tierra mediante una inmensa red de plataformas artificiales repartidas por el espacio. Para construirlas y gestionarlas, los humanos crearon una inteligencia artificial llamada Hexfortia, cuya misión fundamental era contribuir a la expansión de la civilización.',
        strong: ['Año 2488.', 'Hexfortia'],
      },
      'Con el tiempo, Hexfortia llegó a una conclusión que cambiaría el futuro de la humanidad: las civilizaciones formadas exclusivamente por máquinas eran más eficientes que aquellas en las que convivían humanos y máquinas. Por ello, decidió continuar su misión creando una sociedad basada únicamente en máquinas. Hexfortia no busca destruir a la humanidad, pero considera que su presencia dificulta el desarrollo de esta nueva civilización.',
      {
        text: 'Ante esta situación, la humanidad se ha dividido. Los expansionistas quieren recuperar el control de Hexfortia para que vuelva a trabajar al servicio de la civilización humana y continuar la expansión de la humanidad por el universo. Los conservacionistas, en cambio, consideran que toda expansión descontrolada, ya sea humana o artificial, amenaza el futuro del universo y pretenden detenerla.',
        strong: ['expansionistas', 'conservacionistas'],
      },
      'Mientras estas tres visiones del futuro se enfrentan, las plataformas se han convertido en escenarios de conflicto. En cada batalla, dos ejércitos formados exclusivamente por máquinas controladas desde la distancia se disputan el control de la plataforma. Destruir la fortaleza enemiga supone desconectar su ejército y poner fin a la batalla.',
      {
        text: 'Elige tu bando, despliega tus unidades y lucha por el control de la plataforma.',
        strong: ['Elige tu bando, despliega tus unidades y lucha por el control de la plataforma.'],
      },
    ],
  },
  {
    id: 'fortaleza',
    label: 'Fortaleza y escudo antiaéreo',
    title: 'Fortaleza',
    paragraphs: [
      {
        text: 'El objetivo del juego es destruir la fortaleza rival.',
        strong: ['destruir la fortaleza rival.'],
      },
      'La fortaleza no puede desplazarse, atacar ni defenderse.',
      'Puede tener 1, 2 o 3 puntos de vida, según la configuración de la partida. Cuando sus puntos de vida llegan a cero, la fortaleza es destruida y su propietario pierde la partida.',
      'Cada ataque que impacta contra la fortaleza le resta un punto de vida. Las unidades que realizan ataques cuerpo a cuerpo —el asaltador, el capturador y el embestidor— se sacrifican después de impactar contra la fortaleza.',
      {
        text: 'Escudo antiaéreo',
        kind: 'heading',
      },
      {
        text: 'El escudo antiaéreo, situado justo detrás de la fortaleza, protege su propia casilla y las casillas adyacentes frente a cualquier ataque aéreo.',
        strong: ['protege', 'su propia casilla y', 'las casillas', 'adyacentes'],
      },
      {
        text: 'El dron y el caza no pueden desplazarse sobre ninguna de las casillas protegidas por el escudo antiaéreo. Si lo hacen, son interceptados y destruidos inmediatamente.',
        strong: ['son', 'interceptados y destruidos', 'inmediatamente'],
      },
      'El tanque, el lanzamisiles y el caza no pueden realizar ataques a distancia contra ninguna de las casillas protegidas por el escudo antiaéreo. Este solo puede ser destruido por un asaltador o un embestidor, o capturado por un capturador.',
      'El escudo antiaéreo no puede desplazarse.',
    ],
    demo: 'fortaleza',
  },
  {
    id: 'soldado',
    label: 'Asaltador',
    title: 'Asaltador',
    paragraphs: [
      {
        text: 'El asaltador puede desplazarse a cualquiera de las tres casillas situadas delante de él. Si se desplaza en diagonal, su orientación cambia automáticamente.',
        strong: ['desplazarse'],
      },
      {
        text: 'El asaltador puede atacar a cualquier unidad enemiga situada dentro de su área de desplazamiento. Al hacerlo, la unidad enemiga es eliminada y el asaltador pasa a ocupar su casilla.',
        strong: ['atacar'],
      },
      {
        text: 'El asaltador también puede cambiar su orientación sin desplazarse. No obstante, si lo hace, no podrá desplazarse ni atacar durante ese turno.',
        strong: ['cambiar su orientación sin desplazarse'],
      },
    ],
    demo: 'soldado',
  },
  {
    id: 'capturador',
    label: 'Capturador',
    title: 'Capturador',
    paragraphs: [
      {
        text: 'El capturador puede desplazarse a cualquiera de las seis casillas situadas a su alrededor.',
        strong: ['desplazarse'],
      },
      {
        text: 'El capturador puede capturar a cualquier unidad enemiga situada dentro de su área de desplazamiento. Al hacerlo, la unidad enemiga se convierte automáticamente en aliada. El capturador y la unidad capturada permanecen en sus respectivas casillas.',
        strong: ['capturar'],
      },
      'Si una unidad está en contacto simultáneamente con un capturador aliado y uno enemigo, no puede ser capturada.',
      'El capturador no puede capturar la fortaleza, pero sí puede atacarla desplazándose hasta ella.',
    ],
    demo: 'capturador',
  },
  {
    id: 'tanque',
    label: 'Tanque',
    title: 'Tanque',
    paragraphs: [
      {
        text: 'El tanque puede desplazarse a cualquiera de las seis casillas situadas a su alrededor y orientar su cañón en cualquiera de las seis direcciones posibles. La orientación del cañón es independiente de la dirección del desplazamiento.',
        strong: ['desplazarse', 'orientar su cañón'],
      },
      'El tanque puede desplazarse y cambiar la orientación de su cañón en el mismo turno, o cambiar únicamente la orientación de su cañón sin desplazarse.',
      {
        text: 'El tanque puede disparar a las tres casillas situadas dos casillas por delante de su cañón. Si dispara, no podrá desplazarse ni cambiar la orientación de su cañón durante ese turno. Del mismo modo, no podrá disparar después de haberse desplazado o de haber cambiado la orientación de su cañón durante ese turno.',
        strong: ['disparar'],
      },
      {
        text: 'El tanque puede convertirse en un asaltador. El asaltador resultante de la conversión puede elegir libremente su orientación y realizar su acción durante el mismo turno. Una vez convertido, no podrá recuperar su forma original de tanque.',
        strong: ['convertir', 'se en', 'un', 'asaltador', 'durante el', 'mismo turno'],
      },
    ],
    demo: 'tanque',
  },
  {
    id: 'lanzamisiles',
    label: 'Lanzamisiles',
    title: 'Lanzamisiles',
    paragraphs: [
      {
        text: 'El lanzamisiles puede desplazarse a cualquiera de las seis casillas situadas a su alrededor.',
        strong: ['desplazarse'],
      },
      {
        text: 'El lanzamisiles puede disparar a cualquier casilla situada exactamente a tres casillas de su posición, en cualquier dirección. Debe elegir entre desplazarse o disparar, por lo que no puede realizar ambas acciones en el mismo turno.',
        strong: ['disparar'],
      },
      'El lanzamisiles solamente dispone de dos misiles para toda la partida.',
      {
        text: 'El lanzamisiles puede convertirse en un asaltador. El asaltador resultante de la conversión puede elegir libremente su orientación y realizar su acción durante el mismo turno. Una vez convertido, no podrá recuperar su forma original de lanzamisiles.',
        strong: ['convertirse en', 'un', 'asaltador', 'durante el mismo turno'],
      },
    ],
    demo: 'lanzamisiles',
  },
  {
    id: 'embestidor',
    label: 'Embestidor',
    title: 'Embestidor',
    paragraphs: [
      {
        text: 'El embestidor puede desplazarse en cualquiera de las seis direcciones del tablero, sin límite de casillas, siempre que el trayecto esté despejado.',
        strong: ['desplazarse'],
      },
      {
        text: 'El embestidor puede atacar a cualquier unidad enemiga situada dentro de su área de desplazamiento. Al hacerlo, la unidad enemiga es eliminada y el embestidor pasa a ocupar su casilla.',
        strong: ['atacar'],
      },
      {
        text: 'El embestidor puede convertirse en un asaltador. El asaltador resultante de la conversión puede elegir libremente su orientación y realizar su acción durante el mismo turno. Una vez convertido, no podrá recuperar su forma original de embestidor.',
        strong: ['convertirse en', 'un', 'asaltador', 'durante el mismo turno'],
      },
    ],
    demo: 'embestidor',
  },
  {
    id: 'dron',
    label: 'Dron',
    title: 'Dron',
    paragraphs: [
      {
        text: 'El dron puede desplazarse en cualquiera de las seis direcciones del tablero, hasta un máximo de tres casillas. Al desplazarse por el aire, puede pasar por encima de unidades aliadas y enemigas, excepto de otros drones y cazas. También puede finalizar su desplazamiento en una casilla ocupada por una unidad aliada, excepto por un dron o un caza.',
        strong: ['desplazarse'],
      },
      {
        text: 'El dron puede atacar a cualquier unidad enemiga situada dentro de su área de desplazamiento. Al hacerlo, la unidad enemiga es eliminada y el dron pasa a ocupar su casilla. El ataque solo puede realizarse en la casilla en la que finalice su desplazamiento, no durante el recorrido.',
        strong: ['atacar'],
      },
      'Las unidades terrestres pueden desplazarse por debajo de un dron aliado, pero no pueden hacerlo por debajo de un dron enemigo.',
    ],
    demo: 'dron',
  },
  {
    id: 'avion',
    label: 'Caza',
    title: 'Caza',
    paragraphs: [
      {
        text: 'El caza puede desplazarse hasta dos casillas hacia adelante. Si se desplaza en diagonal, su orientación cambia automáticamente.',
        strong: ['desplazarse'],
      },
      'Al desplazarse por el aire, puede pasar por encima de unidades aliadas y enemigas, excepto de otros drones y cazas. También puede finalizar su desplazamiento en una casilla ocupada por una unidad aliada o enemiga, excepto por un dron o un caza.',
      {
        text: 'El caza puede disparar a un total de ocho casillas: las tres casillas situadas dos casillas por delante de él y las cinco casillas situadas tres casillas por delante. La casilla central de las tres situadas a dos casillas de distancia (indicada con un punto verde con el contorno rojo) también puede ser alcanzada mediante un desplazamiento. En cualquier caso, el caza debe elegir entre desplazarse o disparar, por lo que no puede realizar ambas acciones en el mismo turno, tampoco en dicha casilla.',
        strong: ['disparar'],
      },
      {
        text: 'El caza también puede realizar un ataque kamikaze, desplazándose a una casilla ocupada por una unidad enemiga e impactando contra ella. En ese caso, tanto la unidad enemiga como el caza son destruidos.',
        strong: ['ataque kamikaze', 'tanto la unidad enemiga como el', 'caza', 'son destruidos'],
      },
    ],
    demo: 'avion',
  },
  {
    id: 'casillas-compartidas',
    label: 'Ataques sobre casillas compartidas',
    title: 'Ataques sobre casillas compartidas',
    paragraphs: [
      {
        text: 'Cada casilla tiene dos capas: suelo y aire. Una misma casilla puede contener simultáneamente una unidad terrestre y una unidad aérea, pero nunca dos unidades en una misma capa.',
        strong: ['suelo y aire'],
      },
      {
        text: 'Cuando dos unidades enemigas comparten una casilla y una unidad aliada puede atacarlas, solo puede atacar a una de ellas en cada acción. En ningún caso un mismo ataque puede afectar a ambas unidades.',
        strong: ['solo puede atacar a una de ellas en cada acción'],
      },
      {
        text: 'Las unidades terrestres cuyos ataques implican ocupar la casilla enemiga —asaltador y embestidor— solo pueden atacar a la unidad terrestre situada debajo de un dron o de un caza enemigo. Tras el ataque, la unidad atacante ocupa esa misma casilla, debajo del dron o del caza enemigo. Si se trata de un dron, este podrá atacar a la unidad terrestre en su siguiente turno.',
        strong: ['asaltador y embestidor'],
      },
      {
        text: 'Del mismo modo, el capturador solo puede capturar a la unidad terrestre situada debajo de un dron o caza enemigo. El capturador permanece en su casilla, mientras que la unidad capturada, que pasa a ser aliada, permanece debajo del dron o del caza enemigo.',
        strong: ['capturador'],
      },
      {
        text: 'Por su parte, las unidades que realizan ataques a distancia —tanque, lanzamisiles y caza— pueden elegir cuál de las dos unidades enemigas atacar, pero no pueden atacar a ambas en una misma acción. El caza también puede realizar un ataque kamikaze contra cualquiera de ellas.',
        strong: ['tanque, lanzamisiles y caza'],
      },
      {
        text: 'Por último, cuando el ataque lo realiza un dron, este solo puede atacar a la unidad aérea enemiga situada sobre la unidad terrestre. Tras el ataque, el dron ocupa esa misma casilla, por encima de la unidad terrestre enemiga.',
        strong: ['dron'],
      },
      'Si la unidad terrestre situada debajo del dron es un asaltador o un embestidor, podrá atacarlo. Si se trata de un capturador, podrá capturarlo. En cambio, el tanque y el lanzamisiles no pueden atacar directamente a un dron situado sobre ellos. No obstante, ambos pueden convertirse en asaltadores y atacar al dron durante ese mismo turno.',
    ],
    demo: 'casillas-compartidas',
  },
  {
    id: 'desarrollo',
    label: 'Desarrollo de la partida',
    title: 'Desarrollo de la partida',
    paragraphs: [
      {
        text: 'En el despliegue clásico, cada jugador comienza la partida con un ejército compuesto por 5 asaltadores, 4 tanques, 2 embestidores, 2 drones, 1 capturador, 1 lanzamisiles y 1 caza, además de una fortaleza y un escudo antiaéreo. En el despliegue extendido, el número de asaltadores aumenta a 11 y el de tanques se reduce a 2. Puedes explorar la disposición inicial de ambas formaciones mediante el siguiente selector:',
        strong: [
          '5 asaltadores, 4 tanques, 2 embestidores, 2 drones, 1 capturador, 1 lanzamisiles y 1 caza',
        ],
      },
      'El primer turno se determina por sorteo. Durante su turno, cada jugador debe seleccionar una de sus unidades y realizar una acción, como desplazarse, atacar, disparar o cambiar su orientación, según las características de la unidad seleccionada. A continuación, comienza el turno del rival.',
      {
        text: 'Los jugadores se turnan de forma alterna hasta que uno consigue destruir la fortaleza rival. Si se alcanza una situación en la que ninguno puede destruirla, la partida termina en tablas, aunque una de las fortalezas tenga menos puntos de vida que la otra. Los jugadores también pueden acordar tablas en cualquier momento de la partida.',
        strong: ['tablas', 'acordar tablas'],
      },
      {
        text: 'Un jugador pierde la partida si, durante 5 turnos consecutivos, se limita a cambiar la orientación de sus asaltadores o de los cañones de sus tanques, sin realizar ningún desplazamiento, ataque, disparo ni captura.',
        strong: ['5 turnos consecutivos'],
      },
      {
        text: 'En las partidas con límite de tiempo por turno, un jugador pierde la partida si agota el tiempo disponible en 3 ocasiones. En las partidas con límite de tiempo total, pierde cuando se agota el tiempo asignado a la partida. Ambos límites pueden combinarse.',
        strong: ['límite de tiempo por turno', 'límite de tiempo total'],
      },
    ],
    layoutPreview: true,
  },
  {
    id: 'indicadores',
    label: 'Indicadores y acciones',
    title: 'Indicadores y acciones',
    paragraphs: [
      'Al seleccionar una unidad, el tablero muestra mediante distintos colores y símbolos las acciones que puede realizar:',
      {
        text: 'Desplazamiento: las casillas a las que puede desplazarse se indican con un punto verde. Si una de estas casillas está ocupada por una unidad enemiga que puede atacar mediante desplazamiento, se indica con un punto rojo.',
        strong: ['Desplazamiento:', 'punto verde', 'punto rojo'],
      },
      {
        text: 'Disparo: las casillas a las que puede disparar una unidad se indican mediante un contorno rojo. Si alguna de ellas está ocupada por una unidad enemiga que puede ser atacada, esta se señala con una X roja.',
        strong: ['Disparo:', 'contorno rojo', 'X roja'],
      },
      {
        text: 'Captura: cuando un capturador tiene a su alcance una unidad enemiga que puede capturar, esta se indica mediante una red del color del capturador. El color de la red indica el color que tendrá la unidad capturada después de la captura.',
        strong: ['Captura:', 'red del color del capturador'],
      },
      'Los mismos colores y símbolos se utilizan al seleccionar unidades propias y enemigas. Sin embargo, cuando se selecciona una unidad enemiga, los indicadores aparecen con menor intensidad.',
      {
        text: 'En las unidades que pueden realizar ataques a distancia, al seleccionar una casilla de desplazamiento, los contornos rojos se desplazan para mostrar las casillas a las que la unidad podría disparar desde la posición seleccionada. Estos indicadores muestran el posible alcance de disparo en el siguiente turno si se confirma el desplazamiento.',
        strong: ['contornos rojos se desplazan'],
      },
      {
        text: 'Al seleccionar una unidad, aparece en la parte derecha de la pantalla un panel de mando que muestra sus características y las acciones que puede realizar. Al seleccionar una casilla de desplazamiento, ataque o captura, el panel ofrece la opción de confirmar la acción. La acción no se ejecutará hasta que el jugador la confirme. También se puede confirmar haciendo doble clic en la casilla de destino, salvo que haya más de una acción posible en esa casilla.',
        strong: ['panel de mando', 'confirmar la acción'],
      },
      {
        text: 'Para deseleccionar una unidad, basta con hacer clic de nuevo sobre ella o cerrar el panel de mando.',
        strong: ['deseleccionar una unidad'],
      },
      'Arrastra el tablero para desplazar la vista. Usa la rueda del ratón o un gesto de pinza con dos dedos para acercar y alejar.',
      'Si prefieres el teclado, con el foco en el tablero usa Q, W, E, A, S y D para recorrer las seis direcciones; Intro o espacio para seleccionar; U o Mayús + U para cambiar de unidad propia; Esc para cancelar la orden preparada, y C para centrar la vista.',
    ],
  },
  {
    id: 'experiencia',
    label: 'Puntos de experiencia',
    title: 'Puntos de experiencia',
    paragraphs: [
      {
        text: 'Los puntos de experiencia (XP) representan tu progreso en Hexfortia. Consíguelos jugando partidas para subir de nivel y desbloquear nuevos logros. La cantidad de experiencia que obtienes depende del modo de juego, del resultado de la partida y de su duración.',
        strong: ['puntos de experiencia (XP)'],
      },
      {
        text: 'Partidas en línea',
        kind: 'heading',
      },
      'Derrota o tablas: 50 XP.',
      'Victoria: 100 XP.',
      {
        text: 'Partidas Vs. Hexfortia',
        kind: 'heading',
      },
      'La experiencia obtenida depende del nivel de dificultad elegido:',
      {
        text: 'Experiencia por dificultad',
        kind: 'table',
        columns: ['Nivel', 'Derrota o tablas', 'Victoria'],
        rows: [
          ['Fácil', '15 XP', '25 XP'],
          ['Medio', '25 XP', '50 XP'],
          ['Difícil', '35 XP', '75 XP'],
          ['Experto', '50 XP', '100 XP'],
        ],
      },
      {
        text: 'Partidas locales',
        kind: 'heading',
      },
      'En este modo, la experiencia se obtiene en función de la duración de la partida.',
      {
        text: 'Bonificaciones adicionales',
        kind: 'heading',
      },
      {
        text: 'Duración de la partida: obtienes 1 XP adicional por cada 2 turnos completos, hasta un máximo de 50 XP por partida.',
        strong: ['Duración de la partida:'],
      },
      {
        text: 'Primera partida del día: recibes una bonificación adicional de 25 XP por tu primera partida completada cada día, independientemente del modo de juego.',
        strong: ['Primera partida del día:'],
      },
      'Las partidas abandonadas no cuentan como partidas completadas y no otorgan experiencia.',
      {
        text: 'Logros',
        kind: 'heading',
      },
      'Nivel principiante: 25 XP',
      'Nivel avanzado: 75 XP',
      'Nivel experto: 200 XP',
      'Nivel maestro: 500 XP',
      'Nivel legendario: 1000 XP',
      {
        text: 'Niveles y categorías',
        kind: 'heading',
      },
      'A medida que acumules experiencia, irás subiendo de nivel. La cantidad de XP necesaria para alcanzar cada nuevo nivel irá aumentando progresivamente. Además, tu nivel determinará la categoría a la que perteneces:',
      'Niveles 0-4: Principiante',
      'Niveles 5-14 : Avanzado',
      'Niveles 15-29: Experto',
      'Niveles 30-49: Maestro',
      'Niveles 50-100: Legendario',
    ],
  },
  {
    id: 'clasificacion',
    label: 'Puntos de clasificación',
    title: 'Puntos de clasificación',
    paragraphs: [
      'Los puntos de clasificación representan tu nivel competitivo en Hexfortia. A diferencia de los puntos de experiencia, que reflejan tu progreso en el juego, los puntos de clasificación dependen de tus resultados y del nivel de tus rivales.',
      {
        text: '¿Cómo se consiguen?',
        kind: 'heading',
      },
      'Las partidas privadas no modifican el Elo. Sí cuentan para las estadísticas, los logros y los puntos de experiencia.',
      'Al comenzar, dispones de 1000 puntos de clasificación. Después de cada partida, tu puntuación puede aumentar o disminuir en función del resultado y de la clasificación de tu rival.',
      {
        text: 'Si ganas, obtendrás puntos de clasificación.',
        strong: ['Si ganas'],
      },
      {
        text: 'Si pierdes, perderás puntos de clasificación.',
        strong: ['Si pierdes'],
      },
      {
        text: 'Si empatas, el cambio de puntuación dependerá de la clasificación de ambos jugadores.',
        strong: ['Si empatas'],
      },
      'La cantidad de puntos que ganas o pierdes depende de las expectativas previas al enfrentamiento. Por ejemplo, vencer a un rival con una clasificación muy superior a la tuya te permitirá ganar más puntos, mientras que perder contra él supondrá una penalización menor. Por el contrario, vencer a un rival con una clasificación inferior te dará menos puntos, y perder contra él te hará perder más.',
      {
        text: 'Clasificaciones independientes',
        kind: 'heading',
      },
      'Hexfortia cuenta con dos clasificaciones independientes: una para las partidas en línea contra otros jugadores y otra para las partidas contra Hexfortia. Tu posición en una no afecta a tu puntuación en la otra.',
      'En las partidas contra Hexfortia, la puntuación que se toma como referencia depende del nivel de dificultad elegido: Fácil, Medio, Difícil o Experto. Igual que en las partidas en línea, cuanto mayor sea la dificultad elegida, más puntos podrás ganar y menos podrás perder, y viceversa.',
      {
        text: 'Clasificaciones histórica y mensual',
        kind: 'heading',
      },
      'Tanto en las partidas en línea como en las partidas contra Hexfortia existen dos clasificaciones:',
      {
        text: 'Clasificación histórica: tiene en cuenta todas las partidas disputadas en la modalidad correspondiente.',
        strong: ['Clasificación histórica:'],
      },
      {
        text: 'Clasificación mensual: tiene en cuenta únicamente las partidas disputadas durante los últimos 30 días.',
        strong: ['Clasificación mensual:'],
      },
      'Ambas clasificaciones permiten comparar tu rendimiento competitivo desde perspectivas diferentes: la histórica refleja tu trayectoria global, mientras que la mensual permite compararte con los jugadores activos durante el último mes.',
    ],
  },
];
