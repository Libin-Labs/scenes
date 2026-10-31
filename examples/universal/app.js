import { cell, scene, h, each, createRouter, createForm } from '@lp-labs/scenes';

export function createApplication(seed) {
  const count = cell(seed.count);
  const router = createRouter(seed.path);
  const view = scene(() => {
    const tasks = cell([{ id: 1, title: 'Learn Scenes' }]);
    const message = cell('');
    let nextId = 2;
    const form = createForm({ task: '' }, (values) =>
      values.task.trim() ? {} : { task: ['Enter a task.'] },
    );
    const home = () =>
      h(
        'section',
        null,
        h('h2', null, 'Your first scene'),
        h('button', { on: { click: () => count.update((n) => n + 1) } }, 'Count: ', () =>
          count.get(),
        ),
        h(
          'form',
          {
            on: {
              submit(event) {
                event.preventDefault();
                void form
                  .submit((values) => {
                    tasks.update((rows) => [...rows, { id: nextId++, title: values.task.trim() }]);
                  })
                  .then((valid) => {
                    if (valid) form.reset();
                  })
                  .catch((error) => message.set(String(error)));
              },
            },
          },
          h('label', { for: 'task' }, 'New task'),
          h('input', { ...form.input('task'), id: 'task' }),
          h('button', { type: 'submit', disabled: form.submitting.get }, 'Add task'),
          h('p', { role: 'alert' }, () => (form.errors.get().task ?? []).join(' ')),
        ),
        h('p', { role: 'status' }, message.get),
        h(
          'ul',
          null,
          each(
            tasks.get,
            (task) => task.id,
            (task) =>
              h(
                'li',
                null,
                h('span', null, () => task.get().title),
                h(
                  'button',
                  {
                    type: 'button',
                    on: {
                      click: () =>
                        tasks.update((rows) => rows.filter((row) => row.id !== task.get().id)),
                    },
                  },
                  'Remove',
                ),
              ),
          ),
        ),
      );
    return h(
      'main',
      null,
      h('h1', null, 'Scenes'),
      h(
        'nav',
        { 'aria-label': 'Main navigation' },
        router.link('/', {}, 'Home'),
        ' | ',
        router.link('/about', {}, 'About'),
      ),
      router.outlet([
        { path: '/', view: home },
        {
          path: '/about',
          view: () => h('p', null, 'Explicit state. Owned lifetimes. Direct DOM updates.'),
        },
      ]),
    );
  });
  return { view, router };
}
