<script setup>
import mountStyle from './style.cssr.js';
import storage from '../../utils/storage';
import { useMessage } from 'naive-ui';
import { InfoCircle } from '@vicons/tabler';
import { buildDanmakuXml, buildDmXmlFileName, pickXmlMetaFromView } from '../../utils/dmXml';
import {
  buildCollectionFileName,
  buildItemDanmakuInfo,
  buildItemPageUrl,
} from '../../utils/dmCollection';
import { createZipBlob, uniqueZipName } from '../../utils/zip';
import { downloadBlob, downloadJson, downloadText } from '../../utils/download';

const props = defineProps({
  arcMgr: {
    type: Object,
    default: null,
  },
  dmMgr: {
    type: Object,
    default: null,
  },
  collection: {
    type: Object,
    default: null,
  },
  to: {
    type: [String, Object],
    default: undefined,
  },
});

const emit = defineEmits(['set-error', 'update:loading']);

const styleMountTarget = inject('styleMountTarget', null);
mountStyle(styleMountTarget);

const BDM = inject('BDM', null);
const message = useMessage();

const SOURCE_OPTIONS = [
  { label: 'ProtoBuf 弹幕（推荐，覆盖更全）', value: 'pb' },
  { label: 'XML 实时弹幕（仅近期弹幕池）', value: 'xml' },
  { label: 'ProtoBuf + XML（合并去重）', value: 'both' },
];

const FORMAT_OPTIONS = [
  { label: '弹幕 XML（每集一个文件）', value: 'xml-zip' },
  { label: '弹幕 JSON（每集一个文件）', value: 'json-zip' },
  { label: '弹幕 JSON（合并为单文件）', value: 'json-merged' },
];

const dmSource = ref(storage.get('dmCollection.source', 'pb'));
const outputFormat = ref(storage.get('dmCollection.format', 'xml-zip'));
const concurrency = ref(Number(storage.get('dmCollection.concurrency', 2)) || 2);
const reuseLoaded = ref(storage.get('dmCollection.reuseLoaded', true));

const downloading = ref(false);
const selectedKeys = ref([]);
const itemStates = reactive({});
const progress = reactive({
  finished: 0,
  total: 0,
  dmCount: 0,
  text: '',
  startTs: 0,
});

const items = computed(() => props.collection?.items || []);
const sections = computed(() => props.collection?.sections || []);
const selectedCount = computed(() => selectedKeys.value.length);
const currentCid = computed(() => {
  const cid = props.dmMgr?.info?.cid;
  return cid == null ? '' : String(cid);
});

const progressPercent = computed(() => {
  const total = Number(progress.total) || 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((progress.finished / total) * 100)));
});

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
};

const isItemCurrent = (item) => currentCid.value !== '' && String(item?.cid) === currentCid.value;

const resetProgress = (total) => {
  progress.finished = 0;
  progress.total = total;
  progress.dmCount = 0;
  progress.text = '';
  progress.startTs = Date.now();
};

const clearItemStates = () => {
  Object.keys(itemStates).forEach((key) => {
    delete itemStates[key];
  });
};

const setItemState = (key, next) => {
  itemStates[key] = { ...(itemStates[key] || {}), ...next };
};

const resetSelection = () => {
  selectedKeys.value = items.value.map((item) => item.key);
  clearItemStates();
};

const selectAll = () => {
  selectedKeys.value = items.value.map((item) => item.key);
};

const selectNone = () => {
  selectedKeys.value = [];
};

const invertSelection = () => {
  const selected = new Set(selectedKeys.value);
  selectedKeys.value = items.value.filter((item) => !selected.has(item.key)).map((item) => item.key);
};

const runWithConcurrency = async (list, limit, worker) => {
  const queue = [...list];
  const size = Math.max(1, Math.min(Number(limit) || 1, queue.length || 1));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
};

