import { batch, cell } from './reactive.js';
import type { Cell, Readable } from './reactive.js';
import type { Props } from './view.js';

export type FormValues = Record<string, string | boolean>;
export type FormErrors<T> = Partial<Record<keyof T, readonly string[]>>;
type WidenField<T> = T extends boolean ? boolean : string;
export type FormShape<T extends FormValues> = {
  [K in keyof T]: WidenField<T[K]>;
};
export interface Form<T extends FormValues> {
  readonly fields: { [K in keyof T]: Cell<T[K]> };
  readonly errors: Readable<FormErrors<T>>;
  readonly touched: Readable<Partial<Record<keyof T, boolean>>>;
  readonly submitting: Readable<boolean>;
  values(): T;
  validate(): boolean;
  touch(name: keyof T): void;
  reset(values?: T): void;
  input(name: keyof T): Props;
  submit(handler: (values: T) => void | Promise<void>): Promise<boolean>;
}
export function createForm<T extends FormValues>(
  initial: T,
  validator: (values: FormShape<T>) => FormErrors<FormShape<T>> = () => ({}),
): Form<FormShape<T>> {
  return buildForm(initial as FormShape<T>, validator);
}
function buildForm<T extends FormValues>(
  initial: T,
  validator: (values: T) => FormErrors<T>,
): Form<T> {
  initial = { ...initial };
  const names = Object.keys(initial) as (keyof T & string)[];
  if (names.some((name) => !['string', 'boolean'].includes(typeof initial[name]))) {
    throw new TypeError('Form fields must contain strings or booleans.');
  }
  const fields = Object.create(null) as Form<T>['fields'];
  for (const name of names) fields[name] = cell(initial[name]);
  const errors = cell<FormErrors<T>>({});
  const touched = cell<Partial<Record<keyof T, boolean>>>({});
  const submitting = cell(false);
  const requireField = (name: keyof T): void => {
    if (!Object.hasOwn(fields, name)) throw new TypeError(`Unknown form field: ${String(name)}.`);
  };
  const values = (): T => {
    const result = { ...initial };
    for (const name of names) result[name] = fields[name].get();
    return result;
  };
  const form: Form<T> = {
    fields,
    errors: { get: errors.get },
    touched: { get: touched.get },
    submitting: { get: submitting.get },
    values,
    validate() {
      const result = validator(values());
      for (const [name, messages] of Object.entries(result)) {
        requireField(name);
        if (!Array.isArray(messages) || messages.some((message) => typeof message !== 'string')) {
          throw new TypeError('Validation errors must be arrays of strings.');
        }
      }
      errors.set(result);
      return Object.values(result).every((messages) => !messages?.length);
    },
    touch(name) {
      requireField(name);
      touched.set({ ...touched.get(), [name]: true });
    },
    reset(next = initial) {
      if (submitting.get()) throw new Error('Cannot reset a form while submitting.');
      if (
        Object.keys(next).length !== names.length ||
        names.some(
          (name) => !Object.hasOwn(next, name) || typeof next[name] !== typeof initial[name],
        )
      ) {
        throw new TypeError('Reset values must have the original field names and types.');
      }
      batch(() => {
        for (const name of names) fields[name].set(next[name]);
        errors.set({});
        touched.set({});
      });
    },
    input(name) {
      requireField(name);
      const checkbox = typeof initial[name] === 'boolean';
      return {
        name: String(name),
        ...(checkbox
          ? { type: 'checkbox', checked: fields[name].get }
          : { value: fields[name].get }),
        on: {
          [checkbox ? 'change' : 'input'](event: Event) {
            const target = event.currentTarget;
            if (!target || !('value' in target) || !('checked' in target))
              throw new TypeError('Form bindings require input elements.');
            const value = checkbox ? target.checked : target.value;
            fields[name].set(value as T[keyof T]);
          },
          blur() {
            form.touch(name);
            form.validate();
          },
        },
      };
    },
    async submit(handler) {
      if (submitting.get()) throw new Error('Form submission already in progress.');
      touched.set(
        Object.fromEntries(names.map((name) => [name, true])) as Partial<Record<keyof T, boolean>>,
      );
      if (!form.validate()) return false;
      submitting.set(true);
      try {
        await handler(values());
        return true;
      } finally {
        submitting.set(false);
      }
    },
  };
  return form;
}
