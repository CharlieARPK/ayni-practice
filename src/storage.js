const KEY = 'ayni.library.v1';
export function loadLibrary() {
  const value = localStorage.getItem(KEY);
  if (!value) return [];
  const entries = JSON.parse(value);
  if (!Array.isArray(entries)) throw new Error('保存された曲一覧を読み込めません。');
  return entries;
}
export function saveLibrary(entries) {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); }
  catch { throw new Error('端末に保存できませんでした。空き容量やブラウザーの保存設定をご確認ください。'); }
}
export function createEntry(data) {
  // randomUUID requires HTTPS; getRandomValues also works on a LAN HTTP preview.
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  return { id, addedAt: new Date().toISOString(), data };
}
