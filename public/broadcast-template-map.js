export function initTemplateMap({ variables }) {
  const root = document.getElementById('broadcast-template-mapper');
  return {
    render(template) {
      const previous = new Map([...root.querySelectorAll('[data-parameter]')].map(row => [row.dataset.parameter, { key: row.querySelector('select').value, value: row.querySelector('input').value }]));
      root.replaceChildren();
      const body = template?.components?.find(item => item.type.toLowerCase() === 'body')?.text || '';
      const parameters = [...new Set([...body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(match => match[1]))];
      for (const parameter of parameters) {
        const row = document.createElement('div'); row.className = 'broadcast-import-options'; row.dataset.parameter = parameter;
        const select = document.createElement('select'); select.setAttribute('aria-label', `Coluna da variável ${parameter}`);
        select.append(new Option('Escolha uma coluna', ''), new Option('Nome do contato', 'nome'));
        variables().forEach(key => select.append(new Option(`Coluna: ${key}`, key))); select.append(new Option('Valor fixo', 'fixed'));
        const input = document.createElement('input'); input.maxLength = 1000; input.placeholder = 'Valor fixo ou alternativa se vazio'; input.setAttribute('aria-label', `Alternativa ou valor fixo da variável ${parameter}`);
        const label = document.createElement('label'); label.textContent = `Variável {{${parameter}}}`;
        const left = document.createElement('div'); left.append(label, select);
        const right = document.createElement('div'); const fallback = document.createElement('label'); fallback.textContent = 'Valor fixo ou alternativa'; right.append(fallback, input);
        if (previous.has(parameter)) { select.value = previous.get(parameter).key; input.value = previous.get(parameter).value; }
        else if (parameter === 'nome') { select.value = 'nome'; input.value = 'cliente'; }
        row.append(left, right); root.append(row);
      }
    },
    components() {
      const parameters = [...root.querySelectorAll('[data-parameter]')].map(row => {
        const key = row.querySelector('select').value, fallback = row.querySelector('input').value.trim();
        if (!key || key === 'fixed' && !fallback) throw new Error(`Preencha o mapeamento da variável ${row.dataset.parameter}.`);
        const text = key === 'fixed' ? fallback : `{${key}${fallback ? '|' + fallback : ''}}`;
        return { type: 'text', ...(/^\d+$/.test(row.dataset.parameter) ? {} : { parameter_name: row.dataset.parameter }), text };
      });
      return parameters.length ? [{ type: 'body', parameters }] : [];
    },
  };
}
