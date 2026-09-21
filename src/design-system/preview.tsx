import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '../app/components/ui/button';
import { Checkbox } from '../app/components/ui/checkbox';
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '../app/components/ui/field';
import { Input, Textarea } from '../app/components/ui/input';
import { RadioGroup, RadioGroupItem } from '../app/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../app/components/ui/tabs';
import { GameSelect } from '../app/components/game-select';
import '../styles.css';
import './preview.css';

export function DesignSystemPreview() {
  const [contrast, setContrast] = useState(false);
  const [motion, setMotion] = useState(false);
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [choice, setChoice] = useState('local');
  const [side, setSide] = useState<'cyan' | 'amber'>('cyan');
  const [tab, setTab] = useState('tokens');
  const [indeterminate, setIndeterminate] = useState<boolean | 'indeterminate'>('indeterminate');
  const nameRef = useRef<HTMLInputElement>(null);
  const error = submitted && !name.trim();

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', contrast);
    document.documentElement.classList.toggle('reduced-motion', motion);
    return () => document.documentElement.classList.remove('high-contrast', 'reduced-motion');
  }, [contrast, motion]);

  return (
    <main className="ds-preview mx-auto grid max-w-5xl gap-10 px-5 py-10 sm:px-10">
      <header className="grid gap-3">
        <a href="/" className="w-fit text-accent underline underline-offset-4">
          Volver al juego
        </a>
        <h1 className="m-0 font-heading text-3xl leading-tight text-ink sm:text-4xl">
          Sistema de diseño
        </h1>
        <p className="m-0 max-w-prose text-base leading-relaxed text-muted">
          Protocolo Hexagonal. Componentes, estados y comportamiento compartidos por la interfaz.
        </p>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <Field className="grid-cols-[44px_auto] items-center justify-start">
            <FieldControl>
              <Checkbox
                checked={contrast}
                onCheckedChange={(value) => setContrast(value === true)}
              />
            </FieldControl>
            <FieldLabel>Alto contraste</FieldLabel>
          </Field>
          <Field className="grid-cols-[44px_auto] items-center justify-start">
            <FieldControl>
              <Checkbox checked={motion} onCheckedChange={(value) => setMotion(value === true)} />
            </FieldControl>
            <FieldLabel>Reducir movimiento</FieldLabel>
          </Field>
        </div>
      </header>

      <section
        aria-labelledby="actions-title"
        className="grid gap-4 border-0 border-t border-solid border-line pt-6"
      >
        <h2 id="actions-title" className="m-0 font-heading text-2xl">
          Acciones
        </h2>
        <p className="m-0 text-sm text-muted">
          Una acción principal por contexto. Las acciones destructivas nombran su consecuencia.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setSaved(true)}>
            Guardar cambios
          </Button>
          <Button onClick={() => setSaved(false)}>Cancelar</Button>
          <Button variant="ghost" onClick={() => nameRef.current?.focus()}>
            Editar nombre
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setName('');
              setSaved(false);
            }}
          >
            Borrar borrador
          </Button>
          <IconButton
            label="Restablecer formulario"
            onClick={() => {
              setName('');
              setSubmitted(false);
              setSaved(false);
            }}
          >
            ↺
          </IconButton>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled>Sin partida guardada</Button>
          <Button loading>Guardando partida</Button>
          <Button size="compact" onClick={() => nameRef.current?.focus()}>
            Acción compacta
          </Button>
        </div>
        <p role="status" className="m-0 min-h-6 text-sm text-accent">
          {saved ? 'Cambios guardados en esta demostración.' : ''}
        </p>
      </section>

      <section
        aria-labelledby="fields-title"
        className="grid gap-4 border-0 border-t border-solid border-line pt-6"
      >
        <h2 id="fields-title" className="m-0 font-heading text-2xl">
          Campos y validación
        </h2>
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            setSaved(Boolean(name.trim()));
            if (!name.trim()) nameRef.current?.focus();
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field required controlId="sample-name">
              <FieldLabel>Nombre de la partida (obligatorio)</FieldLabel>
              <FieldControl>
                <Input
                  ref={nameRef}
                  aria-describedby="sample-name-external"
                  value={name}
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                    setSaved(false);
                  }}
                  autoComplete="off"
                />
              </FieldControl>
              <FieldDescription>
                Usa un nombre que puedas reconocer en el historial.
              </FieldDescription>
              <FieldError>{error ? 'Escribe un nombre para guardar la partida.' : null}</FieldError>
            </Field>
            <Field disabled>
              <FieldLabel>Perfil local</FieldLabel>
              <FieldControl>
                <Input value="Comandante" readOnly />
              </FieldControl>
              <FieldDescription>Este campo está desactivado en la demostración.</FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel>Notas tácticas</FieldLabel>
            <FieldControl>
              <Textarea placeholder="Describe tu siguiente objetivo…" />
            </FieldControl>
            <FieldDescription>
              Opcional. Las notas solo se conservan mientras esta página está abierta.
            </FieldDescription>
          </Field>
          <p id="sample-name-external" className="m-0 text-sm text-muted">
            El nombre se usa solo en esta demostración.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" type="submit">
              Validar formulario
            </Button>
            <Button onClick={() => nameRef.current?.focus()}>Revisar nombre</Button>
          </div>
        </form>
      </section>

      <section
        aria-labelledby="choices-title"
        className="grid gap-5 border-0 border-t border-solid border-line pt-6"
      >
        <h2 id="choices-title" className="m-0 font-heading text-2xl">
          Elección y preferencias
        </h2>
        <RadioGroup
          aria-label="Modo de partida"
          value={choice}
          onValueChange={setChoice}
          className="sm:grid-cols-3"
        >
          <RadioGroupItem value="local" variant="card">
            Dos jugadores
          </RadioGroupItem>
          <RadioGroupItem value="machine" variant="card">
            Individual vs. IA
          </RadioGroupItem>
          <RadioGroupItem value="online" variant="card" disabled>
            En línea · no disponible
          </RadioGroupItem>
        </RadioGroup>
        <Field className="grid-cols-[44px_auto] items-center justify-start">
          <FieldControl>
            <Checkbox checked={indeterminate} onCheckedChange={setIndeterminate} />
          </FieldControl>
          <FieldLabel>Selección parcial</FieldLabel>
        </Field>
        <div className="grid max-w-sm gap-2">
          <FieldLabel htmlFor="sample-side">Bando</FieldLabel>
          <GameSelect
            inputId="sample-side"
            options={[
              { value: 'cyan', label: 'Cian' },
              { value: 'amber', label: 'Ámbar' },
            ]}
            value={side}
            onChange={setSide}
          />
        </div>
      </section>

      <section
        aria-labelledby="tabs-title"
        className="grid gap-4 border-0 border-t border-solid border-line pt-6"
      >
        <h2 id="tabs-title" className="m-0 font-heading text-2xl">
          Pestañas y fundamentos
        </h2>
        <Tabs value={tab} onValueChange={setTab} className="grid gap-5">
          <TabsList aria-label="Fundamentos" className="flex flex-wrap gap-2">
            <TabsTrigger value="tokens">Color y forma</TabsTrigger>
            <TabsTrigger value="keyboard">Teclado</TabsTrigger>
            <TabsTrigger value="future" disabled>
              Próximamente
            </TabsTrigger>
          </TabsList>
          <TabsContent value="tokens" className="grid gap-4">
            <p className="m-0 text-sm leading-relaxed text-muted">
              Cian y Ámbar identifican a los jugadores. El acento distingue acciones; texto, formas
              e indicadores completan el color.
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-5 p-0">
              {[
                ['Cian', 'bg-cyan'],
                ['Ámbar', 'bg-amber'],
                ['Acción', 'bg-accent'],
                ['Peligro', 'bg-danger'],
              ].map(([label, color]) => (
                <li key={label} className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true" className={`size-5 rounded ${color}`} />
                  {label}
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="keyboard">
            <p className="m-0 max-w-prose text-sm leading-relaxed text-muted">
              Tab recorre los controles. Las flechas recorren las opciones y pestañas. Espacio
              cambia las casillas. El foco siempre permanece visible.
            </p>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
