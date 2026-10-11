// Pantalla de créditos: se arma en la compilación a partir de
// ASSETS-CREDITS.md (la única fuente de verdad), así los autores de los
// recursos CC-BY quedan reconocidos dentro del juego y nunca se desactualiza.

import creditsMd from '../../ASSETS-CREDITS.md?raw';

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Enlaces Markdown [texto](url) → <a>; el resto se escapa. */
function inline(md) {
  let out = '';
  let last = 0;
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (let m; (m = re.exec(md)); ) {
    out += esc(md.slice(last, m.index).replace(/`/g, ''));
    out += `<a href="${esc(m[2])}" target="_blank" rel="noopener">${esc(m[1])}</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(md.slice(last).replace(/`/g, ''));
}

/** Filas de las tablas del archivo, agrupadas por la sección (##) en la que están. */
export function parseCredits(md = creditsMd) {
  const sections = [];
  let current = { title: 'Recursos', rows: [] };
  let header = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      if (current.rows.length) sections.push(current);
      current = { title: line.slice(3).trim(), rows: [] };
      header = null;
      continue;
    }
    if (!line.startsWith('|')) {
      header = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const get = (k) => cells[header.findIndex((h) => h.startsWith(k))] ?? '';
    current.rows.push({ name: get('recurso') || get('datos'), author: get('autor'), source: get('fuente'), license: get('licencia') });
  }
  if (current.rows.length) sections.push(current);
  return sections;
}

export function creditsHtml() {
  return parseCredits()
    .map(
      (s) =>
        `<h3>${esc(s.title)}</h3><ul class="credits-list">${s.rows
          .map((r) => `<li><span class="c-name">${inline(r.name)}</span><span class="c-meta">${r.author ? `${inline(r.author)} · ` : ''}${inline(r.license)}${r.source ? ` · ${inline(r.source)}` : ''}</span></li>`)
          .join('')}</ul>`,
    )
    .join('');
}
