// 弹幕 XML 序列化：把弹幕对象数组还原成 B 站标准弹幕 XML
// 格式参考 bilibili-API-collect docs/danmaku/danmaku_xml.md
// <d p="出现时间,类型,字号,颜色,发送时间,弹幕池,发送者midHash,弹幕dmid,屏蔽等级">内容</d>

import { sanitizeFileName } from './download.js';

export const DM_XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * 实时弹幕池默认上限。
 * ProtoBuf 接口（x/v2/dm/web/view）不返回该值，其 dmSge.total 是分片数量而非池上限，
 * 真实 XML（x/v1/dm/list.so）里该字段常见值为 3000。
 */
export const DM_XML_DEFAULT_MAXLIMIT = 3000;

/** 数字容错，非法值回落到默认值 */
const toInt = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
};

/** XML 1.0 不允许的控制字符（个别代码弹幕内容里会出现） */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** 文本节点转义 */
export const escapeXmlText = (value) =>
  String(value ?? '')
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** 属性值转义 */
export const escapeXmlAttr = (value) =>
  escapeXmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * 弹幕出现时间：内部是毫秒整数，XML 里是秒并保留 5 位小数（如 490.19100）。
 * @param {number} progress 毫秒
 */
export const formatProgressSeconds = (progress) => {
  const ms = Number(progress);
  const seconds = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
  return seconds.toFixed(5);
};

/**
 * 生成单条弹幕的 p 属性。
 * @param {object} dm 弹幕对象（BiliDanmaku.parseXml / parsePb 的字段结构）
 */
export const buildDanmakuPAttribute = (dm = {}) => {
  const dmid = dm.idStr != null && dm.idStr !== '' ? String(dm.idStr) : dm.id != null ? String(dm.id) : '';
  return [
    formatProgressSeconds(dm.progress),
    toInt(dm.mode, 1),
    toInt(dm.fontsize, 25),
    toInt(dm.color, 16777215),
    toInt(dm.ctime, 0),
    toInt(dm.pool, 0),
    String(dm.midHash ?? ''),
    dmid,
    toInt(dm.weight, 0),
  ].join(',');
};

/**
 * 弹幕排序：按出现时间升序，同时间按 dmid 升序，保证导出结果稳定。
 * @param {Array} list 弹幕列表
 */
export const sortDanmakuList = (list) => {
  const items = Array.isArray(list) ? [...list] : [];
  return items.sort((a, b) => {
    const pa = Number(a?.progress) || 0;
    const pb = Number(b?.progress) || 0;
    if (pa !== pb) return pa - pb;
    const ia = String(a?.idStr ?? a?.id ?? '');
    const ib = String(b?.idStr ?? b?.id ?? '');
    return ia.localeCompare(ib);
  });
};

/**
 * 生成一个 cid 的完整弹幕 XML 文本。
 * @param {Array} list 弹幕列表
 * @param {{cid?: number|string, maxlimit?: number, state?: number, source?: string, sort?: boolean}} meta 元信息
 */
export const buildDanmakuXml = (list, meta = {}) => {
  const items = meta.sort === false ? (Array.isArray(list) ? list : []) : sortDanmakuList(list);
  const cid = meta.cid ?? '';
  const maxlimit = toInt(meta.maxlimit, DM_XML_DEFAULT_MAXLIMIT);
  const state = toInt(meta.state, 0);
  const source = meta.source ? String(meta.source) : 'k-v';

  const lines = [
    DM_XML_HEADER,
    '<i>',
    '  <chatserver>chat.bilibili.com</chatserver>',
    `  <chatid>${escapeXmlText(cid)}</chatid>`,
    '  <mission>0</mission>',
    `  <maxlimit>${maxlimit}</maxlimit>`,
    `  <state>${state}</state>`,
    '  <real_name>0</real_name>',
    `  <source>${escapeXmlText(source)}</source>`,
  ];

  for (const dm of items) {
    const content = escapeXmlText(dm?.content);
    lines.push(`  <d p="${escapeXmlAttr(buildDanmakuPAttribute(dm))}">${content}</d>`);
  }

  lines.push('</i>', '');
  return lines.join('\n');
};

/**
 * 从 BiliDanmaku 的 danmaku_view（ProtoBuf DmWebViewReply）里取 XML 头部元信息。
 * @param {object} view danmaku_view
 */
export const pickXmlMetaFromView = (view) => ({
  maxlimit: DM_XML_DEFAULT_MAXLIMIT,
  state: toInt(view?.state, 0),
});

/**
 * 生成合集内单集 XML 的文件名（含序号，便于按顺序排列）。
 * @param {{index?: number, total?: number, title?: string, cid?: number|string, suffix?: string}} options
 */
export const buildDmXmlFileName = ({ index = 0, total = 0, title = '', cid = '', suffix = 'xml' } = {}) => {
  const safeTitle = sanitizeFileName(title, 'danmaku', 60);
  const cidPart = cid === '' || cid == null ? '' : `_${String(cid).replace(/[^0-9a-zA-Z_-]/g, '')}`;
  const seq =
    Number(index) > 0
      ? `${String(index).padStart(Math.max(2, String(Math.max(0, total)).length), '0')}_`
      : '';
  return `${seq}${safeTitle}${cidPart}.${suffix}`;
};
