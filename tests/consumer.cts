import { cell, h, renderToString, createForm, createResource } from '@lp-labs/scenes';
const value = cell(1);
const html: string = renderToString(h('b', null, () => value.get()));
const form = createForm({ name: '' });
const name: string = form.fields.name.get();
const resource = createResource(async (key: string) => key.length);
void html;
void name;
void resource;
// @ts-expect-error setter type is preserved through require declarations
value.set(false);
