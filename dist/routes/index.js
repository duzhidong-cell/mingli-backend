"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoutes = registerRoutes;
const node_crypto_1 = require("node:crypto");
const lunar_typescript_1 = require("lunar-typescript");
const baziService_1 = require("../services/baziService");
const eventService_1 = require("../services/eventService");
const luckyService_1 = require("../services/luckyService");
const customRegions_1 = require("../data/customRegions");
const aiService_1 = require("../services/aiService");
const store_1 = require("../services/store");
const purchaseService_1 = require("../services/purchaseService");
const scraperService_1 = require("../services/scraperService");
const ancientService_1 = require("../services/ancientService");
const fallbackData_1 = require("../data/fallbackData");
const zhTradition_1 = require("../utils/zhTradition");
function birthKey(b) {
    return (0, node_crypto_1.createHash)('sha1').update(`${b.year}|${b.month}|${b.day}|${b.hour}|${b.minute}|${b.gender}|${b.isLunar}|${!!b.isLeap}|${b.longitude ?? 'HK'}`).digest('hex').slice(0, 12);
}
function validBirth(b) {
    if (typeof b !== 'object' || b == null)
        return false;
    const o = b;
    return typeof o.year === 'number' && typeof o.month === 'number' && typeof o.day === 'number'
        && typeof o.gender === 'number';
}
/** 校验 YYYY-MM-DD 是否为真实存在的日期（防 2026-13-05 / 02-31 之类导致底层日历库抛错） */
function validDateStr(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        return false;
    const [y, m, day] = d.split('-').map(Number);
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || day < 1 || day > 31)
        return false;
    const dt = new Date(y, m - 1, day);
    return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === day;
}
function sanitizeBirth(b) {
    const { year, month, day, gender } = b;
    const isLunar = !!b.isLunar;
    const isLeap = !!b.isLeap && isLunar;
    const hour = b.hour ?? 0;
    const minute = b.minute ?? 0;
    const longitude = b.longitude;
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day))
        return null;
    if (year < 1900 || year > 2100)
        return null;
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return null;
    if (gender !== 0 && gender !== 1)
        return null;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23)
        return null;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59)
        return null;
    if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
        return null;
    // 农历：校验该年该月是否真的存在（含闰月判定、本月天数），避免底层日历库抛错
    if (isLunar) {
        try {
            const l = lunar_typescript_1.Lunar.fromYmd(year, isLeap ? -month : month, day);
            if (!l)
                return null;
        }
        catch {
            return null;
        }
    }
    else {
        const dim = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day > dim[month - 1])
            return null;
    }
    return { year, month, day, hour, minute, gender, isLunar, isLeap, longitude };
}
function aiModeName() {
    if (!(0, aiService_1.hasApiKey)())
        return '本地规则(未配置 API Key)';
    const providers = (0, aiService_1.availableProviders)();
    return providers.join(' → ');
}
async function registerRoutes(app) {
    // 所有响应统一转繁体输出
    app.addHook('onSend', async (_req, reply, payload) => {
        if (typeof payload === 'string' && (payload.startsWith('{') || payload.startsWith('['))) {
            try {
                return JSON.stringify((0, zhTradition_1.tw)(JSON.parse(payload)));
            }
            catch {
                return payload;
            }
        }
        return payload;
    });
    // 服务状态
    app.get('/api/health', async () => ({
        ok: true,
        apiKey: (0, aiService_1.hasApiKey)(),
        aiMode: aiModeName(),
        aiProviders: (0, aiService_1.availableProviders)(),
    }));
    // 八字排盘
    app.post('/api/bazi', async (req, reply) => {
        if (!validBirth(req.body)) {
            return reply.code(400).send({ error: '参数不完整：需要 year/month/day/gender' });
        }
        const birth = sanitizeBirth(req.body);
        if (!birth)
            return reply.code(400).send({ error: '出生日期或时间不合法' });
        try {
            return (0, baziService_1.computeBaZi)(birth);
        }
        catch {
            return reply.code(400).send({ error: '无法解析该出生日期（可能农历日期不存在）' });
        }
    });
    // 每日黄历（本地，无需AI）
    app.get('/api/daily', async (req, reply) => {
        const d = req.query.date ?? (0, baziService_1.hkToday)();
        if (!validDateStr(d))
            return reply.code(400).send({ error: 'date 应为 YYYY-MM-DD 内的有效日期' });
        try {
            return (0, baziService_1.getAlmanac)(d);
        }
        catch {
            return reply.code(400).send({ error: '无法解析该日期' });
        }
    });
    // 今日个性化宜忌（八字+黄历+大师文章 → AI）
    app.post('/api/daily/advice', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const b = req.body?.birth;
        if (!validBirth(b))
            return reply.code(400).send({ error: '参数不完整：需要 birth{year,month,day,hour,gender,isLunar}' });
        const birth = sanitizeBirth(b);
        if (!birth)
            return reply.code(400).send({ error: '出生日期或时间不合法' });
        const date = req.body.date ?? (0, baziService_1.hkToday)();
        if (!validDateStr(date))
            return reply.code(400).send({ error: 'date 应为 YYYY-MM-DD 内的有效日期' });
        const region = (0, customRegions_1.isRegion)(req.body?.region) ? req.body.region : 'hk';
        const key = `daily:${date}:${birthKey(birth)}`;
        const cached = (0, store_1.cacheGet)(key, 24 * 60 * 60 * 1000); // 每日宜忌缓存 1 天，次日自动重算
        if (cached) {
            // 台湾不展示香港大师署名
            if (region === 'tw' && cached && typeof cached === 'object') {
                const c = cached;
                if (Array.isArray(c.sources))
                    c.sources = [];
            }
            return cached;
        }
        const [range, bazi, almanac] = await Promise.all([
            (0, store_1.getArticles)(30),
            (async () => {
                try {
                    return (0, baziService_1.computeBaZi)(birth);
                }
                catch {
                    throw Object.assign(new Error('无法解析该出生日期（可能农历日期不存在）'), { statusCode: 400 });
                }
            })(),
            Promise.resolve((0, baziService_1.getAlmanac)(date)),
        ]);
        const articles = (0, store_1.searchArticles)('运程').concat((0, store_1.searchArticles)('风水')).concat(range)
            .filter((a, i, arr) => arr.findIndex(x => x.url === a.url) === i).slice(0, 8);
        const advice = await (0, aiService_1.generateDailyAdvice)({ date, almanac, bazi, articles });
        if (region === 'tw')
            advice.sources = [];
        // 仅缓存 AI 模式结果；本地兜底结果不缓存（下一次 AI 恢复后自动换回 AI）
        if (advice.mode === 'ai')
            (0, store_1.cacheSet)(key, advice, 24 * 60 * 60 * 1000);
        return advice;
    });
    // 某生肖年度运程（内置兜底数据）
    app.get('/api/annual', async (req, reply) => {
        const yearRaw = Number(req.query.year || aiService_1.FALLBACK_YEAR);
        const year = Number.isFinite(yearRaw) ? yearRaw : aiService_1.FALLBACK_YEAR;
        const zodiac = req.query.zodiac || '';
        if (zodiac && fallbackData_1.FALLBACK_ZODIAC[zodiac])
            return { year, zodiac, info: fallbackData_1.FALLBACK_ZODIAC[zodiac] };
        if (zodiac && !fallbackData_1.FALLBACK_ZODIAC[zodiac])
            return reply.code(404).send({ error: `未知生肖：${zodiac}` });
        return { year, note: '请指定 zodiac 参数（鼠牛虎兔龙蛇马羊猴鸡狗猪 之一）' };
    });
    // 流年方位 + 出行建议（八字+大师方位数据 → AI）
    app.post('/api/annual/advice', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const b = req.body?.birth;
        if (!validBirth(b))
            return reply.code(400).send({ error: '参数不完整：需要 birth 信息' });
        const birth = sanitizeBirth(b);
        if (!birth)
            return reply.code(400).send({ error: '出生日期或时间不合法' });
        const year = req.body.year ?? (0, baziService_1.hkYear)();
        if (!Number.isInteger(year) || year < 1900 || year > 2100) {
            return reply.code(400).send({ error: 'year 超出支持范围' });
        }
        const region = (0, customRegions_1.isRegion)(req.body?.region) ? req.body.region : 'hk';
        let bazi;
        try {
            bazi = (0, baziService_1.computeBaZi)(birth);
        }
        catch {
            return reply.code(400).send({ error: '无法解析该出生日期（可能农历日期不存在）' });
        }
        const zodiac = bazi.shengXiao;
        const key = `annual:${year}:${zodiac}:${birthKey(birth)}`;
        const cached = (0, store_1.cacheGet)(key, 30 * 24 * 60 * 60 * 1000); // 流年建议缓存 30 天
        if (cached) {
            // 台湾不展示香港大师署名
            if (region === 'tw' && cached && typeof cached === 'object') {
                const c = cached;
                if (Array.isArray(c.masterSources))
                    c.masterSources = [];
            }
            return cached;
        }
        const articles = (0, store_1.getArticles)(50)
            .filter(a => /运程|流年|方位|风水|犯太/.test(String((0, zhTradition_1.tw)(a.title))) || (a.keywords || []).some(k => /运程|流年|方位|风水|犯太/.test(String((0, zhTradition_1.tw)(k)))))
            .slice(0, 8);
        const advice = await (0, aiService_1.generateAnnualAdvice)({ year, zodiac, bazi, articles });
        if (region === 'tw')
            advice.masterSources = [];
        // 仅缓存 AI 模式结果；本地兜底结果不缓存（下一次 AI 恢复后自动换回 AI）
        if (advice.mode === 'ai')
            (0, store_1.cacheSet)(key, advice, 30 * 24 * 60 * 60 * 1000);
        return advice;
    });
    // 大师文章库
    app.get('/api/master/articles', async (req, reply) => {
        const limitRaw = Number(req.query.limit || 30);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 30;
        const kw = req.query.keyword;
        const list = kw ? (0, store_1.searchArticles)(kw, limit) : (0, store_1.getArticles)(limit);
        return { count: list.length, articles: list.map(a => ({
                id: a.id, url: a.url, title: a.title, source: a.source,
                summary: a.summary, publishedAt: a.publishedAt, keywords: a.keywords,
            })) };
    });
    // 手动触发抓取（耗资源，严格限流）
    app.post('/api/scrape', {
        config: { rateLimit: { max: 1, timeWindow: '5 minute' } },
    }, async () => {
        const result = await (0, scraperService_1.runScrapeOnce)();
        return result;
    });
    // 古籍书目列表
    app.get('/api/ancient/books', async () => {
        const list = ancientService_1.ancientLib.lists;
        return {
            count: list.length,
            disclaimer: '以下古籍均出自公开典籍，内容为传统文化整理，仅供参考。',
            books: list.map((b) => ({ id: b.id, title: b.title, intro: b.intro, chars: b.chars })),
        };
    });
    // 古籍正文（按 id 读取）
    app.get('/api/ancient/read', async (req, reply) => {
        const id = (req.query.id || '').trim();
        if (!id)
            return reply.code(400).send({ error: '请指定 id 参数（古籍书目之一）' });
        const text = ancientService_1.ancientLib.read(id);
        if (!text)
            return reply.code(404).send({ error: `未找到古籍：${id}` });
        return { id, title: null, content: text };
    });
    // 古籍检索（跨书查句）
    app.get('/api/ancient/search', async (req, reply) => {
        const qRaw = (req.query.q || '').trim();
        const limitRaw = Number(req.query.limit || 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.trunc(limitRaw))) : 10;
        if (!qRaw)
            return reply.code(400).send({ error: '请指定 q 参数（要检索的关键词）' });
        const hits = ancientService_1.ancientLib.search(String((0, zhTradition_1.tw)(qRaw)), limit);
        return { query: qRaw, count: hits.length, hits };
    });
    // 万年历：某月逐日黄历（本地计算，无 AI）
    app.get('/api/calendar', async (req, reply) => {
        const y = Number(req.query.year || (0, baziService_1.hkYear)());
        const m = Number(req.query.month || ((0, baziService_1.hkNow)().getMonth() + 1));
        if (!Number.isInteger(y) || y < 1900 || y > 2100)
            return reply.code(400).send({ error: 'year 需在 1900-2100 之间' });
        if (!Number.isInteger(m) || m < 1 || m > 12)
            return reply.code(400).send({ error: 'month 需在 1-12 之间' });
        return (0, baziService_1.getCalendarMonth)(y, m);
    });
    // 要事类型列表
    app.get('/api/event/types', async () => ({
        types: eventService_1.EVENT_TYPES.map(t => ({ type: t.type, icon: t.icon, gift: t.gift })),
    }));
    // 要事择吉：结合当日黄历 + 用户八字喜忌给出吉凶与化解
    app.post('/api/event/advice', {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const b = req.body?.birth;
        const eventType = String(req.body?.eventType || '');
        const date = String(req.body?.date || '');
        const region = (0, customRegions_1.isRegion)(req.body?.region) ? req.body.region : 'hk';
        if (!b || !validBirth(b))
            return reply.code(400).send({ error: '参数不完整：需要 birth 信息' });
        // 前端拿到的是繁体（如「動土」），服务端字典是简体（如「动土」），双向都匹配
        const et = eventService_1.EVENT_TYPES.find(e => e.type === eventType || (0, zhTradition_1.tw)(e.type) === (0, zhTradition_1.tw)(eventType));
        if (!et) {
            return reply.code(400).send({ error: `eventType 需为：${eventService_1.EVENT_TYPES.map(e => e.type).join('/')} 之一` });
        }
        if (!validDateStr(date))
            return reply.code(400).send({ error: 'date 应为 YYYY-MM-DD 内的有效日期' });
        const birth = sanitizeBirth(b);
        if (!birth)
            return reply.code(400).send({ error: '出生日期或时间不合法' });
        try {
            return (0, eventService_1.generateEventAdvice)({ birth, eventType: et.type, date, region });
        }
        catch (e) {
            reply.log.error({ err: e }, '事项择吉计算异常');
            return reply.code(400).send({ error: '该日期无法解析，请更换日期' });
        }
    });
    // 每日开运关键词（本地规则 + AI 解读增强）：五行/天干/地支/方位/时辰/色彩 意象 + 彩讯数字意象
    app.post('/api/lucky/daily', {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const b = req.body?.birth;
        if (!validBirth(b))
            return reply.code(400).send({ error: '参数不完整：需要 birth{year,month,day,hour,gender,isLunar}' });
        const birth = sanitizeBirth(b);
        if (!birth)
            return reply.code(400).send({ error: '出生日期或时间不合法' });
        const date = req.body.date ?? (0, baziService_1.hkToday)();
        if (!validDateStr(date))
            return reply.code(400).send({ error: 'date 应为 YYYY-MM-DD 内的有效日期' });
        const region = (0, customRegions_1.isRegion)(req.body?.region) ? req.body.region : 'hk';
        const key = `lucky:${date}:${region}:${birthKey(birth)}`;
        const cached = (0, store_1.cacheGet)(key, 24 * 60 * 60 * 1000); // 每日关键词缓存 1 天
        if (cached)
            return cached;
        let result;
        try {
            result = (0, luckyService_1.generateDailyLucky)({ birth, date, region });
        }
        catch (e) {
            reply.log.error({ err: e }, '开运关键词生成异常');
            return reply.code(400).send({ error: '该出生日期无法解析，请检查输入' });
        }
        // AI 解读增强：AI 可用时用 AI 重写牌面释义与彩讯暗示；失败则保留本地结果
        if ((0, aiService_1.hasApiKey)()) {
            try {
                const [range, bazi, almanac] = await Promise.all([
                    (0, store_1.getArticles)(20),
                    Promise.resolve((0, baziService_1.computeBaZi)(birth)),
                    Promise.resolve((0, baziService_1.getAlmanac)(date)),
                ]);
                const articles = (0, store_1.searchArticles)('运程').concat((0, store_1.searchArticles)('风水')).concat(range)
                    .filter((a, i, arr) => arr.findIndex(x => x.url === a.url) === i).slice(0, 5);
                result = await (0, aiService_1.enhanceDailyLucky)({ result, bazi, almanac, articles, region });
            }
            catch (e) {
                reply.log.error({ err: e }, '开运六牌 AI 解读失败，使用本地结果');
            }
        }
        // 仅缓存 AI 增强结果；纯本地结果不缓存（AI 恢复后自动换回）
        if (result.mode === 'ai')
            (0, store_1.cacheSet)(key, result, 24 * 60 * 60 * 1000);
        return result;
    });
    // 地区礼俗速查（送礼忌讳/佳礼；按谐音语系返回，前端「速查卡」用）
    app.get('/api/region/gifts', async (req, reply) => {
        const region = (0, customRegions_1.isRegion)(req.query.region) ? req.query.region : 'hk';
        const g = customRegions_1.REGION_GIFTS[region];
        return { region, label: customRegions_1.REGION_LABELS[region], langNote: g.langNote, taboos: g.taboos, tips: g.tips };
    });
    // 订阅校验：客户端购买后上报 purchaseToken，服务端调 Google Play API 验证并落库
    app.post('/api/purchase/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
        const { platform, productId, purchaseToken, deviceId } = req.body || {};
        if (platform !== 'google')
            return reply.code(400).send({ error: '当前仅支持 google 平台' });
        if (!productId || !purchaseService_1.ALLOWED_PRODUCT_IDS.includes(productId)) {
            return reply.code(400).send({ error: `productId 需为：${purchaseService_1.ALLOWED_PRODUCT_IDS.join('/')} 之一` });
        }
        if (!purchaseToken || typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 4096) {
            return reply.code(400).send({ error: 'purchaseToken 不合法' });
        }
        if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
            return reply.code(400).send({ error: 'deviceId 不合法' });
        }
        try {
            const result = await (0, purchaseService_1.verifyGoogleSubscription)(productId, purchaseToken);
            (0, store_1.upsertSubscription)({
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
        }
        catch (e) {
            const err = e;
            if (err.statusCode === 400)
                return reply.code(400).send({ error: err.message });
            reply.log.error({ err: e }, '订阅校验异常');
            return reply.code(502).send({ error: '订阅校验暂时不可用，请稍后重试' });
        }
    });
    // 查询订阅状态（App 启动时同步；过期且可校验时自动向 Google 刷新一次）
    app.get('/api/user/subscription', async (req, reply) => {
        const deviceId = String(req.query.deviceId || '');
        if (!deviceId || deviceId.length < 8 || deviceId.length > 64) {
            return reply.code(400).send({ error: 'deviceId 不合法' });
        }
        const row = (0, store_1.getSubscription)(deviceId);
        if (!row)
            return { status: 'none' };
        const expired = row.expiryMs > 0 && row.expiryMs < Date.now();
        if (expired && (0, purchaseService_1.hasServiceAccount)() && row.purchaseToken) {
            // 已到期：向 Google 刷新（可能已续费）
            try {
                const fresh = await (0, purchaseService_1.verifyGoogleSubscription)(row.productId, row.purchaseToken);
                (0, store_1.upsertSubscription)({
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
            }
            catch {
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
//# sourceMappingURL=index.js.map