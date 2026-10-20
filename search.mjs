export const normalize = text => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOPWORDS = new Set("o a os as de do da dos das em um uma que qual quais e meu minha por para como voces voce tem sao na no nos nas se com quanto custa".split(" "));
export function searchQuery(text) {
  return normalize(text).split(/\W+/).filter(word => word.length > 1 && !STOPWORDS.has(word)).join(" ");
}
