import { createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, h, shallowRef } from 'vue';
import { AcheronGrid as ReactGrid } from '../packages/react/dist/index.js';
import { AcheronGrid as VueGrid } from '../packages/vue/dist/index.js';
import { LocalDataSource } from '@acheron-grid/core';

window.adapters = { react: null, vue: null, events: [], ready: [] };
const options = () => ({ columns: [{ key: 'name', title: 'Name', editable: true }], dataSource: new LocalDataSource([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }], row => row.id), accessibility: 'viewport' });
for (const name of ['react', 'vue']) {
  const host = document.createElement('div'); host.id = name; document.body.append(host);
}
const reactOptions = options();
function ReactDemo() {
  const [props, setProps] = useState({ options: reactOptions });
  window.adapters.updateReact = patch => setProps(previous => ({ ...previous, ...patch }));
  return createElement(ReactGrid, { ...props, style: { width: 400, height: 240 }, onReady: grid => {
    window.adapters.react = grid; window.adapters.ready.push(['react', !!grid]);
  }, onEvent: props.onEvent ?? (event => window.adapters.events.push(['react', event.type])) });
}
const react = createRoot(document.querySelector('#react'));
react.render(createElement(StrictMode, null, createElement(ReactDemo)));
const vueProps = shallowRef({ options: options() });
window.adapters.updateVue = patch => { vueProps.value = { ...vueProps.value, ...patch }; };
const vue = createApp({ setup: () => () => h(VueGrid, { ...vueProps.value, style: { width: '400px', height: '240px' }, onReady: grid => {
  window.adapters.vue = grid; window.adapters.ready.push(['vue', !!grid]);
}, onEvent: vueProps.value.onEvent ?? (event => window.adapters.events.push(['vue', event.type])) }) });
vue.mount('#vue');
window.adapters.unmountReact = () => react.unmount();
window.adapters.unmountVue = () => vue.unmount();
