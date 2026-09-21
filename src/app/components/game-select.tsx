import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';
import Select, {
  components,
  type AriaLiveMessages,
  type ClassNamesConfig,
  type GroupBase,
  type StylesConfig,
  type ValueContainerProps,
} from 'react-select';

export interface SelectOption<Value extends string | number> {
  value: Value;
  label: string;
}

interface GameSelectProps<Value extends string | number> {
  /** Must match the visible label's htmlFor and be unique in the page. */
  inputId: string;
  options: readonly SelectOption<Value>[];
  value: Value;
  onChange(value: NoInfer<Value>): void;
  describedBy?: string;
  disabled?: boolean;
}

const DescriptionContext = createContext<string | undefined>(undefined);

/** Preserve React Select's live-region description alongside the field's help text. */
function DescribedValueContainer<Option>(props: ValueContainerProps<Option, false>) {
  const describedBy = useContext(DescriptionContext);
  return (
    <components.ValueContainer {...props}>
      {Children.map(props.children, (child) => {
        // The non-searchable input is not exposed through components.Input in React Select.
        if (
          !describedBy ||
          !isValidElement<InputHTMLAttributes<HTMLInputElement>>(child) ||
          child.props.id !== props.selectProps.inputId
        )
          return child;
        return cloneElement(child, {
          'aria-describedby': [child.props['aria-describedby'], describedBy]
            .filter(Boolean)
            .join(' '),
        });
      })}
    </components.ValueContainer>
  );
}

function selectClasses<Value extends string | number>(): ClassNamesConfig<
  SelectOption<Value>,
  false
> {
  return {
    container: () => 'min-w-0 w-full font-ui text-base leading-snug sm:text-sm',
    control: ({ isFocused, isDisabled }) =>
      [
        'rounded-control border border-solid bg-panel text-ink',
        isFocused
          ? 'border-accent ring-2 ring-accent/30'
          : 'border-line-strong hover:border-accent',
        isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ].join(' '),
    valueContainer: () => 'min-w-0 px-3 py-2',
    singleValue: () => 'text-ink',
    placeholder: () => 'text-muted',
    dropdownIndicator: ({ selectProps }) =>
      `px-3 py-2 text-muted ${selectProps.menuIsOpen ? 'rotate-180' : ''}`,
    menu: () =>
      'my-1 overflow-hidden rounded-control border border-solid border-line-strong bg-panel shadow-dropdown',
    menuList: () => 'p-1 overscroll-contain',
    option: ({ isFocused, isSelected, isDisabled }) =>
      [
        'min-h-11 rounded-md px-3 py-3 text-left',
        isSelected ? 'bg-accent/10 font-semibold text-accent' : 'text-ink',
        isFocused ? 'ring-1 ring-inset ring-line-strong bg-panel-hover' : '',
        isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer active:bg-panel-hover',
      ].join(' '),
    noOptionsMessage: () => 'px-3 py-3 text-muted',
  };
}

function selectStyles<Value extends string | number>(): StylesConfig<SelectOption<Value>, false> {
  return {
    // Keep geometry from React Select; presentation comes from Tailwind and game tokens.
    control: (base) => ({ ...base, cursor: undefined, transition: undefined }),
    option: (base) => ({ ...base, cursor: undefined }),
    dropdownIndicator: (base) => ({ ...base, transition: undefined }),
    menuPortal: (base) => ({ ...base, zIndex: 20 }),
  };
}

function liveMessages<Value extends string | number>(): AriaLiveMessages<
  SelectOption<Value>,
  false,
  GroupBase<SelectOption<Value>>
> {
  return {
    guidance: ({ context }) =>
      context === 'menu'
        ? 'Usa las flechas para recorrer las opciones, Intro para elegir y Escape para cerrar.'
        : 'Pulsa las flechas para abrir las opciones.',
    onChange: ({ label, action }) =>
      action === 'select-option' || action === 'initial-input-focus'
        ? `${label}, seleccionado.`
        : '',
    onFocus: ({ label, isSelected, options, focused }) =>
      `${label}${isSelected ? ', seleccionado' : ''}. Opción ${options.indexOf(focused) + 1} de ${options.length}.`,
    onFilter: ({ resultsMessage }) => resultsMessage,
  };
}

/** Single-choice fields with short lists. The value stays owned by the caller. */
export function GameSelect<Value extends string | number>({
  inputId,
  options,
  value,
  onChange,
  describedBy,
  disabled = false,
}: GameSelectProps<Value>) {
  const container = useRef<HTMLDivElement>(null);
  const [menuIsOpen, setMenuIsOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  return (
    <DescriptionContext.Provider value={describedBy}>
      <div ref={container} className="game-select min-w-0 w-full">
        <Select<SelectOption<Value>, false>
          unstyled
          inputId={inputId}
          instanceId={inputId}
          name={inputId}
          classNamePrefix="game-select"
          options={options}
          value={options.find((option) => option.value === value) ?? null}
          getOptionValue={(option) => String(option.value)}
          onChange={(option) => {
            if (option) onChange(option.value);
          }}
          isDisabled={disabled}
          isSearchable={false}
          isClearable={false}
          blurInputOnSelect={false}
          tabSelectsValue={false}
          closeMenuOnSelect
          menuIsOpen={menuIsOpen}
          onMenuOpen={() => {
            // A body portal would be inert behind a native modal dialog.
            setPortalTarget(container.current?.closest('dialog') ?? document.body);
            setMenuIsOpen(true);
          }}
          onMenuClose={() => setMenuIsOpen(false)}
          menuPortalTarget={portalTarget}
          menuPosition="fixed"
          menuPlacement="auto"
          minMenuHeight={44}
          maxMenuHeight={240}
          menuShouldScrollIntoView={false}
          menuShouldBlockScroll={false}
          onKeyDown={(event) => {
            // React Select consumes Escape even with its menu closed.
            if (event.key !== 'Escape' || menuIsOpen) return;
            const dialog = container.current?.closest('dialog');
            if (!dialog?.open) return;
            event.preventDefault();
            if (typeof dialog.requestClose === 'function') dialog.requestClose();
            else if (dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
              dialog.close();
          }}
          components={{ IndicatorSeparator: null, ValueContainer: DescribedValueContainer }}
          classNames={selectClasses<Value>()}
          styles={selectStyles<Value>()}
          theme={(theme) => ({ ...theme, spacing: { ...theme.spacing, controlHeight: 44 } })}
          placeholder="Selecciona una opción"
          noOptionsMessage={() => 'No hay opciones disponibles'}
          screenReaderStatus={({ count }) => `${count} opciones disponibles.`}
          ariaLiveMessages={liveMessages<Value>()}
          formatOptionLabel={(option, meta) => (
            <span className="flex min-w-0 items-center justify-between gap-3">
              <span className="min-w-0">{option.label}</span>
              {meta.context === 'menu' && (
                <span className="w-4 shrink-0 text-amber" aria-hidden="true">
                  {meta.selectValue.some((selected) => selected.value === option.value) ? '✓' : ''}
                </span>
              )}
            </span>
          )}
        />
      </div>
    </DescriptionContext.Provider>
  );
}
