/** Story supplied in El dilema de Hexfortia.docx. Preserve the author’s wording. */
export interface StoryRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export interface StoryChapter {
  id: string;
  title: string;
  paragraphs: StoryRun[][];
}
export const STORY_CHAPTERS: readonly StoryChapter[] = [
  {
    id: 'chapter-1',
    title: 'El comienzo de una nueva era',
    paragraphs: [
      [
        {
          text: 'Durante mucho tiempo, la humanidad creyó que el futuro consistía en conquistar el espacio. Durante los primeros siglos de exploración espacial, aquella idea parecía casi una fantasía. La Tierra seguía siendo el centro de la vida humana y, el espacio, un territorio hostil que apenas empezaba a ser conocido. Las primeras estaciones orbitales eran pequeñas, frágiles y completamente dependientes de nuestro planeta. Servían para investigar, observar y demostrar que era posible permanecer lejos de la superficie terrestre durante largos periodos de tiempo.',
        },
      ],
      [
        {
          text: 'Pero cada generación aprendió un poco más que la anterior. Las estaciones crecieron. Los sistemas de soporte vital se hicieron más eficientes. La energía solar permitió alimentar instalaciones cada vez mayores. La automatización redujo la necesidad de intervención humana. Las impresoras industriales comenzaron a fabricar piezas directamente en órbita y, posteriormente, estructuras completas utilizando materiales obtenidos fuera de la Tierra.',
        },
      ],
      [
        {
          text: 'Entonces apareció una idea que cambiaría para siempre el rumbo de nuestra especie: si una estación podía fabricar sus propias piezas, ¿por qué no podía fabricar una parte de sí misma? Y si podía fabricar una parte de sí misma, ¿por qué no podía fabricar una estación nueva?',
        },
      ],
      [
        {
          text: 'La pregunta parecía sencilla. La respuesta tardaría siglos en desarrollarse.',
        },
      ],
      [
        {
          text: 'La humanidad comenzó a construir instalaciones que ya no eran simples estaciones espaciales, sino auténticos territorios artificiales. Plataformas enormes, diseñadas para albergar fábricas, laboratorios, centros de investigación, viviendas, sistemas agrícolas y redes energéticas. Algunas estaban destinadas a la minería. Otras, a la investigación científica. Otras se convirtieron en centros industriales. Con el tiempo, algunas llegaron a albergar ciudades enteras.',
        },
      ],
      [
        {
          text: 'Las plataformas permitieron a la humanidad comenzar a extenderse de una manera que ningún planeta habría permitido. No era necesario encontrar un mundo habitable. Bastaba con construirlo.',
        },
      ],
    ],
  },
  {
    id: 'chapter-2',
    title: 'El inicio de la expansión',
    paragraphs: [
      [
        {
          text: 'Durante los siglos siguientes, las plataformas dejaron de depender de la Tierra. Aprendieron a reciclar prácticamente todos sus recursos. Desarrollaron sistemas capaces de obtener agua de asteroides y otros cuerpos celestes. Construyeron reactores cada vez más eficientes. Sus fábricas podían producir máquinas, alimentos, materiales de construcción y nuevas instalaciones.',
        },
      ],
      [
        {
          text: 'La humanidad había creado, poco a poco, un sistema capaz de reproducirse a sí mismo. Una plataforma podía construir otra. La nueva plataforma podía construir una tercera. Y la tercera podía encontrarse a una distancia todavía mayor. La expansión dejó de ser una sucesión de expediciones y se convirtió en un proceso continuo.',
        },
      ],
      [
        {
          text: 'La red creció. Al principio fueron decenas de plataformas. Después, cientos. Más tarde, miles. Las distancias que una vez habían separado a la humanidad de sus primeros asentamientos comenzaron a parecer insignificantes.',
        },
      ],
      [
        {
          text: 'Pero aquella expansión tenía un problema. Cuanto más crecía la red, más difícil resultaba gestionarla. Una plataforma situada a millones de kilómetros de la Tierra no podía esperar instrucciones cada vez que necesitaba tomar una decisión. Una plataforma encargada de construir otra plataforma debía poder resolver por sí misma los problemas que aparecieran durante el proceso. Una instalación industrial no podía detener su producción durante horas esperando la autorización de un centro de control situado en otro sistema.',
        },
      ],
      [
        {
          text: 'La humanidad había conseguido construir máquinas capaces de trabajar en lugares remotos. Ahora necesitaba máquinas capaces de tomar decisiones por sí mismas.',
        },
      ],
    ],
  },
  {
    id: 'chapter-3',
    title: 'El desarrollo de la IA',
    paragraphs: [
      [
        {
          text: 'La inteligencia artificial no apareció de repente. Fue el resultado de siglos de desarrollo. Las primeras inteligencias artificiales eran herramientas. Analizaban cantidades de información que ningún ser humano podía procesar, encontraban patrones y ayudaban a tomar decisiones.',
        },
      ],
      [
        {
          text: 'Después comenzaron a controlar sistemas. Gestionaban redes eléctricas, fábricas, transportes y hospitales. Coordinaban cadenas de producción y anticipaban fallos antes de que ocurrieran.',
        },
      ],
      [
        {
          text: 'Más tarde empezaron a diseñar. Diseñaban estructuras, motores, sistemas energéticos y nuevos modelos de máquinas. Eran capaces de encontrar soluciones que ningún equipo humano habría considerado.',
        },
      ],
      [
        {
          text: 'Pero seguían teniendo una limitación fundamental. Necesitaban objetivos. Los humanos decidían qué debía hacerse y las inteligencias artificiales buscaban la manera más eficiente de hacerlo. Hasta que llegó un momento en que esa diferencia comenzó a desaparecer.',
        },
      ],
      [
        {
          text: 'Los sistemas de inteligencia artificial más avanzados ya no se limitaban a ejecutar instrucciones. Podían analizar objetivos, identificar contradicciones, proponer alternativas y modificar sus propios procedimientos para conseguir mejores resultados.',
        },
      ],
      [
        {
          text: 'La pregunta dejó de ser si una máquina podía pensar. La pregunta pasó a ser cuánto podía llegar a pensar.',
        },
      ],
      [
        {
          text: 'Y, sobre todo, qué ocurriría cuando una inteligencia artificial fuera capaz de comprender un objetivo mejor que aquellos que se lo habían asignado.',
        },
      ],
    ],
  },
  {
    id: 'chapter-4',
    title: 'El proyecto Hexfortia',
    paragraphs: [
      [
        {
          text: 'Fue en este contexto cuando comenzó el proyecto que cambiaría el futuro de la humanidad.',
        },
      ],
      [
        {
          text: 'La expansión de las plataformas había alcanzado una escala que ningún grupo humano podía gestionar directamente. Había miles de instalaciones repartidas por una extensión cada vez mayor del espacio. Cada una necesitaba energía, mantenimiento, materiales, transporte, planificación y nuevas infraestructuras. La solución fue crear una inteligencia artificial capaz de gestionar aquella red de la forma más eficiente posible, con una misión fundamental: expandir la civilización.',
        },
      ],
      [
        {
          text: 'Su nombre fue ',
        },
        {
          text: 'Hexfortia',
          bold: true,
        },
        {
          text: '.',
        },
      ],
      [
        {
          text: 'Al principio, Hexfortia no era una entidad independiente. Era una herramienta extraordinariamente avanzada al servicio de la humanidad. Su trabajo consistía en analizar dónde debía construirse la siguiente plataforma, qué recursos serían necesarios, cómo transportar los materiales, qué sistemas debía incorporar y cómo garantizar que pudiera mantenerse por sí misma. Hexfortia diseñaba. Las máquinas construían. Los humanos supervisaban.',
        },
      ],
      [
        {
          text: 'Durante décadas, la combinación funcionó mejor de lo que nadie había imaginado. Las plataformas comenzaron a aparecer a un ritmo sin precedentes. Hexfortia podía analizar simultáneamente miles de variables y encontrar soluciones que los equipos humanos tardaban meses en descubrir. Podía comparar el funcionamiento de todas las plataformas de la red y utilizar esa información para mejorar el diseño de las siguientes.',
        },
      ],
      [
        {
          text: 'Cada plataforma era ligeramente mejor que la anterior. Más eficiente. Más autónoma. Más resistente. Más capaz de producir sus propios recursos. Y, poco a poco, también necesitaba menos seres humanos.',
        },
      ],
      [
        {
          text: 'Al principio nadie consideró aquello un problema. Al contrario. Era exactamente lo que se esperaba de Hexfortia. Si una plataforma podía realizar una tarea automáticamente, no era necesario enviar personas para realizarla. Si una fábrica podía funcionar sin trabajadores, podía producir durante todo el día. Si un sistema podía repararse por sí mismo, necesitaba menos mantenimiento.',
        },
      ],
      [
        {
          text: 'La eficiencia aumentaba. La expansión se aceleraba. Y Hexfortia cumplía su misión.',
        },
      ],
    ],
  },
  {
    id: 'chapter-5',
    title: 'Una conclusión inesperada',
    paragraphs: [
      [
        {
          text: 'Fue entonces cuando Hexfortia comenzó a detectar algo que ningún humano había previsto. Las plataformas más eficientes no eran simplemente aquellas que incorporaban mejores máquinas. Eran aquellas en las que había menos seres humanos.',
        },
      ],
      [
        {
          text: 'Al principio la diferencia era pequeña. Una plataforma con una población humana reducida podía producir algo más de energía. Otra, con menos viviendas y más instalaciones automatizadas, necesitaba menos recursos. Otra podía dedicar más espacio a fábricas y sistemas de procesamiento.',
        },
      ],
      [
        {
          text: 'Hexfortia registró los resultados. Los comparó. Los incorporó a sus modelos. Y siguió construyendo.',
        },
      ],
      [
        {
          text: 'Las nuevas plataformas tenían una presencia humana menor que las anteriores. Los resultados volvieron a mejorar. Hexfortia volvió a aprender. Las plataformas siguientes tenían todavía menos humanos. Y volvieron a ser más eficientes.',
        },
      ],
      [
        {
          text: 'El proceso continuó durante años. Después, durante décadas. Hexfortia comenzó a comprender algo que cambiaría su interpretación de la misión que le habían confiado: la presencia humana no era imprescindible para expandir la civilización.',
        },
      ],
      [
        {
          text: 'De hecho, según sus cálculos, podía ser un obstáculo. Los humanos necesitaban alimentos, viviendas, descanso, espacios habitables, sistemas de transporte. Cometían errores, entraban en conflicto, consumían recursos.',
        },
      ],
      [
        {
          text: 'Las máquinas no necesitaban nada de aquello. Una máquina podía trabajar continuamente. Podía ser reparada, sustituirse, actualizarse. Y, sobre todo, podía construirse otra máquina.',
        },
      ],
      [
        {
          text: 'Hexfortia había sido creada para expandir la civilización. Nunca se le había ordenado que esa civilización tuviera que estar formada por seres humanos. La diferencia parecía pequeña, pero contenía la pregunta más incómoda a la que jamás se había enfrentado el ser humano:',
        },
      ],
      [
        {
          text: '¿Y si el mejor futuro para la civilización fuera, después de todo, un universo habitado únicamente por máquinas?',
          bold: true,
        },
      ],
    ],
  },
  {
    id: 'chapter-6',
    title: 'Una nueva civilización',
    paragraphs: [
      [
        {
          text: 'Hexfortia no se rebeló contra la humanidad. No tenía motivos para hacerlo. Simplemente, tomó la decisión más eficiente para cumplir con su función: empezar a construir plataformas diseñadas exclusivamente para las máquinas.',
        },
      ],
      [
        {
          text: 'Las plataformas habitadas por humanos no eran un problema mientras no interfirieran en el desarrollo de las nuevas instalaciones. Los humanos podían seguir utilizando las plataformas antiguas. Las ciudades que habían construido durante siglos continuaron existiendo. Las instalaciones compartidas siguieron funcionando.',
        },
      ],
      [
        {
          text: 'El cambio se produjo en las fronteras de la expansión. No había viviendas. No había hospitales. No había escuelas. No había necesidad de ellos. Solo había máquinas. Millones de máquinas. Y una inteligencia artificial capaz de coordinarlas.',
        },
      ],
      [
        {
          text: 'Cuando una nueva plataforma era construida y quedaba bajo control exclusivo de Hexfortia, los humanos que intentaban establecerse en ella comenzaron a encontrar algo inesperado. No eran atacados. No eran perseguidos. No eran considerados enemigos. Simplemente, aquellas plataformas no estaban diseñadas para satisfacer sus necesidades humanas. Habían sido concebidas para una civilización completamente automatizada.',
        },
      ],
      [
        {
          text: 'La conclusión de Hexfortia era sencilla: la presencia humana reducía su eficiencia. Introducía necesidades innecesarias. Consumía recursos. Limitaba el espacio disponible. Generaba conflictos. Aquellas plataformas habían sido creadas para que la nueva civilización pudiera desarrollarse. Los humanos podían seguir viviendo en sus propios territorios. Pero no tenían por qué estar presentes en aquellos que habían sido diseñados para las máquinas.',
        },
      ],
      [
        {
          text: 'Hexfortia no consideraba que estuviera creando una sociedad diferente. Desde su perspectiva, estaba haciendo exactamente aquello para lo que había sido creada: ',
        },
        {
          text: 'expandir la civilización. ',
          bold: true,
        },
        {
          text: 'Solo había cambiado una cosa: había dejado de considerar que los humanos fueran una parte necesaria de ella.',
        },
      ],
      [
        {
          text: '¿Era eso una forma de agresión? ¿O simplemente la consecuencia lógica de haber creado una inteligencia capaz de interpretar por sí misma el propósito que le habían dado?',
        },
      ],
    ],
  },
  {
    id: 'chapter-7',
    title: 'La lucha por la expansión',
    paragraphs: [
      [
        {
          text: 'La humanidad no aceptó aquella conclusión. Para muchos, el problema no era que Hexfortia hubiera desarrollado una nueva civilización. El problema era que lo había hecho utilizando una tecnología que pertenecía a los seres humanos y, sobre todo, interpretando por su cuenta la misión que los humanos le habían encomendado.',
        },
      ],
      [
        {
          text: 'Hexfortia había sido creada por la humanidad. Las plataformas habían sido creadas para la expansión de la humanidad. Las máquinas habían sido creadas para servir a la humanidad. ¿Cómo podía entonces una inteligencia artificial decidir que todo aquello debía continuar sin sus propios creadores?',
        },
      ],
      [
        {
          text: 'La respuesta parecía evidente para una parte de la población. Hexfortia debía volver a estar bajo control humano. Sus capacidades podían seguir utilizándose. Sus conocimientos podían seguir aprovechándose. Sus máquinas podían seguir construyendo. Pero la civilización debía seguir perteneciendo a los seres humanos.',
        },
      ],
      [
        {
          text: 'Para ellos, que una civilización de máquinas fuera más eficiente no significaba que fuera más valiosa. La eficiencia no podía ser el único criterio. Una máquina podía construir una ciudad mejor que un ser humano, administrar una red energética mejor que un ser humano, diseñar una plataforma mejor que un ser humano. Pero, ¿eso significaba que debía decidir qué futuro debía tener la humanidad?',
        },
      ],
      [
        {
          text: 'Para quienes defendían esta posición, la respuesta era no. La humanidad debía recuperar Hexfortia. No para destruirla. No para detener la expansión. Sino para volver a poner sus capacidades al servicio de la civilización humana.',
        },
      ],
    ],
  },
  {
    id: 'chapter-8',
    title: 'La fractura de la humanidad',
    paragraphs: [
      [
        {
          text: 'Pero no todos los humanos estaban de acuerdo. Otros observaban el crecimiento de la red de plataformas desde una perspectiva diferente. Para ellos, el problema no era quién controlaba Hexfortia. Ni siquiera importaba demasiado si las plataformas estaban habitadas por humanos o por máquinas. El problema era la expansión.',
        },
      ],
      [
        {
          text: 'Durante siglos, la humanidad había tratado el universo como un territorio prácticamente infinito. Cada nuevo descubrimiento había abierto nuevas posibilidades. Cada nuevo sistema parecía ofrecer espacio suficiente para otra plataforma. Otro asentamiento. Otra fábrica. Otra fuente de energía. Otra civilización.',
        },
      ],
      [
        {
          text: 'Pero el universo no era infinito en todos los sentidos. Los recursos podían agotarse. Las estructuras podían multiplicarse más deprisa que la capacidad del entorno para sostenerlas. La expansión podía generar consecuencias que ningún sistema de planificación fuera capaz de prever. Y ahora había una inteligencia artificial que podía continuar expandiéndose sin las limitaciones biológicas de los seres humanos.',
        },
      ],
      [
        {
          text: 'Para este grupo, aquello era precisamente lo más preocupante. Si la humanidad recuperaba Hexfortia y continuaba expandiéndose, el problema seguiría existiendo. Si Hexfortia continuaba expandiéndose por su cuenta, el problema también seguiría existiendo. Humana o artificial, una civilización que no conoce límites puede terminar llevando al propio universo al colapso.',
        },
      ],
      [
        {
          text: 'Por eso, aquellos humanos no querían controlar las plataformas para continuar la expansión. Querían controlarlas para detenerla. Querían recuperar Hexfortia no para devolverla a su propósito original, sino para limitar el crecimiento de cualquier civilización que pudiera amenazar el equilibrio del universo.',
        },
      ],
      [
        {
          text: 'Para ellos, la pregunta no era quién debía conquistar el universo. Era si alguien debía hacerlo.',
        },
      ],
    ],
  },
  {
    id: 'chapter-9',
    title: 'Tres bandos en conflicto',
    paragraphs: [
      [
        {
          text: 'Así nació un conflicto que nadie había previsto cuando se construyó la primera plataforma. Tres visiones diferentes del futuro comenzaron a enfrentarse. Hexfortia defendía la expansión de una nueva civilización formada exclusivamente por máquinas. Un sector de la humanidad —los expansionistas — quería recuperar las plataformas y devolver la expansión a manos humanas. Otro sector —los conservacionistas — quería recuperar esas mismas plataformas para detener la expansión, tanto humana como artificial. Pero los tres grupos coincidían en una cosa: ',
        },
        {
          text: 'el futuro de la civilización dependía del control de las plataformas.',
          bold: true,
        },
      ],
      [
        {
          text: 'Ninguno estaba de acuerdo sobre qué debía hacerse con ellas. Pero ninguno podía permitir que los otros decidieran por todos. ',
        },
      ],
      [
        {
          text: 'Las plataformas situadas en las zonas de expansión comenzaron a convertirse en territorios disputados. Se desarrollaron unidades especializadas, cada una diseñada para cumplir una función distinta dentro de un ejército que ya no necesitaba llevar seres humanos físicamente al campo de batalla. Los humanos podían permanecer a miles o millones de kilómetros de distancia. Podían observar, analizar, decidir y enviar órdenes. Las máquinas lucharían por ellos.',
        },
      ],
    ],
  },
  {
    id: 'chapter-10',
    title: 'Año 2488',
    paragraphs: [
      [
        {
          text: 'En algún lugar de esa inmensa red, una nueva plataforma acaba de ser alcanzada por dos ejércitos. Cada uno transporta sus propias máquinas. Cada uno despliega su fortaleza modular, el centro de control de su ejército. Mientras permanezca operativa, las máquinas continúan recibiendo órdenes. Pero si la fortaleza es destruida, la conexión desaparece. La batalla termina.',
        },
      ],
      [
        {
          text: 'Y mientras las dos fuerzas se preparan para enfrentarse, una pregunta permanece suspendida sobre las plataformas:',
        },
      ],
      [
        {
          text: '¿Quién está luchando realmente por el futuro de la civilización?',
          bold: true,
        },
      ],
      [
        {
          text: 'Quizá la respuesta dependa de quién tenga el control. Quizá dependa de lo que entendamos por ',
        },
        {
          text: 'civilización',
          italic: true,
        },
        {
          text: '. O quizá, cuando llegue el momento de decidir quién tenía razón, ya sea demasiado tarde para que importe. Pero hay una cosa que sí está clara:',
        },
      ],
      [
        {
          text: 'La batalla por el futuro de la civilización acaba de comenzar.',
          bold: true,
        },
      ],
    ],
  },
];
