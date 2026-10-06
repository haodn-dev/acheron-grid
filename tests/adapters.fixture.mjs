import { createElement, StrictMode, useState, Component } from 'react';
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
window.adapters.mountFailingReact = () => {
  const host=document.createElement('div');document.body.append(host);
  class Boundary extends Component {
    state={failed:false};
    static getDerivedStateFromError(){return {failed:true};}
    render(){return this.state.failed?createElement('p',null,'Ready failure handled'):this.props.children;}
  }
  const root=createRoot(host);
  root.render(createElement(Boundary,null,createElement(ReactGrid,{options:options(),style:{width:400,height:240},onReady:grid=>{if(grid){window.adapters.failedReact=grid;throw new Error('Host ready failed');}}})));
  window.adapters.unmountFailingReact=()=>{root.unmount();host.remove();};
};
window.adapters.mountFailingVue = () => {
  const host=document.createElement('div');document.body.append(host);
  const app=createApp({render:()=>h(VueGrid,{options:options(),frozenColumns:99,style:{width:'400px',height:'240px'},onReady:grid=>window.adapters.failedVue=grid})});
  app.config.errorHandler=error=>window.adapters.vueMountError=error.message;
  app.mount(host);window.adapters.unmountFailingVue=()=>{app.unmount();host.remove();};
};
