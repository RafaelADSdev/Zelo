export const normalize = text => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOPWORDS = new Set("o a os as de do da dos das em um uma que qual quais e meu minha por para como voces voce tem sao na no nos nas se com quanto custa".split(" "));
export function searchQuery(text) {
  return normalize(text).split(/\W+/).filter(word => word.length > 1 && !STOPWORDS.has(word)).join(" ");
}

export const catalogWords = text => (normalize(text).match(/[\p{L}\p{N}]+/gu) || []).join(" ");

export function namedCatalogProducts(products, query) {
  const words = catalogWords(query);
  let remaining = ` ${words} `;
  const named = products.map(product => ({ product, name: catalogWords(product.name) })).sort((a, b) => b.name.length - a.name.length);
  const selected = [];
  for (const { product, name } of named) {
    const alias = name.replace(/^(?:residencial|empreendimento|condominio|edificio|loteamento) /, "");
    const match = [name, alias].find(value => value && (value === words || ((value.length >= 3 || /\d/.test(value)) && remaining.includes(` ${value} `))));
    if (!match) continue;
    selected.push(product);
    // Prefer the full name when one product name contains another.
    remaining = remaining.replaceAll(` ${match} `, "  ");
    if (selected.length === 3) break;
  }
  return selected;
}
