// Exact public documents only; customer data and account routes remain protected.
export const LEGAL_ASSETS = new Map([
  ...['privacidade', 'termos', 'cookies', 'cancelamento', 'contato'].map(name => [`/${name}`, { file: `legal/${name}.html`, type: 'text/html' }]),
  ['/legal.css', { file: 'legal/legal.css', type: 'text/css' }],
]);
