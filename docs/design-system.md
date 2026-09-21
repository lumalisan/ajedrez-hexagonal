# Sistema de diseño

El sistema de Protocolo Hexagonal reúne los controles compartidos, sus estados y sus contratos de accesibilidad. Conserva la identidad cian/ámbar y los tokens actuales. Usa HTML nativo para acciones y campos, y Radix UI para comportamientos compuestos: casillas, grupos de opciones y pestañas.

## Organización

- `src/app/components/ui/`: componentes de presentación sin `useGame`, reglas, almacenamiento ni efectos de partida.
- `src/app/components/game-select.tsx`: selector común basado en React Select.
- `src/styles/tokens.css`: valores compartidos; `src/styles.css`: su correspondencia con Tailwind CSS 4.
- `src/styles/design-system.css`: foco, preferencias y compatibilidad entre controles y estilos del juego.
- `src/styles/game.css`: disposición de pantallas, tablero y estilos propios del producto.
- `src/design-system/`: catálogo interactivo de desarrollo.

Los componentes de dominio leen `useGame` y pasan valores, mensajes y callbacks a los controles. Un `RadioGroup` sabe seleccionar una opción; `ConfigDialog` sabe qué preset existe y qué configuración produce.

Importa directamente del archivo necesario, con la ruta relativa correspondiente. Los componentes preservan los atributos nativos o de Radix y aceptan `ref` como prop de React 19. `className` sirve para composición y layout; usa `variant` y `size` para cambiar el tratamiento visual y el tamaño. `cx` solo une clases: no resuelve conflictos entre utilidades ni garantiza que prevalezca la última clase.

```tsx
import { Button, IconButton } from '../components/ui/button';
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '../components/ui/field';
import { Input, Textarea } from '../components/ui/input';
```

## Tokens

| Intención              | Tokens CSS                                        | Utilidades habituales                                        |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Fondo y superficies    | `--bg`, `--surface`, `--surface-2`, `--surface-3` | `bg-canvas`, `bg-panel`, `bg-panel-raised`, `bg-panel-hover` |
| Texto                  | `--text`, `--muted`                               | `text-ink`, `text-muted`                                     |
| Separadores y bordes   | `--line`, `--line-strong`                         | `border-line`, `border-line-strong`                          |
| Jugadores              | `--blue`, `--amber`                               | `text-cyan`, `text-amber`                                    |
| Acción y peligro       | `--move`, `--danger`, `--on-accent`               | `bg-accent`, `bg-danger`, `text-on-accent`                   |
| Tipografía             | `--font-body`, `--font-display`                   | `font-ui`, `font-heading`                                    |
| Control                | `--control-height` (44 px), `--control-radius`    | `min-h-control`, `min-w-control`, `rounded-control`          |
| Foco                   | `--focus-ring`, `--focus-width`, `--focus-offset` | Estilos compartidos de foco visible                          |
| Movimiento y elevación | `--duration-fast`, `--elevation-menu`             | Duración compartida, `shadow-dropdown`                       |

El alto contraste modifica los tokens en `.high-contrast`; evita colores literales que impidan esa adaptación. Cian y Ámbar identifican bandos, no éxito y error. Los controles seleccionados añaden indicadores o bordes, además de color.

Tailwind se carga **sin Preflight**. Declara los bordes, fondos y márgenes necesarios en cada nuevo control; no supongas que existe un reset global. No uses `--radius` del panel cuando corresponda el radio de un control.

## Acciones

`Button` siempre renderiza un `<button>` y utiliza `type="button"` por defecto. Para enviar un formulario, indica `type="submit"`. Para navegar, usa un enlace nativo: no hay `asChild` ni una variante de botón que simule enlaces.

| Prop                                      | Uso                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `variant="secondary"`                     | Valor por defecto; cancelar, volver y acciones secundarias            |
| `variant="primary"`                       | Acción principal del contexto                                         |
| `variant="ghost"`                         | Acciones auxiliares de menor énfasis                                  |
| `variant="danger"`                        | Acción destructiva cuyo texto explica la consecuencia                 |
| `size="default"` / `"compact"` / `"icon"` | Espaciado; todos mantienen el mínimo táctil. IconButton aplica `icon` |
| `loading`                                 | Desactiva el botón, comunica `aria-busy` y conserva su texto          |