/** 判断能否直接复用面板里已经载入的弹幕，避免重复请求 */
const pickLoadedDanmaku = (item) => {
  if (!reuseLoaded.value) return null;
  const mgr = props.dmMgr;
  if (!mgr?.info?.cid || String(mgr.info.cid) !== String(item?.cid)) return null;
  const list = mgr.data?.danmaku_list;
  if (!Array.isArray(list) || !list.length) return null;
  return { list: [...list], view: mgr.data?.danmaku_view || null, reused: true };
};

const fetchItemDanmaku = async (item) => {
  const loaded = pickLoadedDanmaku(item);
  if (loaded) return loaded;

  if (!BDM?.BiliDanmaku) throw new Error('BDM 不可用');
  const info = buildItemDanmakuInfo(item, props.collection);
  if (!info.cid || !info.aid) throw new Error('缺少 cid/aid');

  const mgr = new BDM.BiliDanmaku(info);
  if (dmSource.value === 'pb' || dmSource.value === 'both') {
    const rise = Number(await mgr.getDmPb()) || 0;
    if (rise < 0) throw new Error('ProtoBuf 弹幕获取失败');
  }
  if (dmSource.value === 'xml' || dmSource.value === 'both') {
    const rise = Number(await mgr.getDmXml()) || 0;
    if (rise < 0) throw new Error('XML 实时弹幕获取失败');
  }

  const list = mgr.data?.danmaku_list || [];
  const errors = mgr.errors || {};
  const errorCount = (errors.segments?.length || 0) + (errors.dates?.length || 0);
  return {
    list: [...list],
    view: mgr.data?.danmaku_view || null,
    reused: false,
    partial: errorCount > 0,
    errorCount,
  };
};

const buildItemJsonPayload = (item, result) => ({
  info: buildItemDanmakuInfo(item, props.collection),
  fetchtime: Math.floor(Date.now() / 1000),
  danmaku_view: result.view || null,
  commandDms: result.view?.commandDms || [],
  danmaku_list: result.list,
});

const outputSingleFile = (fileName, text, mime) => {
  downloadText(text, fileName, mime);
};

