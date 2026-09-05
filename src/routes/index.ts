import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Lunar } from 'lunar-typescript';
import { config } from '../config';
import { computeBaZi, getAlmanac, hkToday, hkYear, hkNow, getCalendarMonth } from '../services/baziService';
import { generateEventAdvice, EVENT_TYPES } from '../services/eventService';
import { generateDailyLucky } from '../services/luckyService';
import { isRegion, REGION_GIFTS, REGION_LABELS } from '../data/customRegions';
import { generateDailyAdvice, generateAnnualAdvice, enhanceDailyLucky, hasApiKey, availableProviders, FALLBACK_YEAR } from '../services/aiService';
import { getArticles, searchArticles, cacheGet, cacheSet, upsertSubscription, getSubscription } from '../services/store';
import { verifyGoogleSubscription, hasServiceAccount, ALLOWED_PRODUCT_IDS } from '../services/purchaseService';
import { runScrapeOnce } from '../services/scraperService';
import { ancientLib } from '../services/ancientService';
import { FALLBACK_ZODIAC } from '../data/fallbackData';
import { tw } from '../utils/zhTradition';
import type { BirthInput } from '../types';

function birthKey(b: BirthInput): string {
  return createHash('sha1').update(
    `${b.year}|${b.month}|${b.day}|${b.hour}|${b.minute}|${b.gender}|${b.isLunar}|${!!b.isLeap}|${b.longitude ?? 'HK'}`,
  ).digest('hex').slice(0, 12);
}

function validBirth(b: unknown): b is BirthInput {
  if (typeof b !== 'object' || b == null) return false;
  const o = b as BirthInput;
  return typeof o.year === 'number' && typeof o.month === 'number' && typeof o.day === 'number'
    && typeof o.gender === 'number';
}

/** 校验 YYYY-MM-DD 是否为真实存在的日期（防 2026-13-05 / 02-31 之类导致底层日历库抛错） */
function validDateStr(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || day < 1 || day > 31) return false;
  const dt = new Date(y, m - 1, day);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === day;
}

function sanitizeBirth(b: BirthInput): BirthInput | null {
  const { year, month, day, gender } = b;
  const isLunar = !!b.isLunar;
  const isLeap = !!b.isLeap && isLunar;
  const hour = b.hour ?? 0;
  const minute = b.minute ?? 0;
  const longitude = b.longitude;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (gender !== 0 && gender !== 1) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) return null;
  // 农历：校验该年该月是否真的存在（含闰月判定、本月天数），避免底层日历库抛错
  if (isLunar) {
    try {
      const l = Lunar.fromYmd(year, isLeap ? -month : month, day);
      if (!l) return null;
    } catch {
      return null;
    }
  } else {
    const dim = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > dim[month - 1]) return null;
  }
  return { year, month, day, hour, minute, gender, isLunar, isLeap, longitude };
}