```tsx
<Button variant="primary" type="submit" loading={saving}>
  {saving ? 'Guardando partida' : 'Guardar partida'}
</Button>
<Button onClick={onCancel}>Cancelar</Button>
<IconButton label="Cerrar configuración" onClick={onClose}>×</IconButton>
```

`IconButton` exige `label`, que se convierte en su nombre accesible. Sus hijos son decorativos para el lector de pantalla. El control tiene un objetivo mínimo de 44 px, fija el tamaño `icon` y no acepta `size`. No dependas de `title` para explicar una acción ni desactives controles sin que el contexto permita entender el motivo.

## Campos, ayuda y errores

`Field` compone **un solo control** con su etiqueta y sus mensajes. Genera un ID estable o acepta `controlId`; centraliza `disabled`, `required` e `invalid`.

- `FieldLabel` conecta la etiqueta con el ID del campo. Fuera de `Field`, acepta `htmlFor` para un control existente.
- `FieldControl` exige un único elemento React que reenvíe atributos y `ref` al control final. No admite fragmentos, varios hijos ni contenedores intermedios.
- `FieldDescription` registra la ayuda en `aria-describedby`.
- `FieldError` con contenido registra el error, marca el campo inválido y lo anuncia con `role="alert"`. Con contenido vacío o `null` no se renderiza.

El ID de `Field` prevalece sobre el del hijo; define `controlId` en el padre si necesitas una referencia externa. Las descripciones existentes se conservan y se combinan sin duplicarlas. Los estados `disabled`, `required` e `invalid` del padre no pueden anularse desde el hijo.

El formulario decide **cuándo validar**, qué mensaje mostrar y dónde colocar el foco tras un envío fallido. `Field` no valida datos, no añade un asterisco de obligatoriedad ni guarda estado del valor.

```tsx
const [name, setName] = useState('');
const [submitted, setSubmitted] = useState(false);
const nameRef = useRef<HTMLInputElement>(null);
const error = submitted && !name.trim();

return (
  <form
    noValidate
    onSubmit={(event) => {
      event.preventDefault();
      setSubmitted(true);
      if (!name.trim()) {
        nameRef.current?.focus();
        return;
      }
      onSave(name.trim());
    }}
  >
    <Field controlId="match-name" required>
      <FieldLabel>Nombre de la partida (obligatorio)</FieldLabel>
      <FieldControl>
        <Input
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </FieldControl>
      <FieldDescription>Usa un nombre que reconozcas en el historial.</FieldDescription>
      <FieldError>{error ? 'Escribe un nombre para guardar la partida.' : null}</FieldError>
    </Field>
    <Button type="submit" variant="primary">
      Guardar partida
    </Button>
  </form>
);
```

`Input` y `Textarea` preservan sus props nativas; `Input` usa `type="text"` por defecto y `Textarea` empieza con cuatro filas y permite redimensionar verticalmente. Proporciona siempre etiqueta visible, `autoComplete` e `inputMode` cuando correspondan. El placeholder complementa la etiqueta. Para varios controles relacionados usa `<fieldset>` y `<legend>`.

## Elección y preferencias

`Checkbox` usa Radix, acepta `checked`, `defaultChecked`, `onCheckedChange`, `disabled`, `required` y `name`. Su estado puede ser `true`, `false` o `'indeterminate'`. Incluye una marca o una raya; no admite hijos ni `asChild`.

```tsx
<Field className="grid-cols-[44px_auto] items-center justify-start">
  <FieldControl>
    <Checkbox checked={sound} onCheckedChange={(value) => setSound(value === true)} />
  </FieldControl>
  <FieldLabel>Activar sonido</FieldLabel>
</Field>
```

Usa `RadioGroup` para opciones excluyentes visibles. `RadioGroupItem` incluye indicador, acepta `variant="default"` o `"card"` y hace clicable toda la opción. Su contenido puede ser rico, pero no puede incluir botones, enlaces ni otros controles. Cada grupo necesita nombre accesible; cada opción, un `value` único.

```tsx
<RadioGroup aria-label="Modo de partida" value={mode} onValueChange={onModeChange}>
  <RadioGroupItem value="local">Dos jugadores</RadioGroupItem>
  <RadioGroupItem value="machine">Individual vs. IA</RadioGroupItem>
</RadioGroup>
```

Para valores de dominio, valida el `string` recibido contra el catálogo real antes de actualizar una unión TypeScript, como hace `ConfigDialog` con `MATCH_PRESETS`. No fuerces el tipo con un cast. En tarjetas descriptivas, usa `aria-labelledby` para el título y `aria-describedby` para el detalle.

