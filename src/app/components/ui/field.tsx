import { Label, Slot } from 'radix-ui';
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react';
import { cx } from './cx';
import { FieldContext, type FieldContextValue } from './field-context';

export interface FieldProps extends ComponentProps<'div'> {
  /** Set the control's ID here so its label and descriptions always stay connected. */
  controlId?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}

/** One labelled control. Use a native fieldset and legend for groups of controls. */
export function Field({
  controlId,
  disabled = false,
  invalid = false,
  required = false,
  className,
  children,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const [descriptions, setDescriptions] = useState<readonly { id: string; error: boolean }[]>([]);
  const registerDescription = useCallback((id: string, error: boolean) => {
    const entry = { id, error };
    setDescriptions((current) => [...current, entry]);
    return () => setDescriptions((current) => current.filter((item) => item !== entry));
  }, []);
  const context = useMemo<FieldContextValue>(() => {
    const errorIds = descriptions.filter((item) => item.error).map((item) => item.id);
    return {
      controlId: controlId ?? generatedId,
      disabled,
      invalid: invalid || errorIds.length > 0,
      required,
      descriptionIds: descriptions.filter((item) => !item.error).map((item) => item.id),
      errorIds,
      registerDescription,
    };
  }, [controlId, generatedId, disabled, invalid, required, descriptions, registerDescription]);

  return (
    <FieldContext.Provider value={context}>
      <div
        {...props}
        className={cx('ds-field grid min-w-0 gap-2', className)}
        data-disabled={disabled || undefined}
        data-invalid={context.invalid || undefined}
      >
        {children}
      </div>
    </FieldContext.Provider>
  );
}

export function FieldLabel({ className, htmlFor, ...props }: ComponentProps<typeof Label.Root>) {
  const field = useContext(FieldContext);
  return (
    <Label.Root
      {...props}
      htmlFor={field?.controlId ?? htmlFor}
      className={cx(
        'ds-field-label font-ui text-sm font-semibold leading-snug text-ink',
        className,
      )}
      data-disabled={field?.disabled || undefined}
    />
  );
}

type ControlAccessibilityProps = Pick<
  ComponentProps<'input'>,
  'id' | 'aria-describedby' | 'aria-invalid' | 'required' | 'disabled'
>;

export interface FieldControlProps extends ComponentProps<typeof Slot.Root> {
  disabled?: boolean;
  required?: boolean;
}

/** The child must forward its props and ref to a single input or Radix control. */
export function FieldControl({ children, ...props }: FieldControlProps) {
  const field = useContext(FieldContext);
  const child = Children.only(children);
  if (!isValidElement<ControlAccessibilityProps>(child)) return null;

  const describedBy = [
    child.props['aria-describedby'],
    props['aria-describedby'],
    ...(field?.descriptionIds ?? []),
    ...(field?.errorIds ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const controlProps: ControlAccessibilityProps = {
    id: field?.controlId ?? child.props.id ?? props.id,
    'aria-describedby': [...new Set(describedBy)].join(' ') || undefined,
    'aria-invalid': field?.invalid || child.props['aria-invalid'] || props['aria-invalid'],
    disabled: field?.disabled || child.props.disabled || props.disabled,
    required: field?.required || child.props.required || props.required,
  };

  // Slot normally gives the child's props priority. Normalize these shared attributes first
  // so a caller's description is preserved without disconnecting the field's label or error.
  return <Slot.Root {...props}>{cloneElement(child, controlProps)}</Slot.Root>;
}

function FieldMessage({
  error,
  id,
  children,
  className,
  ...props
}: ComponentProps<'p'> & { error: boolean }) {
  const field = useContext(FieldContext);
  const generatedId = useId();
  const messageId = id ?? generatedId;
  const registerDescription = field?.registerDescription;
  const hasContent =
    children !== null && children !== undefined && children !== false && children !== '';

  useLayoutEffect(() => {
    if (hasContent) return registerDescription?.(messageId, error);
  }, [hasContent, registerDescription, messageId, error]);

  if (!hasContent) return null;

  return (
    <p
      {...props}
      id={messageId}
      className={cx(
        'm-0 font-ui text-sm leading-relaxed',
        error ? 'ds-field-error text-danger' : 'ds-field-description text-muted',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function FieldDescription(props: ComponentProps<'p'>) {
  return <FieldMessage {...props} error={false} />;
}

/** Render a concrete correction message only when validation has failed. */
export function FieldError(props: ComponentProps<'p'>) {
  return <FieldMessage role="alert" {...props} error />;
}
