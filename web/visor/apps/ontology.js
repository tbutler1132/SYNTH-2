(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const formatVal = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.length === 0 ? '[]' : v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const fieldSummary = (spec) => {
    if (spec.ref) return `ref:${spec.ref}`;
    if (spec.type === 'list' && spec.items) {
      return spec.items.ref ? `list<ref:${spec.items.ref}>` : `list<${spec.items.type ?? '?'}>`;
    }
    return spec.type ?? '?';
  };

  function renderList(items, onClick) {
    const list = document.createElement('div');
    list.className = 'ontology-list';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ontology-item';
      btn.innerHTML = `<span class="ontology-item-name">${esc(item.name)}</span><span class="ontology-item-desc">${esc(item.desc ?? '')}</span>`;
      btn.addEventListener('click', () => onClick(item));
      list.appendChild(btn);
    }
    return list;
  }

  let container = null;

  function showTypes() {
    const items = Object.entries(synth.ontology.types).map(([name, spec]) => ({
      name,
      desc: spec.description ?? '',
    }));
    container.innerHTML = `<div class="ontology-section">Types (${items.length})</div>`;
    container.appendChild(renderList(items, (item) => showType(item.name)));
  }

  function showType(typeName) {
    const spec = synth.ontology.types[typeName];
    const fields = Object.entries(spec.fields ?? {});
    const instances = spec.instances ?? [];
    container.innerHTML = `
      <h3 class="ontology-title">${esc(typeName)}</h3>
      <p class="ontology-desc">${esc(spec.description ?? '')}</p>
      ${spec.identifiers?.length ? `<div class="ontology-section">Identifiers</div><div>${spec.identifiers.map(esc).join(', ')}</div>` : ''}
      <div class="ontology-section">Fields (${fields.length})</div>
      <dl class="ontology-kv">${fields.map(([f, fs]) =>
        `<dt>${esc(f)}${fs.required ? ' *' : ''}</dt><dd>${esc(fieldSummary(fs))}</dd>`
      ).join('')}</dl>
      <div class="ontology-section">Instances (${instances.length})</div>
    `;
    const items = instances.map((inst) => ({
      name: inst.id,
      desc: inst.data.title ?? inst.data.name ?? '',
      slug: inst.id,
    }));
    container.appendChild(renderList(items, (item) => showInstance(typeName, item.slug)));
  }

  function showInstance(typeName, slug) {
    const spec = synth.ontology.types[typeName];
    const inst = spec.instances.find((i) => i.id === slug);
    const entries = Object.entries(inst.data);
    container.innerHTML = `
      <h3 class="ontology-title">${esc(slug)}</h3>
      <div class="ontology-section">${esc(typeName)}</div>
      <dl class="ontology-kv">${entries.map(([k, v]) =>
        `<dt>${esc(k)}</dt><dd>${esc(formatVal(v))}</dd>`
      ).join('') || '<dd>no fields</dd>'}</dl>
      <div class="ontology-section">Back</div>
      <button type="button" class="ontology-item" data-back><span class="ontology-item-name">↑ ${esc(typeName)}</span></button>
    `;
    container.querySelector('[data-back]').addEventListener('click', () => showType(typeName));
  }

  synth.registerApp({
    id: 'ontology',
    name: 'Ontology',
    mount(c) {
      container = c;
      showTypes();
    },
    unmount() {
      if (container) container.innerHTML = '';
      container = null;
    },
  });
})();
