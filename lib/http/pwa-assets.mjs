// Public files only. Private app documents, APIs and attachments stay authenticated.
export const PWA_ASSETS = new Map([
  ['/manifest.webmanifest', { file: 'manifest.webmanifest', type: 'application/manifest+json' }],
  ['/sw.js', { file: 'sw.js', type: 'text/javascript' }],
  ['/pwa.js', { file: 'pwa.js', type: 'text/javascript' }],
  ['/pwa.css', { file: 'pwa.css', type: 'text/css' }],
  ['/mobile.css', { file: 'mobile.css', type: 'text/css' }],
  ['/offline', { file: 'offline.html', type: 'text/html' }],
  ['/offline.css', { file: 'offline.css', type: 'text/css' }],
  ...['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'].map(name => [`/brand/pwa/${name}`, { file: `brand/pwa/${name}`, type: 'image/png' }]),
]);
