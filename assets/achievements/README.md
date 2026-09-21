# Ilustraciones de logros

Colección de 28 ilustraciones cuadradas creadas con la herramienta integrada ImageGen, una generación por logro. El primer emblema (`first-win`) sirve como referencia visual para los otros 27: miniaturas tácticas de latón y esmalte cian, iluminación cálida, base hexagonal y fondo azul oscuro. Cada imagen representa la condición del logro sin texto incrustado.

- `originals/`: PNG originales de la generación, conservados sin modificaciones.
- `generation.json`: prompts exactos, referencia visual y correspondencia con el catálogo de logros.
- `../../public/achievements/`: versiones WebP de 512 × 512 píxeles utilizadas por el menú y las notificaciones; también se incluyen en la caché offline.

Para volver a preparar los archivos de entrega, desde la raíz del repositorio:

```sh
pnpm exec node scripts/prepare-achievement-art.mjs
```

El script usa Chrome o Edge y las dependencias existentes de Playwright. Puede indicarse su ejecutable con `PLAYWRIGHT_BROWSER_PATH`. Solo reduce y codifica los PNG en WebP; no altera la composición ni sobrescribe los originales.