`GameSelect` se mantiene para listas cortas en formularios. Recibe `inputId`, `options`, `value`, `onChange`, `describedBy` y `disabled`. Asocia una etiqueta mediante `htmlFor={inputId}` y una ayuda mediante `describedBy`. **No lo envuelvas en `FieldControl`**: su API no reenvía esos atributos directamente al input interno. Conserva `unstyled`, los mensajes en español y la ausencia de búsqueda y borrado.

## Pestañas

Compón `Tabs`, `TabsList`, `TabsTrigger` y `TabsContent`. Cada trigger y su panel comparten `value`; la lista requiere `aria-label` o `aria-labelledby`.

```tsx
<Tabs defaultValue="overview">
  <TabsList aria-label="Información de la partida" className="flex gap-2">
    <TabsTrigger value="overview">Resumen</TabsTrigger>
    <TabsTrigger value="history">Historial</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">Resumen de la partida.</TabsContent>
  <TabsContent value="history">Órdenes realizadas.</TabsContent>
</Tabs>
```

Radix gestiona selección, IDs, relaciones ARIA y foco entre pestañas. La activación es automática por defecto; `activationMode="manual"` sirve si activar el panel tiene latencia apreciable. Ajusta `orientation` al layout visible; cambiar solo el CSS no actualiza la navegación de teclado.

No uses pestañas para enlaces a páginas distintas. Si necesitas `forceMount` para conservar paneles, oculta los inactivos y detén sus animaciones, observadores y trabajo de Canvas. El manual conserva nodos de panel para las relaciones ARIA y monta las demostraciones solo en el activo.

## Diálogos y portales

El sistema conserva el `<dialog>` nativo de `DialogHost` en `src/app/app.tsx`. El host gestiona `showModal()`, el título accesible, el cierre, el bloqueo del fondo y la devolución del foco. Los contenidos ejecutan los comandos de sesión existentes; no crean un segundo modal ni una trampa de foco adicional.

Los menús de `GameSelect` se montan dentro del diálogo más cercano. Un portal a `document.body` queda fuera del ámbito modal y puede resultar inerte. Aplica el mismo contrato a futuros popovers o menús de Radix: permite elegir su contenedor y mantenlo dentro del modal. Escape cierra primero el menú abierto y después el diálogo, respetando las excepciones del host, como el relevo obligatorio entre jugadores.

## Accesibilidad y extensión

- Conserva el recorrido por Tab. Las flechas recorren radios y pestañas; Espacio cambia una casilla. No dupliques estos manejadores con listeners manuales.
- Mantén un objetivo de interacción mínimo de 44 px, foco visible y estados distinguibles sin depender del color.
- Comprueba `.high-contrast`, `forced-colors: active`, `.reduced-motion` y `prefers-reduced-motion`. La preferencia de movimiento debe alcanzar también los efectos propios de cada pantalla.
- Añade variantes solo cuando representen una intención compartida. Un layout específico puede quedarse en su pantalla: no necesita convertirse en un componente genérico.
- Usa semántica nativa cuando resuelva el comportamiento. Añade un primitivo Radix cuando ahorre gestión de foco, teclado o estados compuestos.
- Al extender un control, añade su ejemplo y estados al catálogo. Verifica el comportamiento observable, incluidos los casos desactivados y los errores; evita pruebas que solo repitan clases CSS.

## Catálogo y comprobaciones

Ejecuta `pnpm dev` y abre [el catálogo local](http://localhost:5173/design-system.html). Si Vite utiliza otro puerto, conserva la ruta `/design-system.html`. El catálogo permite probar controles, validación, preferencias y teclado; sus cambios son temporales y no modifican la partida. Es una entrada de desarrollo separada y queda fuera del build de producción predeterminado.

```bash
pnpm test:design-system
pnpm test:types
pnpm lint
pnpm test:ui
pnpm test:a11y
```

Estos comandos son la pauta de comprobación, no un registro de resultados. Inspecciona también la integración real en escritorio (1440×900) y móvil (390×844). Un catálogo correcto no demuestra por sí solo que funcionen los diálogos, el scroll o los menús del juego. Los cambios de lógica o configuración requieren además `pnpm test` y `pnpm build` según las instrucciones del repositorio.
