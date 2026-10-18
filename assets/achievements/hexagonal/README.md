# Emblemas hexagonales de logros

Colección actual de **100 ilustraciones diferentes**, una por cada ID del catálogo de progresión.
Generadas individualmente con la herramienta integrada ImageGen. El libro del tutorial (`p1-01`)
es la referencia de material y marco para las otras 99 imágenes: oro pulido en relieve, esmalte
burdeos, pequeños detalles cian y un hexágono horizontal. Cada logro tiene un motivo propio;
los niveles no reutilizan dibujos cambiando una cifra, una inscripción o un color.

- `originals/`: PNG generados, con su transparencia original y sin modificaciones.
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
