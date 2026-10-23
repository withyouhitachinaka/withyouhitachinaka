'use strict';
// Excelファイルの読み込みは、画面とは切り離したこのワーカーの中だけで行う。
// 細工されたファイルでライブラリが誤動作しても、画面のデータや処理には届かない。
importScripts('xlsx.full.min.js');
self.onmessage = (e) => {
  try {
    const wb = XLSX.read(e.data, { type: 'array' });
    const sheets = wb.SheetNames.slice(0, 62).map((n) =>
      XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })
        .slice(0, 5000)
        .map((r) => (Array.isArray(r) ? r.slice(0, 100).map((c) => String(c ?? '').slice(0, 500)) : [])));
    self.postMessage({ ok: true, sheets });
  } catch (err) {
    self.postMessage({ ok: false, msg: String((err && err.message) || err) });
  }
};
