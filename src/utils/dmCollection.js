// 合集信息提取：从 BiliArchive 已抓取的原始数据里还原「合集的集列表 / 番剧剧集 / 多P分P」
// 数据来源均在 arcMgr.data 里，正常浏览视频页时已经被抓取，无需额外请求：
//  - 视频合集: data.video_view.ugc_season（sections[].episodes[] 自带 cid / aid / 时长）
//  - 番剧剧集: data.bangumi_season_view（episodes[] 与 section[].episodes[]）
//  - 多P稿件: data.video_view.pages（同一 aid，多个 cid）

import { sanitizeFileName } from './download.js';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toText = (value) => String(value ?? '').trim();

/** 番剧接口的时长是毫秒，统一换算成秒（与 BDM bangumi handler 的 extract 保持一致） */
const msToSeconds = (value) => {
  const num = toNumber(value);
  return num == null ? 0 : Math.max(0, Math.floor(num / 1000));
};

const finalizeCollection = (collection) => {
  const sections = (collection?.sections || [])
    .map((section, sectionIndex) => ({
      id: section?.id ?? `section-${sectionIndex}`,
      title: toText(section?.title) || `分部 ${sectionIndex + 1}`,
      items: (Array.isArray(section?.items) ? section.items : []).filter((item) => item?.cid && item?.aid),
    }))
    .filter((section) => section.items.length);

  const items = [];
  for (const section of sections) {
    for (const item of section.items) {
      item.sectionTitle = section.title;
      item.index = items.length;
      items.push(item);
    }
  }
  if (!items.length) return null;

  const total = items.length;
  for (const item of items) {
    item.total = total;
    item.key = `${item.cid}-${item.index}`;
  }

  const title = toText(collection.title) || '合集';
  const panelTitle = collection.kind === 'pages'
    ? `分P弹幕（${total} 个分P）`
    : `${collection.kind === 'bangumi' ? '番剧弹幕' : '合集弹幕'} · ${title}（${total} 集）`;

  return {
    kind: collection.kind,
    seasonId: collection.seasonId ?? null,
    title,
    panelTitle,
    mid: collection.mid ?? null,
    cover: toText(collection.cover),
    intro: toText(collection.intro),
    sourceLabel: collection.sourceLabel || '合集',
    sections,
    items,
    total,
  };
};

const fromUgcSeason = (videoView) => {
  const season = videoView?.ugc_season;
  if (!season || !Array.isArray(season.sections)) return null;
  return finalizeCollection({
    kind: 'ugc_season',
    seasonId: toNumber(season.id),
    title: toText(season.title) || '视频合集',
    mid: toNumber(season.mid),
    cover: toText(season.cover),
    intro: toText(season.intro),
    sourceLabel: '合集',
    sections: season.sections.map((section, sectionIndex) => ({
      id: section?.id ?? section?.section_id ?? `section-${sectionIndex}`,
      title: toText(section?.title),
      items: (Array.isArray(section?.episodes) ? section.episodes : []).map((episode, index) => ({
        aid: toNumber(episode?.aid),
        bvid: toText(episode?.bvid),
        cid: toNumber(episode?.cid),
        title: toText(episode?.title) || toText(episode?.arc?.title) || `第 ${index + 1} 集`,
        duration: toNumber(episode?.arc?.duration) ?? 0,
        pubtime: toNumber(episode?.arc?.pubdate),
        cover: toText(episode?.arc?.pic),
      })),
    })),
  });
};

const mapBangumiEpisode = (episode, index) => ({
  aid: toNumber(episode?.aid),
  bvid: toText(episode?.bvid),
  cid: toNumber(episode?.cid),
  epId: toNumber(episode?.ep_id ?? episode?.id),
  title:
    toText(episode?.show_title) ||
    toText(episode?.long_title) ||
    toText(episode?.title) ||
    `第 ${index + 1} 集`,
  duration: msToSeconds(episode?.duration),
  pubtime: toNumber(episode?.pub_time),
  cover: toText(episode?.cover),
});

