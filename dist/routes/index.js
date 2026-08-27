import { createHash } from 'node:crypto';
import { LunarYear } from 'lunar-typescript';
import { config } from '../config';
import { computeBaZi, getAlmanac, hkToday, hkYear } from '../services/baziService';
import { generateDailyAdvice, generateAnnualAdvice, hasApiKey, FALLBACK_YEAR } from '../services/aiService';
import { getArticles, searchArticles, cacheGet, cacheSet } from '../services/store';
import { runScrapeOnce } from '../services/scraperService';
import { ancientLib } from '../services/ancientService';
import { FALLBACK_ZODIAC } from '../data/fallbackData';
import { tw } from '../utils/zhTradition';
function birthKey(b) {
    return createHash('sha1').update(`${b.year}|${b.month}|${b.day}|${b.hour}|${b.minute}|${b.gender}|${b.isLunar}|${!!b.isLeap}|${b.longitude ?? 'HK'}`).digest('hex').slice(0, 12);
}
function validBirth(b) {
    if (typeof b !== 'object' || b == null)
        return false;
    const o = b;
    return typeof o.year === 'number' && typeof o.month === 'number' && typeof o.day === 'number'
        && typeof o.gender === 'number';
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
    if (isLeap && LunarYear.fromYear(year).getLeapMonth() !== month)
        return null; // 该年无此闰月
    if (!isLunar) {
        const dim = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day > dim[month - 1])
            return null;
    }
    return { year, month, day, hour, minute, gender, isLunar, isLeap, longitude };
}
function aiModeName() {
    if (!hasApiKey())
        return '本地规则(未配置 API Key)';
    return config.aiProvider === 'gemini' ? 'gemini + google搜索' : 'deepseek + 大师文章库';
}
export async function registerRoutes(app) {
    // 所有响应统一转繁体输出
    app.addHook('onSend', async (_req, reply, payload) => {
        if (typeof payload === 'string' && (payload.startsWith('{') || payload.startsWith('['))) {
            try {
                return JSON.stringify(tw(JSON.parse(payload)));
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
        apiKey: hasApiKey(),
        aiMode: aiModeName(),
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
            return computeBaZi(birth);
        }
        catch {
            return reply.code(400).send({ error: '无法解析该出生日期（可能农历日期不存在）' });
        }
    });
    // 每日黄历（本地，无需AI）
    app.get('/api/daily', async (req, reply) => {
        const d = req.query.date ?? hkToday();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
            return reply.code(400).send({ error: 'date 格式应为 YYYY-MM-DD' });
        const [y, m, day] = d.split('-').map(Number);
        if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && day >= 1 && day <= 31)) {
            return reply.code(400).send({ error: 'date 超出支持范围' });
        }
        try {
            return getAlmanac(d);
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
        const date = req.body.date ?? hkToday();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
            return reply.code(400).send({ error: 'date 格式应为 YYYY-MM-DD' });
        const key = `daily:${date}:${birthKey(birth)}`;
        const cached = cacheGet(key, 24 * 60 * 60 * 1000); // 每日宜忌缓存 1 天，次日自动重算
        if (cached)
            return cached;
        const [range, bazi, almanac] = await Promise.all([
            getArticles(30),
            Promise.resolve(computeBaZi(birth)),
            Promise.resolve(getAlmanac(date)),
        ]);
        const articles = searchArticles('运程').concat(searchArticles('风水')).concat(range)
            .filter((a, i, arr) => arr.findIndex(x => x.url === a.url) === i).slice(0, 8);
        const advice = await generateDailyAdvice({ date, almanac, bazi, articles });
        if (advice.sources.length)
            cacheSet(key, advice, 24 * 60 * 60 * 1000); // 带来源才缓存，避免耗额度重算
        return advice;
    });
    // 某生肖年度运程（内置兜底数据）
    app.get('/api/annual', async (req, reply) => {
        const yearRaw = Number(req.query.year || FALLBACK_YEAR);
        const year = Number.isFinite(yearRaw) ? yearRaw : FALLBACK_YEAR;
        const zodiac = req.query.zodiac || '';
        if (zodiac && FALLBACK_ZODIAC[zodiac])
            return { year, zodiac, info: FALLBACK_ZODIAC[zodiac] };
        if (zodiac && !FALLBACK_ZODIAC[zodiac])
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
        const year = req.body.year ?? hkYear();
        if (!Number.isInteger(year) || year < 1900 || year > 2100) {
            return reply.code(400).send({ error: 'year 超出支持范围' });
        }
        const bazi = computeBaZi(birth);
        const zodiac = bazi.shengXiao;
        const key = `annual:${year}:${zodiac}:${birthKey(birth)}`;
        const cached = cacheGet(key, 30 * 24 * 60 * 60 * 1000); // 流年建议缓存 30 天
        if (cached)
            return cached;
        const articles = getArticles(50).filter(a => /运程|流年|方位|风水|犯太/.test(a.title)).slice(0, 8);
        const advice = await generateAnnualAdvice({ year, zodiac, bazi, articles });
        // 仅在真正调用了 AI（有大师来源）时缓存，避免兜底结果被缓存 30 天
        if (advice.masterSources.length)
            cacheSet(key, advice, 30 * 24 * 60 * 60 * 1000);
        return advice;
    });
    // 大师文章库
    app.get('/api/master/articles', async (req, reply) => {
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
    app.get('/api/ancient/read', async (req, reply) => {
        const id = (req.query.id || '').trim();
        if (!id)
            return reply.code(400).send({ error: '请指定 id 参数（古籍书目之一）' });
        const text = ancientLib.read(id);
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
        const hits = ancientLib.search(String(tw(qRaw)), limit);
        return { query: qRaw, count: hits.length, hits };
    });
}
//# sourceMappingURL=index.js.map