import { hydrate } from '@lp-labs/scenes';
import { createApplication } from './app.js';

const root = document.querySelector('#app');
const seed = JSON.parse(document.querySelector('#seed').textContent);
const { view, router } = createApplication(seed);
const app = hydrate(view, root);
const disconnect = router.connect(window);
root.dataset.hydrated = 'true';
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    disconnect();
    app.unmount();
  }
});
