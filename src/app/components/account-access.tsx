import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useAccount } from '../account-context';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';

const NEW_PASSWORD_RULES = [
  { label: 'Al menos 8 caracteres', pattern: /.{8,}/u },
  { label: 'Una letra minúscula', pattern: /[a-z]/ },
  { label: 'Una letra mayúscula', pattern: /[A-Z]/ },
  { label: 'Un número', pattern: /[0-9]/ },
  { label: 'Un símbolo', pattern: /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/ },
];
const NEW_PASSWORD_PATTERN =
  NEW_PASSWORD_RULES.map(({ pattern }) => `(?=.*${pattern.source})`).join('') + '.*';
const NEW_PASSWORD_HINT =
  'Al menos 8 caracteres, una minúscula, una mayúscula, un número y un símbolo.';

export function OnlineAccountNotice() {
  return (
    <small className="online-account-requirement">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" strokeLinecap="round" />
      </svg>
      Requiere cuenta · Inicia sesión o regístrate
    </small>
  );
}

export function AccountStatus() {
  const { account, controller } = useAccount();
  return (
    <div className="grid gap-2 text-sm leading-relaxed" data-account-status>
      {account.user ? (
        <>
          <span className="break-all text-muted">{account.user.email}</span>
          <span role="status">
            {account.sync === 'saved'
              ? 'Progreso guardado en la nube'
              : account.sync === 'saving'
                ? 'Guardando en la nube…'
                : account.sync === 'pending'
                  ? 'Cambios pendientes de guardar'
                  : account.sync === 'conflict'
                    ? 'Hay dos versiones de tu progreso'
                    : 'Guardado en la nube sin conexión'}
          </span>
          {account.syncError && (
            <p className="m-0 text-danger" role="alert">
              {account.syncError}
            </p>
          )}
          {account.error && (
            <p className="m-0 text-danger" role="alert">
              {account.error}
            </p>
          )}
          {account.sync === 'conflict' ? (
            <div className="flex flex-wrap gap-2">
              <Button size="compact" onClick={() => void controller.resolveConflict('cloud')}>
                Conservar la nube
              </Button>
              <Button size="compact" onClick={() => void controller.resolveConflict('device')}>
                Conservar este dispositivo
              </Button>
            </div>
          ) : (
            account.sync === 'offline' && (
              <Button size="compact" onClick={controller.retry}>
                Reintentar guardado
              </Button>
            )
          )}
          <Button
            size="compact"
            variant="ghost"
            loading={account.busy}
            onClick={() => void controller.signOut()}
          >
            Cerrar sesión
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted">Invitado · Progreso guardado en este navegador</span>
          <div className="flex flex-wrap gap-2">
            <Button size="compact" onClick={() => controller.open('signin')}>
              Iniciar sesión
            </Button>
            <Button size="compact" variant="primary" onClick={() => controller.open('signup')}>
              Crear cuenta
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function isOutsideDialog(dialog: HTMLDialogElement, x: number, y: number) {
  const bounds = dialog.getBoundingClientRect();
  return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
}

export function AccountDialog() {
  const { account, controller } = useAccount();
  const [email, setEmail] = useState('');
  const mode = account.dialog;
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const backdropStart = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const confirmation = Boolean(account.message && (mode === 'signup' || mode === 'recover'));

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (mode) {
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
      if (confirmation) headingRef.current?.focus({ preventScroll: true });
      else
        dialog
          .querySelector<HTMLInputElement>('input:not([type="hidden"])')
          ?.focus({ preventScroll: true });
    } else if (dialog.open) dialog.close();
  }, [mode, confirmation]);

  const title = confirmation
    ? 'Revisa tu correo'
    : mode === 'signup'
      ? 'Crear cuenta'
      : mode === 'recover'
        ? 'Recuperar contraseña'
        : mode === 'password'
          ? 'Nueva contraseña'
          : 'Iniciar sesión';
  const description = confirmation
    ? account.message
    : mode === 'recover'
      ? 'Introduce tu correo para recuperar el acceso a tu cuenta.'
      : mode === 'password'
        ? 'Elige una contraseña nueva para tu cuenta.'
        : mode === 'signup'
          ? 'Crea tu cuenta para jugar en línea y guardar tu progreso.'
          : 'Juega en línea y guarda tu progreso en la nube.';

  return (
    <dialog
      ref={ref}
      hidden={!mode}
      data-account-dialog
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        controller.close();
      }}
      onPointerDown={(event) => {
        backdropStart.current =
          event.target === event.currentTarget &&
          isOutsideDialog(event.currentTarget, event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          backdropStart.current &&
          isOutsideDialog(event.currentTarget, event.clientX, event.clientY)
        )
          controller.close();
        backdropStart.current = false;
      }}
      className="account-dialog fixed left-1/2 top-1/2 m-0 max-h-[calc(100dvh-24px)] w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-solid border-line-strong bg-panel p-0 text-ink"
    >
      <div className="relative px-6 pt-7 pb-4 sm:px-8 sm:pt-8 sm:pb-5">
        <header className="mb-6">
          <h2
            ref={headingRef}
            tabIndex={-1}
            id={titleId}
            className="m-0 pr-10 font-heading text-2xl leading-tight focus:outline-none"
          >
            {title}
          </h2>
          <p
            id={descriptionId}
            role={confirmation ? 'status' : undefined}
            className="mt-3 mb-0 text-sm leading-relaxed text-muted"
          >
            {description}
          </p>
        </header>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Cerrar acceso a cuenta"
          className="absolute right-3 top-3"
          onClick={controller.close}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </Button>
        {!account.available ? (
          <p className="text-sm leading-relaxed text-muted">
            El acceso a cuentas aún no está configurado. Puedes jugar como invitado.
          </p>
        ) : confirmation ? (
          <Button
            variant="primary"
            className="h-12 w-full"
            onClick={() => controller.open('signin')}
          >
            Volver a iniciar sesión
          </Button>
        ) : mode ? (
          <AccountForm key={mode} email={email} onEmailChange={setEmail} />
        ) : null}
        <footer
          hidden={Boolean(account.user) && mode === 'password'}
          className="mt-6 border-0 border-t border-solid border-line pt-3 text-center"
        >
          {!confirmation && (mode === 'signin' || mode === 'signup') && (
            <div className="flex flex-wrap items-center justify-center gap-x-1 text-sm text-muted">
              {mode === 'signin' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
              <Button
                size="compact"
                variant="ghost"
                className="px-2 text-accent"
                disabled={account.busy}
                onClick={() => controller.open(mode === 'signin' ? 'signup' : 'signin')}
              >
                {mode === 'signin' ? 'Crear cuenta' : 'Iniciar sesión'}
              </Button>
            </div>
          )}
          {!confirmation && mode === 'recover' && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={account.busy}
              onClick={() => controller.open('signin')}
            >
              Volver a iniciar sesión
            </Button>
          )}
          {!account.user && (
            <Button
              variant="ghost"
              className="w-full font-normal text-muted"
              onClick={controller.close}
            >
              Seguir como invitado
            </Button>
          )}
        </footer>
      </div>
    </dialog>
  );
}

