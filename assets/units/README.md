# Diseños oficiales de las unidades

Los dos ejércitos están formados íntegramente por máquinas controladas a distancia.
El mando puede ser humano o la IA Hexfortia; ninguna unidad es una persona ni un
robot humanoide. El Asaltador es un vehículo triangular pequeño con cuatro ruedas.
El Embestidor es un vehículo de orugas con una punta de impacto.

Los nueve PNG de `originals/` son las referencias de forma y construcción. Los
WebP de `../../public/units/` se consultan en el manual, desplegando «Diseño de
referencia» en la sección de cada unidad. Fortaleza incluye también el Escudo
antiaéreo. Los glifos del tablero y las demostraciones animadas se conservan.

`generation.json` conserva los prompts exactos y las referencias de ImageGen
integrado. `../../src/unit-appearance.ts` contiene las descripciones en español.
Los identificadores internos `soldier` y `airplane` permanecen por compatibilidad
con partidas guardadas: sus nombres visibles son Asaltador y Caza.

| Unidad           | Referencia original                                            |
| ---------------- | -------------------------------------------------------------- |
| Asaltador        | [Vehículo triangular con cuatro ruedas](originals/soldier.png) |
| Capturador       | [Máquina con dos pinzas](originals/capturer.png)               |
| Tanque           | [Orugas, torreta circular y cañón](originals/medium.png)       |
| Lanzamisiles     | [Plataforma de dos raíles abiertos](originals/long.png)        |
| Embestidor       | [Cuña de impacto con orugas y pistones](originals/fast.png)    |
| Dron             | [Núcleo romboidal y cuatro rotores](originals/drone.png)       |
| Caza             | [Aeronave sin cabina](originals/airplane.png)                  |
| Escudo antiaéreo | [Radar fijo sobre dos apoyos](originals/antiAir.png)           |
| Fortaleza        | [Bastión automatizado de dos torres](originals/fortress.png)   |

Para volver a preparar las imágenes de entrega:

```sh
pnpm exec node scripts/prepare-unit-art.mjs
```

## Continuidad visual

- Mantener la silueta, el tren de rodaje, los sensores y el armamento de cada
  referencia al dibujar nuevos logros. Adjuntar siempre el PNG correspondiente;
  escribir solo el nombre de la unidad no basta.
- Cian y Ámbar utilizan el mismo modelo. Cambian las marcas de bando, no la forma.
- En los logros se permite traducir los materiales a oro y esmalte burdeos,
  conservando las formas y proporciones del modelo de referencia.
- La transformación de un vehículo produce el rover Asaltador, nunca una persona
  que sale del vehículo. El Capturador cambia el control de máquinas, no su aspecto.
- Los motivos simbólicos (coronas, libros, relojes, animales heráldicos) no son
  unidades del ejército ni sustituyen las referencias de las unidades.
- Los detalles de estas ilustraciones son visuales y no añaden reglas al motor.
