import {
  cell,
  derive,
  effect,
  batch,
  untrack,
  createScope,
  onCleanup,
  context,
  provide,
  inject,
  h,
  scene,
  when,
  each,
  mount,
  hydrate,
  renderToString,
  createRouter,
  matchRoute,
  createForm,
  createResource,
} from '@lp-labs/scenes';
import type { View, Props, Readable, ResourceState, FormErrors, FormValues } from '@lp-labs/scenes';

const count = cell(0);
const double: Readable<number> = derive(() => count.get() * 2);
const token = context('light');
const scope = createScope(() => {
  provide(token, 'dark');
  const theme: string = inject(token);
  const stop = effect(() => {
    void theme;
    void double.get();
  });
  onCleanup(stop);
  batch(() => {
    count.set(1);
    count.update((value) => value + 1);
  });
  return untrack(count.get);
});
scope.dispose();
const props: Props = {
  class: () => 'counter',
  on: {
    click: (event) => {
      event.preventDefault();
    },
  },
};
const view: View = scene(() =>
  h(
    'main',
    props,
    () => count.get(),
    when(
      () => count.get() > 0,
      () => 'positive',
    ),
    each(
      () => [{ id: 1 }],
      (row) => row.id,
      (row, index) => h('p', null, () => row.get().id + index.get()),
    ),
  ),
);
const router = createRouter('/users/1');
router.navigate('/users/2', { replace: true });
const match = matchRoute('/users/:id', router.path.get());
void match?.params['id'];
renderToString(router.outlet([{ path: '/', view: () => router.link('/', nullProps(), 'Home') }]));
function nullProps(): Props {
  return {};
}
const form = createForm({ email: '', enabled: false }, (values) => {
  const errors: FormErrors<typeof values> = {};
  if (!values.email) errors.email = ['Required'];
  return errors;
});
const dynamicForm = createForm<FormValues>({ flag: true, text: '' });
dynamicForm.fields['flag']!.set(false);
dynamicForm.fields['text']!.set('updated');
form.fields.email.set('hello');
form.fields.enabled.set(true);
void form.input('email');
void form.submit(async (values) => {
  values.email.toUpperCase();
});
const resource = createResource(async (id: number, signal) => {
  signal.throwIfAborted();
  return { id };
});
const state: ResourceState<{ id: number }> = resource.state.get();
if (state.status === 'ready') state.data.id.toFixed();
void resource.load(1);
resource.dispose();
declare const element: Element;
mount(view, element).unmount();
hydrate(view, element).unmount();
// @ts-expect-error a numeric cell does not accept strings
count.set('1');
// @ts-expect-error read-only computed values have no setter
double.set(3);
// @ts-expect-error form keys are checked
form.input('missing');
// @ts-expect-error a boolean field does not accept strings
form.fields.enabled.set('true');
// @ts-expect-error resource keys are checked
resource.load('1');
