const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 把任意标题清洗成安全的文件名片段。
 * @param {unknown} value 原始文本
 * @param {string} fallback 清洗后为空时的兜底名
 * @param {number} maxLength 最大长度
 */
export const sanitizeFileName = (value, fallback = 'bds-data', maxLength = 120) => {
  const text = String(value ?? '')
    .replace(ILLEGAL_FILE_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  let name = text.slice(0, Math.max(1, maxLength)).trim();
  if (!name) return fallback;
  if (WINDOWS_RESERVED.test(name)) name = `${name}_`;
  return name;
};

/**
 * 触发浏览器下载。
 * @param {Blob} blob 文件内容
 * @param {string} fileName 文件名
 */
export const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 部分浏览器需要延迟回收，否则下载会被打断
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * 下载文本内容。
 * @param {string} text 文本
 * @param {string} fileName 文件名
 * @param {string} mime MIME 类型
 */
export const downloadText = (text, fileName, mime = 'text/plain;charset=utf-8') => {
  downloadBlob(new Blob([String(text ?? '')], { type: mime }), fileName);
};

/**
 * 下载 JSON 内容。
 * @param {unknown} data 数据
 * @param {string} fileName 文件名
 * @param {number|'none'} indent 缩进，'none' 表示不缩进
 */
export const downloadJson = (data, fileName, indent = 2) => {
  const text = indent === 'none' ? JSON.stringify(data) : JSON.stringify(data, null, Number(indent) || 2);
  downloadText(text, fileName, 'application/json;charset=utf-8');
};
