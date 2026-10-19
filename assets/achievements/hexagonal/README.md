# Emblemas hexagonales de logros

Colección actual de **100 ilustraciones diferentes**, una por cada ID del catálogo de progresión.
Generadas individualmente con la herramienta integrada ImageGen. El libro del tutorial (`p1-01`)
es la referencia de material y marco para las otras 99 imágenes: oro pulido en relieve, esmalte
burdeos, pequeños detalles cian y un hexágono horizontal. Cada logro tiene un motivo propio;
los niveles no reutilizan dibujos cambiando una cifra, una inscripción o un color.

- `originals/`: PNG generados, con su transparencia original y sin modificaciones.
- `originals-canonical/`: revisiones que utilizan los [diseños oficiales de las unidades](../../units/README.md). Se mantienen los originales anteriores como procedencia.
- `generation.json`: herramienta, referencia, motivos y prompts exactos de las 100 generaciones.
- `../../../public/achievements/hexagonal/`: imágenes WebP de 512 × 400 para la colección y las
  notificaciones. Se incluyen en la caché offline del build.

Para preparar de nuevo las imágenes de entrega:

```sh
pnpm exec node scripts/prepare-hexagonal-achievement-art.mjs
```

Solo se ajusta el tamaño conservando la proporción y se codifica en WebP sobre un lienzo
transparente. No se redibujan las ilustraciones ni se modifican los PNG originales.
Los estados pendientes se presentan desde CSS con saturación y brillo reducidos;
el texto y el candado siguen indicando su estado.

## Referencias de las unidades

Todas las unidades del campo de batalla son máquinas controladas a distancia. El
Asaltador es el rover triangular de cuatro ruedas y el Embestidor es el vehículo
de orugas con punta de impacto; nunca se representan como infantería humana ni
como un ariete medieval. Los otros modelos mantienen también su forma oficial.

Las revisiones conservan el marco y los materiales de la colección. Sus entradas
en `generation.json` incluyen `referenceUnits`, el prompt utilizado y la generación
anterior en `previousGeneration`. El campo `original` elige el PNG que se publica;
no se deduce la ruta a partir del ID. Para crear nuevos logros, adjuntar las
referencias correspondientes de `assets/units/originals/` a ImageGen. Los motivos
heráldicos o simbólicos sin unidades conservan su ilustración.
