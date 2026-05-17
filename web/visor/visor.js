(() => {
  const synth = (window.synth = {
    apps: [],
    ontology: null,
    activeApp: null,
    registerApp(app) { this.apps.push(app); },
    start,
  });

  function start() {
    const els = {
      toggle: document.querySelector('[data-action="toggle-device"]'),
      device: document.querySelector('[data-device]'),
      back: document.querySelector('[data-action="back"]'),
      title: document.querySelector('.visor-device-title'),
      content: document.querySelector('[data-device-content]'),
    };

    const setHeader = (title, showBack) => {
      els.title.textContent = title;
      els.back.hidden = !showBack;
    };

    const openLauncher = () => {
      if (synth.activeApp?.unmount) synth.activeApp.unmount(els.content);
      synth.activeApp = null;
      els.content.innerHTML = '';

      const grid = document.createElement('div');
      grid.className = 'visor-app-grid';
      if (synth.apps.length === 0) grid.textContent = 'no apps registered';
      for (const app of synth.apps) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'visor-app-tile';
        tile.textContent = app.name;
        tile.addEventListener('click', () => openApp(app));
        grid.appendChild(tile);
      }
      els.content.appendChild(grid);
      setHeader('apps', false);
    };

    const openApp = (app) => {
      if (synth.activeApp?.unmount) synth.activeApp.unmount(els.content);
      synth.activeApp = app;
      els.content.innerHTML = '';
      setHeader(app.name, true);
      app.mount(els.content);
    };

    els.toggle.addEventListener('click', () => {
      els.device.hidden = !els.device.hidden;
      if (!els.device.hidden && !synth.activeApp) openLauncher();
    });
    els.back.addEventListener('click', () => openLauncher());

    const current = document.querySelector(`.visor-nav a[href="${location.pathname}"]`);
    if (current) current.setAttribute('aria-current', 'page');
  }
})();
