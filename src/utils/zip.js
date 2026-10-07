// 零依赖 ZIP 打包（仅 store 模式，不压缩）
// 用途：合集弹幕批量下载时把多个 XML / JSON 打成一个 zip，避免浏览器连续下载被拦截。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

const textEncoder = new TextEncoder();

export const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const toBytes = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    throw new TypeError('createZipBlob: Blob 需要先 await blob.arrayBuffer() 再传入');
  }
  return textEncoder.encode(String(data ?? ''));
};

const dosTime = (date) =>
  ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;

const dosDate = (date) =>
  (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;

/**
 * 生成 zip 文件。
 * @param {Array<{name: string, data: Uint8Array|ArrayBuffer|string}>} files 文件列表
 * @param {{date?: Date, comment?: string}} options 选项
 * @returns {Blob} zip Blob
 */
export const createZipBlob = (files, options = {}) => {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  const now = options.date instanceof Date ? options.date : new Date();
  const time = dosTime(now);
  const date = dosDate(now);

  const entries = [];
  const chunks = [];
  let offset = 0;

  for (const file of list) {
    const nameBytes = textEncoder.encode(String(file?.name || 'file'));
    const dataBytes = toBytes(file?.data);
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // local file header signature
    view.setUint16(4, 20, true); // version needed to extract
    view.setUint16(6, 0x0800, true); // general purpose flag: UTF-8 filename
    view.setUint16(8, 0, true); // compression method: store
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, dataBytes.length, true); // compressed size
    view.setUint32(22, dataBytes.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // extra field length
    localHeader.set(nameBytes, 30);

    chunks.push(localHeader, dataBytes);
    entries.push({ nameBytes, crc, size: dataBytes.length, offset });
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.nameBytes.length, 0);

  for (const entry of entries) {
    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(centralHeader.buffer);

    view.setUint32(0, 0x02014b50, true); // central directory signature
    view.setUint16(4, 20, true); // version made by
    view.setUint16(6, 20, true); // version needed
    view.setUint16(8, 0x0800, true); // flags
    view.setUint16(10, 0, true); // method
    view.setUint16(12, time, true);
    view.setUint16(14, date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true); // extra length
    view.setUint16(32, 0, true); // comment length
    view.setUint16(34, 0, true); // disk number start
    view.setUint16(36, 0, true); // internal attributes
    view.setUint32(38, 0, true); // external attributes
    view.setUint32(42, entry.offset, true);
    centralHeader.set(entry.nameBytes, 46);

    chunks.push(centralHeader);
  }

  const commentBytes = options.comment ? textEncoder.encode(String(options.comment)) : new Uint8Array(0);
  const endRecord = new Uint8Array(22 + commentBytes.length);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true); // end of central directory signature
  endView.setUint16(4, 0, true); // disk number
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, commentBytes.length, true);
  if (commentBytes.length) endRecord.set(commentBytes, 22);
  chunks.push(endRecord);

  return new Blob(chunks, { type: 'application/zip' });
};

/**
 * 生成不会重名的 zip 内文件名。
 * @param {Set<string>} usedNames 已用文件名集合（会被就地修改）
 * @param {string} name 期望文件名
 */
export const uniqueZipName = (usedNames, name) => {
  const base = String(name || 'file');
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let index = 2;
  let next = `${stem}(${index})${ext}`;
  while (usedNames.has(next)) {
    index += 1;
    next = `${stem}(${index})${ext}`;
  }
  usedNames.add(next);
  return next;
};