const runDownload = async () => {
  const collection = props.collection;
  if (!collection) return;
  if (downloading.value) return;
  if (!selectedKeys.value.length) {
    emit('set-error', '请先选择要下载的集');
    return;
  }

  const targets = items.value.filter((item) => selectedKeys.value.includes(item.key));
  if (!targets.length) {
    emit('set-error', '请先选择要下载的集');
    return;
  }

  downloading.value = true;
  emit('update:loading', true);
  emit('set-error', '');
  clearItemStates();
  resetProgress(targets.length);

  const mergedItems = [];
  const zipFiles = [];
  const usedNames = new Set();
  let failed = 0;
  let empty = 0;

  try {
    await runWithConcurrency(targets, concurrency.value, async (item) => {
      setItemState(item.key, { status: 'loading' });
      progress.text = `正在拉取：${item.title}`;
      try {
        const result = await fetchItemDanmaku(item);
        const count = result.list.length;
        if (!count) empty += 1;
        progress.dmCount += count;
        setItemState(item.key, {
          status: 'done',
          count,
          reused: result.reused,
          partial: result.partial,
          errorCount: result.errorCount || 0,
        });

        if (outputFormat.value === 'json-merged') {
          mergedItems.push({ ...buildItemJsonPayload(item, result), index: item.index + 1 });
        } else if (outputFormat.value === 'xml-zip') {
          const meta = pickXmlMetaFromView(result.view);
          const xml = buildDanmakuXml(result.list, { cid: item.cid, ...meta });
          const name = uniqueZipName(
            usedNames,
            buildDmXmlFileName({
              index: item.index + 1,
              total: collection.total,
              title: item.title,
              cid: item.cid,
            }),
          );
          zipFiles.push({ name, data: xml });
        } else {
          const name = uniqueZipName(
            usedNames,
            buildDmXmlFileName({
              index: item.index + 1,
              total: collection.total,
              title: item.title,
              cid: item.cid,
              suffix: 'json',
            }),
          );
          zipFiles.push({ name, data: JSON.stringify(buildItemJsonPayload(item, result), null, 2) });
        }
      } catch (error) {
        failed += 1;
        setItemState(item.key, { status: 'error', error: String(error?.message || error) });
      } finally {
        progress.finished += 1;
      }
    });

    if (!zipFiles.length && !mergedItems.length) {
      throw new Error('没有任何弹幕被导出，请检查所选范围');
    }

    if (outputFormat.value === 'json-merged') {
      const payload = {
        collection: {
          kind: collection.kind,
          title: collection.title,
          seasonId: collection.seasonId,
          mid: collection.mid,
          total: collection.total,
        },
        fetchtime: Math.floor(Date.now() / 1000),
        items: mergedItems.sort((a, b) => a.index - b.index),
      };
      downloadJson(payload, buildCollectionFileName(collection, 'json'), 2);
    } else if (zipFiles.length === 1) {
      const single = zipFiles[0];
      const isXml = outputFormat.value === 'xml-zip';
      outputSingleFile(
        single.name,
        single.data,
        isXml ? 'text/xml;charset=utf-8' : 'application/json;charset=utf-8',
      );
    } else {
      const bodyPrefix = outputFormat.value === 'xml-zip' ? 'danmaku' : 'data';
      const zipBlob = createZipBlob(
        zipFiles.map((file) => ({ name: `${bodyPrefix}/${file.name}`, data: file.data })),
      );
      downloadBlob(zipBlob, buildCollectionFileName(collection, 'zip'));
    }

    const summary = [
      `成功 ${targets.length - failed} 集`,
      failed ? `失败 ${failed} 集` : '',
      empty ? `空弹幕 ${empty} 集` : '',
      `共 ${progress.dmCount.toLocaleString()} 条弹幕`,
    ]
      .filter(Boolean)
      .join('，');
    if (failed) {
      emit('set-error', `合集弹幕下载完成：${summary}`);
      message.warning(summary);
    } else {
      message.success(summary);
    }
  } catch (error) {
    const msg = String(error?.message || error);
    emit('set-error', msg);
    message.error(msg);
  } finally {
    downloading.value = false;
    emit('update:loading', false);
    progress.text = '';
  }
};

watch(
  () => props.collection,
  () => {
    resetSelection();
  },
  { immediate: true },
);

watch(selectedKeys, (value) => {
  if (!downloading.value) clearItemStates();
  if (!Array.isArray(value)) selectedKeys.value = [];
});

watch(dmSource, (value) => storage.set('dmCollection.source', value));
watch(outputFormat, (value) => storage.set('dmCollection.format', value));
watch(concurrency, (value) => storage.set('dmCollection.concurrency', Number(value) || 2));
watch(reuseLoaded, (value) => storage.set('dmCollection.reuseLoaded', Boolean(value)));
</script>