function AccountForm({
  email,
  onEmailChange,
}: {
  email: string;
  onEmailChange: (value: string) => void;
}) {
  const { account, controller } = useAccount();
  const mode = account.dialog;
  const [password, setPassword] = useState('');
  const [passwordEdited, setPasswordEdited] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [importGuest, setImportGuest] = useState(true);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const creatingPassword = mode === 'signup' || mode === 'password';
  useLayoutEffect(() => {
    if (account.error) errorRef.current?.focus({ preventScroll: true });
  }, [account.error]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const operation =
          mode === 'signup'
            ? controller.signUp(email, password, importGuest)
            : mode === 'recover'
              ? controller.recover(email)
              : mode === 'password'
                ? controller.password(password)
                : controller.signIn(email, password);
        void operation.then(() => {
          if (!controller.getSnapshot().error) {
            setPassword('');
            setPasswordEdited(false);
          }
        });
      }}
    >
      <fieldset disabled={account.busy} className="m-0 grid min-w-0 gap-5 border-0 p-0">
        {mode !== 'password' && (
          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="account-email">
              Correo electrónico
            </label>
            <Input
              id="account-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              required
              maxLength={254}
              className="h-12"
            />
          </div>
        )}
        {mode !== 'recover' && (
          <div className="grid gap-2">
            <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-2">
              <label className="text-sm font-semibold" htmlFor="account-password">
                Contraseña
              </label>
              {mode === 'signin' && (
                <Button
                  size="compact"
                  variant="ghost"
                  className="px-0 text-xs font-normal text-accent"
                  onClick={() => controller.open('recover')}
                >
                  ¿Olvidaste tu contraseña?
                </Button>
              )}
            </div>
            <div className="relative">
              <Input
                id="account-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={creatingPassword ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => {
                  event.target.setCustomValidity('');
                  setPassword(event.target.value);
                  setPasswordEdited(true);
                }}
                onInvalid={(event) => {
                  if (creatingPassword && event.currentTarget.value)
                    event.currentTarget.setCustomValidity(NEW_PASSWORD_HINT);
                }}
                required
                minLength={creatingPassword ? 8 : 1}
                pattern={creatingPassword ? NEW_PASSWORD_PATTERN : undefined}
                title={creatingPassword ? NEW_PASSWORD_HINT : undefined}
                maxLength={128}
                aria-describedby={creatingPassword ? 'account-password-hint' : undefined}
                className="h-12 pr-12"
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-0.5 right-0.5"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPassword && <path d="m3 3 18 18" />}
                </svg>
              </Button>
            </div>
            {creatingPassword && (
              <ul
                id="account-password-hint"
                aria-label="Requisitos de la contraseña"
                aria-live="polite"
                className="m-0 grid list-none gap-1.5 p-0 text-xs leading-relaxed"
              >
                {NEW_PASSWORD_RULES.map(({ label, pattern }) => {
                  const met = pattern.test(password);
                  return (
                    <li
                      key={label}
                      className={`flex items-start gap-2 ${!passwordEdited ? 'text-muted' : met ? 'text-green-400' : 'text-red-400'}`}
                    >
                      <span aria-hidden="true" className="w-3 shrink-0 text-center font-bold">
                        {!passwordEdited ? '•' : met ? '✓' : '✕'}
                      </span>
                      <span>
                        {passwordEdited && (
                          <span className="sr-only">{met ? 'Cumplido: ' : 'Pendiente: '}</span>
                        )}
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {mode === 'signup' && (
          <div className="flex items-start gap-3">
            <Checkbox
              id="account-import"
              checked={importGuest}
              onCheckedChange={(value) => setImportGuest(value === true)}
              aria-describedby="account-import-hint"
            />
            <div className="text-sm leading-relaxed">
              <label htmlFor="account-import">Importar mi progreso de invitado</label>
              <p id="account-import-hint" className="mt-1 mb-0 text-xs text-muted">
                La copia de este navegador se conservará.
              </p>
            </div>
          </div>
        )}
        {account.error && (
          <p
            ref={errorRef}
            tabIndex={-1}
            className="m-0 text-sm leading-relaxed text-danger focus:outline-none"
            role="alert"
          >
            {account.error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={account.busy} className="h-12 w-full">
          {mode === 'recover'
            ? 'Enviar enlace'
            : mode === 'password'
              ? 'Guardar contraseña'
              : mode === 'signup'
                ? 'Crear cuenta'
                : 'Iniciar sesión'}
        </Button>
      </fieldset>
    </form>
  );
}
