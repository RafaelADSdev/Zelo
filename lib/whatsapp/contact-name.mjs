export function contactName(value) {
  if (typeof value !== 'string') return '';
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!name || /^\+?[\d\s().-]+(?:@(?:s\.whatsapp\.net|lid))?$/.test(name)) return '';
  return name;
}