<template>
  <div class="bds-dm-collection-panel">
    <n-alert v-if="collection" type="info" :show-icon="false" class="bds-dm-collection-panel__summary">
      <n-flex align="center" :size="8" wrap>
        <n-text strong>{{ collection.sourceLabel }}：{{ collection.title }}</n-text>
        <n-tag size="small" type="info">共 {{ collection.total }} 集</n-tag>
        <n-tag v-if="selectedCount !== collection.total" size="small" type="warning">
          已选 {{ selectedCount }} 集
        </n-tag>
      </n-flex>
    </n-alert>

    <n-flex :size="12" align="center" wrap class="bds-dm-collection-panel__options">
      <n-select v-model:value="dmSource" size="small" :options="SOURCE_OPTIONS" :disabled="downloading"
        class="bds-dm-collection-panel__select" :to="props.to" />
      <n-select v-model:value="outputFormat" size="small" :options="FORMAT_OPTIONS" :disabled="downloading"
        class="bds-dm-collection-panel__select" :to="props.to" />
      <n-flex align="center" :size="4">
        <n-text depth="3">并发</n-text>
        <n-input-number v-model:value="concurrency" size="small" :min="1" :max="4" :disabled="downloading"
          class="bds-dm-collection-panel__number" />
      </n-flex>
      <n-checkbox v-model:checked="reuseLoaded" size="small" :disabled="downloading">
        复用已载入弹幕
      </n-checkbox>
      <n-tooltip trigger="hover" placement="top" :to="props.to">
        <template #trigger>
          <n-button size="tiny" quaternary circle class="bds-dm-collection-panel__hint-btn">
            <n-icon :component="InfoCircle" />
          </n-button>
        </template>
        批量下载会连续请求多个稿件的弹幕接口，请控制并发与频率，避免触发 B 站风控。
      </n-tooltip>
    </n-flex>

    <n-flex :size="8" align="center" wrap>
      <n-button size="small" :disabled="downloading" @click="selectAll">全选</n-button>
      <n-button size="small" :disabled="downloading" @click="selectNone">全不选</n-button>
      <n-button size="small" :disabled="downloading" @click="invertSelection">反选</n-button>
      <n-button size="small" type="primary" :loading="downloading" :disabled="!selectedCount"
        @click="runDownload">
        下载选中弹幕（{{ selectedCount }}）
      </n-button>
    </n-flex>

    <n-checkbox-group v-model:value="selectedKeys">
      <div class="bds-dm-collection-panel__list">
        <template v-for="section in sections" :key="section.id">
          <div v-if="sections.length > 1" class="bds-dm-collection-panel__section">
            {{ section.title }}（{{ section.items.length }}）
          </div>
          <div v-for="item in section.items" :key="item.key" class="bds-dm-collection-panel__item"
            :class="{ 'is-current': isItemCurrent(item) }">
            <label class="bds-dm-collection-panel__item-label">
              <n-checkbox :value="item.key" :disabled="downloading" />
              <span class="bds-dm-collection-panel__item-index">{{ item.index + 1 }}</span>
              <span class="bds-dm-collection-panel__item-title" :title="item.title">{{ item.title }}</span>
              <span class="bds-dm-collection-panel__item-duration">{{ formatDuration(item.duration) }}</span>
              <n-tag v-if="isItemCurrent(item)" size="small" type="success" :bordered="false">当前</n-tag>
              <n-tag v-if="itemStates[item.key]?.status === 'loading'" size="small" type="info">拉取中</n-tag>
              <n-tag v-else-if="itemStates[item.key]?.status === 'done'" size="small" type="success">
                {{ itemStates[item.key].count.toLocaleString() }} 条
                <template v-if="itemStates[item.key].reused">（复用）</template>
                <template v-else-if="itemStates[item.key].partial">（部分失败）</template>
              </n-tag>
              <n-tag v-else-if="itemStates[item.key]?.status === 'error'" size="small" type="error"
                :title="itemStates[item.key].error">失败</n-tag>
            </label>
            <n-button size="tiny" quaternary tag="a" :href="buildItemPageUrl(item, collection)" target="_blank"
              class="bds-dm-collection-panel__item-link" title="打开该集页面">
              打开
            </n-button>
          </div>
        </template>
      </div>
    </n-checkbox-group>

    <n-flex v-if="downloading || progress.total" align="center" :size="12" wrap
      class="bds-dm-collection-panel__progress-row">
      <n-progress type="line" :percentage="progressPercent" class="bds-dm-collection-panel__progress" />
      <n-text depth="2">{{ progress.finished }}/{{ progress.total }} 集</n-text>
      <n-text depth="3">累计 {{ progress.dmCount.toLocaleString() }} 条</n-text>
      <n-text v-if="progress.text" depth="3">{{ progress.text }}</n-text>
    </n-flex>
  </div>
</template>