const fromBangumiSeason = (season) => {
  if (!season) return null;

  const sections = [];
  const mainEpisodes = Array.isArray(season.episodes) ? season.episodes : [];
  if (mainEpisodes.length) {
    sections.push({ id: 'main', title: '正片', items: mainEpisodes.map(mapBangumiEpisode) });
  }
  (Array.isArray(season.section) ? season.section : []).forEach((section, sectionIndex) => {
    const episodes = Array.isArray(section?.episodes) ? section.episodes : [];
    if (!episodes.length) return;
    sections.push({
      id: section?.id ?? `section-${sectionIndex}`,
      title: toText(section?.title),
      items: episodes.map(mapBangumiEpisode),
    });
  });

  return finalizeCollection({
    kind: 'bangumi',
    seasonId: toNumber(season.season_id),
    title: toText(season.season_title) || '番剧',
    mid: toNumber(season.up_info?.mid),
    cover: toText(season.cover),
    intro: toText(season.evaluate),
    sourceLabel: '剧集',
    sections,
  });
};

const fromPages = (videoView) => {
  const pages = videoView?.pages;
  if (!Array.isArray(pages) || pages.length < 2) return null;
  const title = toText(videoView?.title);
  return finalizeCollection({
    kind: 'pages',
    seasonId: null,
    title: title ? `${title}（分P）` : '多P视频（分P）',
    mid: toNumber(videoView?.owner?.mid),
    cover: toText(videoView?.pic),
    sourceLabel: '分P',
    sections: [
      {
        id: 'pages',
        title: '分P',
        items: pages.map((page, index) => ({
          aid: toNumber(videoView?.aid),
          bvid: toText(videoView?.bvid),
          cid: toNumber(page?.cid),
          page: index + 1,
          title: toText(page?.part) || `P${index + 1}`,
          duration: toNumber(page?.duration) ?? 0,
          pubtime: toNumber(videoView?.pubdate),
          cover: toText(videoView?.pic),
        })),
      },
    ],
  });
};

/**
 * 从档案管理器里提取合集信息。
 * @param {object} arcMgr BDM.BiliArchive 实例
 * @returns {null|{kind:string,title:string,total:number,sections:Array,items:Array}}
 */
export const extractCollectionInfo = (arcMgr) => {
  const data = arcMgr?.data;
  if (!data || typeof data !== 'object') return null;
  return (
    fromUgcSeason(data.video_view) ||
    fromBangumiSeason(data.bangumi_season_view) ||
    fromPages(data.video_view) ||
    null
  );
};

/**
 * 把合集条目转换成 BiliDanmaku 需要的 info 结构。
 * @param {object} item 合集条目
 * @param {object} collection 合集信息
 */
export const buildItemDanmakuInfo = (item, collection = {}) => {
  const isBangumi = collection?.kind === 'bangumi';
  const page = Number(item?.page) || 1;
  const epId = item?.epId ?? item?.cid;

  let id;
  if (isBangumi) {
    id = `bangumi/play/ep${epId}`;
  } else if (collection?.kind === 'pages' && page > 1) {
    id = `video/${item?.bvid}?p=${page}`;
  } else {
    id = `video/${item?.bvid}`;
  }

  return {
    id,
    aid: item?.aid,
    cid: item?.cid,
    oid: item?.aid,
    bvid: item?.bvid,
    type: 1,
    duration: Number(item?.duration) || 0,
    title: item?.title,
    pubtime: item?.pubtime ?? undefined,
    subtitle: collection?.title ? String(collection.title) : undefined,
    url: isBangumi
      ? `https://www.bilibili.com/bangumi/play/ep${epId}`
      : `https://www.bilibili.com/${id}`,
  };
};

/** 合集条目在 B 站上的页面地址 */
export const buildItemPageUrl = (item, collection = {}) => {
  if (collection?.kind === 'bangumi') {
    return `https://www.bilibili.com/bangumi/play/ep${item?.epId ?? item?.cid}`;
  }
  if (collection?.kind === 'pages') {
    return `https://www.bilibili.com/video/${item?.bvid}?p=${Number(item?.page) || 1}`;
  }
  return item?.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '';
};

/**
 * 合集下载文件名。
 * @param {object} collection 合集信息
 * @param {string} ext 扩展名
 */
export const buildCollectionFileName = (collection, ext = 'zip') =>
  `${sanitizeFileName(`${collection?.title || 'collection'}_弹幕`, 'collection', 80)}.${ext}`;
