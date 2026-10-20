export function tagProviderError(error, response, quota = false) {
  error.providerStatus = response.status;
  error.fallbackEligible = quota || [402, 429].includes(response.status);
  const header = response.headers.get("retry-after");
  const delay = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 300000;
  error.retryAfterMs = Math.min(86400000, Math.max(1000, Number.isFinite(delay) ? delay : 300000));
  return error;
}
