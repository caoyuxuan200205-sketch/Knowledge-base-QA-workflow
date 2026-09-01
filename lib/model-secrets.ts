export const MODEL_SECRET_STORAGE_KEY = 'museum-kb-model-secrets-v1';

export function readModelSecrets() {
  if (typeof window === 'undefined') return {} as Record<string, string>;
  try {
    const saved = sessionStorage.getItem(MODEL_SECRET_STORAGE_KEY);
    return saved ? JSON.parse(saved) as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function readModelSecret(modelId: string) {
  return readModelSecrets()[modelId] ?? '';
}

export function saveModelSecret(modelId: string, value: string) {
  const next = { ...readModelSecrets(), [modelId]: value };
  sessionStorage.setItem(MODEL_SECRET_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeModelSecret(modelId: string) {
  const next = readModelSecrets();
  delete next[modelId];
  sessionStorage.setItem(MODEL_SECRET_STORAGE_KEY, JSON.stringify(next));
  return next;
}
