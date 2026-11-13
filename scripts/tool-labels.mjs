// Chat tool headers. OpenChamber shows a manifest `contributes.tools[].name`
// in place of its own label, but the field is one fixed string and the
// built-in English labels are not translated. Deployment therefore writes the
// names for the OpenChamber UI locale; English names live in the manifest.
export const toolLabels = {
  'zh-Hans': { websearch: '联网搜索', webfetch: '获取网页', chat_calculate: '数值计算' },
  'zh-Hant': { websearch: '聯網搜尋', webfetch: '擷取網頁', chat_calculate: '數值計算' },
};

/** Maps a BCP 47 tag (`zh-CN`, `zh-TW`, `zh-Hant-HK`, `en-US`) to a label set, or `en`. */
export function labelLocale(tag) {
  if (typeof tag !== 'string' || !tag.trim()) return 'en';
  let locale;
  try { locale = new Intl.Locale(tag.trim().replaceAll('_', '-')).maximize(); }
  catch { return 'en'; }
  const key = `${locale.language}-${locale.script}`;
  return Object.hasOwn(toolLabels, key) ? key : 'en';
}

/** Returns a copy of the extension manifest with tool names for `tag`. */
export function localizeManifest(manifest, tag) {
  const labels = toolLabels[labelLocale(tag)];
  const copy = structuredClone(manifest);
  if (!labels) return copy;
  for (const tool of copy.openchamber?.contributes?.tools ?? []) {
    if (Object.hasOwn(labels, tool.match)) tool.name = labels[tool.match];
  }
  return copy;
}