function aiModeName(): string {
  if (!hasApiKey()) return '本地规则(未配置 API Key)';
  const providers = availableProviders();
  return providers.join(' → ');
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // 所有响应统一转繁体输出
  app.addHook('onSend', async (_req, reply, payload) => {
    if (typeof payload === 'string' && (payload.startsWith('{') || payload.startsWith('['))) {
      try {
        return JSON.stringify(tw(JSON.parse(payload)));
      } catch {
        return payload;
      }
    }
    return payload;
  });

  // 服务状态
  app.get('/api/health', async () => ({
    ok: true,
    apiKey: hasApiKey(),
    aiMode: aiModeName(),
    aiProviders: availableProviders(),
  }));

  // 八字排盘
  app.post<{ Body: Partial<BirthInput> }>('/api/bazi', async (req, reply) => {
    if (!validBirth(req.body)) {
      return reply.code(400).send({ error: '参数不完整：需要 year/month/day/gender' });
    }
    const birth = sanitizeBirth(req.body as BirthInput);
    if (!birth) return reply.code(400).send({ error: '出生日期或时间不合法' });
    try {
      return computeBaZi(birth);
    } catch {
      return reply.code(400).send({ error: '无法解析该出生日期（可能农历日期不存在）' });
    }
  });

  // 每日黄历（本地，无需AI）
  app.get<{ Querystring: { date?: string } }>('/api/daily', async (req, reply) => {
    const d = req.query.date ?? hkToday();
    if (!validDateStr(d)) return reply.code(400).send({ error: 'date 应为 YYYY-MM-DD 内的有效日期' });
    try {
      return getAlmanac(d);
    } catch {
      return reply.code(400).send({ error: '无法解析该日期' });
    }
  });

  // 今日个性化宜忌（八字+黄历+大师文章 → AI）
  app.post<{ Body: { birth: BirthInput; date?: string; region?: string } }>('/api/daily/advice', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = req.body?.birth;
    if (!validBirth(b)) return reply.code(400).send({ error: '参数不完整：需要 birth{year,month,day,hour,gender,isLunar}' });
    const birth = sanitizeBirth(b as BirthInput);
    if (!birth) return reply.code(400).send({ error: '出生日期或时间不合法' });
    const date = req.body.date ?? hkToday();
    if (!validDateStr(date)) return reply.code(400).send({ error: 'date 应为 YYYY-MM-DD 内的有效日期' });
    const region = isRegion(req.body?.region) ? req.body.region : 'hk';
    const key = `daily:${date}:${birthKey(birth)}`;
    const cached = cacheGet(key, 24 * 60 * 60 * 1000); // 每日宜忌缓存 1 天，次日自动重算
    if (cached) {
      // 台湾不展示香港大师署名
      if (region === 'tw' && cached && typeof cached === 'object') {
        const c = cached as { sources?: string[] };
        if (Array.isArray(c.sources)) c.sources = [];
      }
      return cached;
    }

    const [range, bazi, almanac] = await Promise.all([
      getArticles(30),
      (async () => {
        try {
          return computeBaZi(birth);
        } catch {
          throw Object.assign(new Error('无法解析该出生日期（可能农历日期不存在）'), { statusCode: 400 });
        }
      })(),
      Promise.resolve(getAlmanac(date)),
    ]);
    const articles = searchArticles('运程').concat(searchArticles('风水')).concat(range)
      .filter((a, i, arr) => arr.findIndex(x => x.url === a.url) === i).slice(0, 8);
    const advice = await generateDailyAdvice({ date, almanac, bazi, articles });
    if (region === 'tw') advice.sources = [];

    // 仅缓存 AI 模式结果；本地兜底结果不缓存（下一次 AI 恢复后自动换回 AI）
    if (advice.mode === 'ai') cacheSet(key, advice, 24 * 60 * 60 * 1000);
    return advice;
  });

  // 某生肖年度运程（内置兜底数据）
  app.get<{ Querystring: { zodiac?: string; year?: string } }>('/api/annual', async (req, reply) => {
    const yearRaw = Number(req.query.year || FALLBACK_YEAR);
    const year = Number.isFinite(yearRaw) ? yearRaw : FALLBACK_YEAR;
    const zodiac = req.query.zodiac || '';
    if (zodiac && FALLBACK_ZODIAC[zodiac]) return { year, zodiac, info: FALLBACK_ZODIAC[zodiac] };
    if (zodiac && !FALLBACK_ZODIAC[zodiac]) return reply.code(404).send({ error: `未知生肖：${zodiac}` });
    return { year, note: '请指定 zodiac 参数（鼠牛虎兔龙蛇马羊猴鸡狗猪 之一）' };
  });

  // 流年方位 + 出行建议（八字+大师方位数据 → AI）
  app.post<{ Body: { birth: BirthInput; year?: number; region?: string } }>('/api/annual/advice', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = req.body?.birth;
    if (!validBirth(b)) return reply.code(400).send({ error: '参数不完整：需要 birth 信息' });
    const birth = sanitizeBirth(b as BirthInput);
    if (!birth) return reply.code(400).send({ error: '出生日期或时间不合法' });
    const year = req.body.year ?? hkYear();
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return reply.code(400).send({ error: 'year 超出支持范围' });
    }
    const region = isRegion(req.body?.region) ? req.body.region : 'hk';
    let bazi;
    try {
      bazi = computeBaZi(birth);
    } catch {
      return reply.code(400).send({ error: '无法解析该出生日期（可能农历日期不存在）' });
    }
    const zodiac = bazi.shengXiao;
    const key = `annual:${year}:${zodiac}:${birthKey(birth)}`;
    const cached = cacheGet(key, 30 * 24 * 60 * 60 * 1000); // 流年建议缓存 30 天
    if (cached) {
      // 台湾不展示香港大师署名
      if (region === 'tw' && cached && typeof cached === 'object') {
        const c = cached as { masterSources?: string[] };
        if (Array.isArray(c.masterSources)) c.masterSources = [];
      }
      return cached;
    }

    const articles = getArticles(50)
      .filter(a => /运程|流年|方位|风水|犯太/.test(String(tw(a.title))) || (a.keywords || []).some(k => /运程|流年|方位|风水|犯太/.test(String(tw(k)))))
      .slice(0, 8);
    const advice = await generateAnnualAdvice({ year, zodiac, bazi, articles });
    if (region === 'tw') advice.masterSources = [];
    // 仅缓存 AI 模式结果；本地兜底结果不缓存（下一次 AI 恢复后自动换回 AI）
    if (advice.mode === 'ai') cacheSet(key, advice, 30 * 24 * 60 * 60 * 1000);
    return advice;
  });

  // 大师文章库
  app.get<{ Querystring: { keyword?: string; limit?: string } }>('/api/master/articles', async (req, reply) => {
    const limitRaw = Number(req.query.limit || 30);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 30;
    const kw = req.query.keyword;
    const list = kw ? searchArticles(kw, limit) : getArticles(limit);
    return { count: list.length, articles: list.map(a => ({
      id: a.id, url: a.url, title: a.title, source: a.source,
      summary: a.summary, publishedAt: a.publishedAt, keywords: a.keywords,
    })) };
  });

  // 手动触发抓取（耗资源，严格限流）
  app.post('/api/scrape', {
    config: { rateLimit: { max: 1, timeWindow: '5 minute' } },
  }, async () => {
    const result = await runScrapeOnce();
    return result;
  });

  // 古籍书目列表
  app.get('/api/ancient/books', async () => {
    const list = ancientLib.lists;
    return {
      count: list.length,
      disclaimer: '以下古籍均出自公开典籍，内容为传统文化整理，仅供参考。',
      books: list.map((b) => ({ id: b.id, title: b.title, intro: b.intro, chars: b.chars })),
    };
  });

  // 古籍正文（按 id 读取）
  app.get<{ Querystring: { id?: string } }>('/api/ancient/read', async (req, reply) => {
    const id = (req.query.id || '').trim();
    if (!id) return reply.code(400).send({ error: '请指定 id 参数（古籍书目之一）' });
    const text = ancientLib.read(id);
    if (!text) return reply.code(404).send({ error: `未找到古籍：${id}` });
    return { id, title: null, content: text };
  });

  // 古籍检索（跨书查句）
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/ancient/search', async (req, reply) => {
    const qRaw = (req.query.q || '').trim();
    const limitRaw = Number(req.query.limit || 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.trunc(limitRaw))) : 10;
    if (!qRaw) return reply.code(400).send({ error: '请指定 q 参数（要检索的关键词）' });
    const hits = ancientLib.search(String(tw(qRaw)), limit);
    return { query: qRaw, count: hits.length, hits };
  });

  // 万年历：某月逐日黄历（本地计算，无 AI）
  app.get<{ Querystring: { year?: string; month?: string } }>('/api/calendar', async (req, reply) => {
    const y = Number(req.query.year || hkYear());
    const m = Number(req.query.month || (hkNow().getMonth() + 1));
    if (!Number.isInteger(y) || y < 1900 || y > 2100) return reply.code(400).send({ error: 'year 需在 1900-2100 之间' });
    if (!Number.isInteger(m) || m < 1 || m > 12) return reply.code(400).send({ error: 'month 需在 1-12 之间' });
    return getCalendarMonth(y, m);
  });

  // 要事类型列表
  app.get('/api/event/types', async () => ({
    types: EVENT_TYPES.map(t => ({ type: t.type, icon: t.icon, gift: t.gift })),
  }));

  // 要事择吉：结合当日黄历 + 用户八字喜忌给出吉凶与化解
  app.post<{ Body: { birth?: BirthInput; eventType?: string; date?: string; region?: string } }>('/api/event/advice', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = req.body?.birth;
    const eventType = String(req.body?.eventType || '');
    const date = String(req.body?.date || '');
    const region = isRegion(req.body?.region) ? req.body.region : 'hk';
    if (!b || !validBirth(b)) return reply.code(400).send({ error: '参数不完整：需要 birth 信息' });
    // 前端拿到的是繁体（如「動土」），服务端字典是简体（如「动土」），双向都匹配
    const et = EVENT_TYPES.find(e => e.type === eventType || tw(e.type) === tw(eventType));
    if (!et) {
      return reply.code(400).send({ error: `eventType 需为：${EVENT_TYPES.map(e => e.type).join('/')} 之一` });
    }
    if (!validDateStr(date)) return reply.code(400).send({ error: 'date 应为 YYYY-MM-DD 内的有效日期' });
    const birth = sanitizeBirth(b);
    if (!birth) return reply.code(400).send({ error: '出生日期或时间不合法' });
    try {
      return generateEventAdvice({ birth, eventType: et.type, date, region });
    } catch (e) {
      reply.log.error({ err: e }, '事项择吉计算异常');
      return reply.code(400).send({ error: '该日期无法解析，请更换日期' });
    }
  });

  // 每日开运关键词（本地规则 + AI 解读增强）：五行/天干/地支/方位/时辰/色彩 意象 + 彩讯数字意象
  app.post<{ Body: { birth: BirthInput; date?: string; region?: string } }>('/api/lucky/daily', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = req.body?.birth;
    if (!validBirth(b)) return reply.code(400).send({ error: '参数不完整：需要 birth{year,month,day,hour,gender,isLunar}' });
    const birth = sanitizeBirth(b as BirthInput);
    if (!birth) return reply.code(400).send({ error: '出生日期或时间不合法' });
    const date = req.body.date ?? hkToday();
    if (!validDateStr(date)) return reply.code(400).send({ error: 'date 应为 YYYY-MM-DD 内的有效日期' });
    const region = isRegion(req.body?.region) ? req.body.region : 'hk';
    const key = `lucky:${date}:${region}:${birthKey(birth)}`;
    const cached = cacheGet(key, 24 * 60 * 60 * 1000); // 每日关键词缓存 1 天
    if (cached) return cached;
    let result;
    try {
      result = generateDailyLucky({ birth, date, region });
    } catch (e) {
      reply.log.error({ err: e }, '开运关键词生成异常');
      return reply.code(400).send({ error: '该出生日期无法解析，请检查输入' });
    }
    // AI 解读增强：AI 可用时用 AI 重写牌面释义与彩讯暗示；失败则保留本地结果
    if (hasApiKey()) {
      try {
        const [range, bazi, almanac] = await Promise.all([
          getArticles(20),
          Promise.resolve(computeBaZi(birth)),
          Promise.resolve(getAlmanac(date)),
        ]);
        const articles = searchArticles('运程').concat(searchArticles('风水')).concat(range)
          .filter((a, i, arr) => arr.findIndex(x => x.url === a.url) === i).slice(0, 5);
        result = await enhanceDailyLucky({ result, bazi, almanac, articles, region });
      } catch (e) {
        reply.log.error({ err: e }, '开运六牌 AI 解读失败，使用本地结果');
      }
    }
    // 仅缓存 AI 增强结果；纯本地结果不缓存（AI 恢复后自动换回）
    if (result.mode === 'ai') cacheSet(key, result, 24 * 60 * 60 * 1000);
    return result;
  });

  // 地区礼俗速查（送礼忌讳/佳礼；按谐音语系返回，前端「速查卡」用）
  app.get<{ Querystring: { region?: string } }>('/api/region/gifts', async (req, reply) => {
    const region = isRegion(req.query.region) ? req.query.region : 'hk';
    const g = REGION_GIFTS[region];
    return { region, label: REGION_LABELS[region], langNote: g.langNote, taboos: g.taboos, tips: g.tips };
  });

  // 订阅校验：客户端购买后上报 purchaseToken，服务端调 Google Play API 验证并落库
  app.post<{ Body: { platform?: string; productId?: string; purchaseToken?: string; deviceId?: string } }>(
    '/api/purchase/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { platform, productId, purchaseToken, deviceId } = req.body || {};
      if (platform !== 'google') return reply.code(400).send({ error: '当前仅支持 google 平台' });
      if (!productId || !ALLOWED_PRODUCT_IDS.includes(productId)) {
        return reply.code(400).send({ error: `productId 需为：${ALLOWED_PRODUCT_IDS.join('/')} 之一` });
      }
      if (!purchaseToken || typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 4096) {
        return reply.code(400).send({ error: 'purchaseToken 不合法' });
      }
      if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
        return reply.code(400).send({ error: 'deviceId 不合法' });
      }
      try {
        const result = await verifyGoogleSubscription(productId, purchaseToken);
        upsertSubscription({
          deviceId,
          productId: result.productId,
          purchaseToken,
          status: result.status,
          expiryMs: result.expiryTimeMillis,
          autoRenewing: result.autoRenewing,
          verifiedMode: result.verifiedMode,
        });
        return {
          productId: result.productId,
          status: result.status,
          expiryTimeMillis: result.expiryTimeMillis,
          autoRenewing: result.autoRenewing,
        };
      } catch (e) {
        const err = e as { statusCode?: number; message?: string };
        if (err.statusCode === 400) return reply.code(400).send({ error: err.message });
        reply.log.error({ err: e }, '订阅校验异常');
        return reply.code(502).send({ error: '订阅校验暂时不可用，请稍后重试' });
      }
    },
  );

  // 查询订阅状态（App 启动时同步；过期且可校验时自动向 Google 刷新一次）
  app.get<{ Querystring: { deviceId?: string } }>('/api/user/subscription', async (req, reply) => {
    const deviceId = String(req.query.deviceId || '');
    if (!deviceId || deviceId.length < 8 || deviceId.length > 64) {
      return reply.code(400).send({ error: 'deviceId 不合法' });
    }
    const row = getSubscription(deviceId);
    if (!row) return { status: 'none' };
    const expired = row.expiryMs > 0 && row.expiryMs < Date.now();
    if (expired && hasServiceAccount() && row.purchaseToken) {
      // 已到期：向 Google 刷新（可能已续费）
      try {
        const fresh = await verifyGoogleSubscription(row.productId, row.purchaseToken);
        upsertSubscription({
          deviceId,
          productId: fresh.productId,
          purchaseToken: row.purchaseToken,
          status: fresh.status,
          expiryMs: fresh.expiryTimeMillis,
          autoRenewing: fresh.autoRenewing,
          verifiedMode: fresh.verifiedMode,
        });
        return {
          productId: fresh.productId,
          status: fresh.status,
          expiryTimeMillis: fresh.expiryTimeMillis,
          autoRenewing: fresh.autoRenewing,
        };
      } catch {
        // Google 不可达时按本地过期处理
      }
    }
    return {
      productId: row.productId,
      status: expired ? 'expired' : row.status,
      expiryTimeMillis: row.expiryMs,
      autoRenewing: row.autoRenewing,
    };
  });
}