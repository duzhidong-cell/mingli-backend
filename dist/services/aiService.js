import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config';
import { ancientLib } from './ancientService';
import { FALLBACK_DIRECTIONS, FALLBACK_YEAR, FALLBACK_ZODIAC, ELEMENT_PLACES } from '../data/fallbackData';
const gemini = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;
/** 统一 AI 入口：.env 里 AI_PROVIDER 决定走 DeepSeek 还是 Gemini */
async function callAi(system, user, schema, context) {
    if (config.aiProvider === 'gemini' && config.geminiApiKey) {
        return callGemini(system, user, schema);
    }
    if (config.aiProvider === 'deepseek' && config.deepseekApiKey) {
        return callDeepSeek(system, user, schema, context);
    }
    return { data: null, sources: [] };
}
/** 调用 Gemini + Google Search grounding，返回结构化 JSON */
async function callGemini(system, user, schema) {
    if (!gemini)
        return { data: null, sources: [] };
    try {
        const promise = gemini.models.generateContent({
            model: config.geminiModel,
            contents: [
                { role: 'user', parts: [{ text: system }] },
                { role: 'model', parts: [{ text: '好的，我会严格遵守上述输出要求。' }] },
                { role: 'user', parts: [{ text: user }] },
            ],
            config: {
                tools: [{ googleSearch: {} }],
                responseMimeType: 'application/json',
                responseSchema: schema,
                temperature: 0.3,
            },
        });
        const res = await Promise.race([
            promise,
            new Promise((_, rej) => setTimeout(() => rej(new Error('Gemini 请求超时(60s)')), 60_000)),
        ]);
        const text = res.text || '';
        let data = null;
        try {
            data = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, ''));
        }
        catch {
            data = text ? { raw: text } : null;
        }
        const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sources = chunks
            .map(c => c?.web && c.web.uri ? (c.web.uri || '') : '')
            .filter(Boolean)
            .filter((v, i, a) => a.indexOf(v) === i)
            .slice(0, 6);
        return { data, sources };
    }
    catch (e) {
        console.error('[Gemini] 调用失败，回退本地规则:', e.message);
        return { data: null, sources: [] };
    }
}
/** 调用 DeepSeek（OpenAI 兼容 API），来源取自文章库（无联网搜索） */
async function callDeepSeek(system, user, schema, context) {
    try {
        const schemaText = JSON.stringify(schemaToText(schema));
        const res = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.deepseekApiKey}`,
            },
            body: JSON.stringify({
                model: config.deepseekModel,
                messages: [
                    { role: 'system', content: `${system}\n只输出符合以下 JSON 结构的纯 JSON，不要多余文字：\n${schemaText}` },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3,
            }),
            signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const text = body.choices?.[0]?.message?.content || '';
        let data = null;
        try {
            data = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, ''));
        }
        catch {
            data = text ? { raw: text } : null;
        }
        const sources = context.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);
        return { data, sources };
    }
    catch (e) {
        console.error('[DeepSeek] 调用失败，回退本地规则:', e.message);
        return { data: null, sources: [] };
    }
}
/** 把 Gemini Type 枚举 schema 转成普通 JSON schema（喂给 DeepSeek 描述输出结构） */
const TYPE_NAMES = {
    [Type.STRING]: 'string',
    [Type.NUMBER]: 'number',
    [Type.INTEGER]: 'integer',
    [Type.BOOLEAN]: 'boolean',
    [Type.ARRAY]: 'array',
    [Type.OBJECT]: 'object',
};
function schemaToText(schema) {
    if (schema == null)
        return schema;
    const t = schema;
    const out = {};
    if (typeof t.type === 'string') {
        out.type = TYPE_NAMES[t.type] || 'object';
    }
    if (t.properties) {
        out.properties = Object.fromEntries(Object.entries(t.properties).map(([k, v]) => [k, schemaToText(v)]));
    }
    if (t.items)
        out.items = schemaToText(t.items);
    if (t.required)
        out.required = t.required;
    return out;
}
/** 常见香港大师名单（用于从文章标题识别作者） */
const MASTER_NAMES = [
    '麦玲玲', '苏民峰', '李居明', '杨天命', '蔡伯励', '董慕节', '陈朗',
    '张凤雏', '龙震天', '李丞责', '白龙王', '周汉明', '云文子', '傅沛基', '鲁洪生',
];
/** 从文章标题提取大师名（如「李居明-风水第一大忌…」→ 李居明） */
function masterFromTitle(title) {
    const t = title || '';
    for (const n of MASTER_NAMES)
        if (t.includes(n))
            return n;
    const m = t.match(/^([\u4e00-\u9fa5]{2,4})[-—·]/);
    return m ? m[1] : '';
}
/** 返回这批文章涉及的大师名（去重，最多5位） */
export function masterNamesFromArticles(articles) {
    const seen = new Set();
    const out = [];
    for (const a of articles) {
        const n = masterFromTitle(a.title);
        if (n && !seen.has(n)) {
            seen.add(n);
            out.push(n);
        }
    }
    return out.slice(0, 5);
}
function dayMasterSummary(b) {
    return `日主为【${b.dayMaster}】，身${b.strength}，喜用神五行 ${b.favorable.join('、')}，忌 ${b.unfavorable.join('、')}`;
}
/** 返回命理古籍书目中的代表性书名（供 App 标注出处） */
function ancientTitles() {
    return ancientLib.lists.slice(0, 4).map((b) => b.title);
}
/** 从古籍库检索与关键词相关的段落，作为 AI 的经典依据 */
function ancientContext(keywords, maxHits = 4) {
    const parts = [];
    for (const kw of keywords) {
        const hits = ancientLib.search(kw, 2);
        for (const h of hits) {
            parts.push(`《${h.title}》：${h.text}`);
        }
        if (parts.length >= maxHits)
            break;
    }
    return parts.slice(0, maxHits).join('\n');
}
/* ============ 每日宜忌 AI 建议 ============ */
export async function generateDailyAdvice(args) {
    const { date, almanac, bazi, articles } = args;
    const systemPrompt = `你是香港著名玄学家的AI助理，擅长八字与黄历择日。根据用户的出生八字命盘、当日黄历(通胜)、近期风水文章与命理古籍，给出「今日适合做/不宜做」的个性化建议。
规则：
1. 综合【黄历宜忌(通用)】+【用户八字五行喜忌(个性化)】+【大师文章观点(参考)】+【命理古籍依据(经典)】四者，突出针对此人的个性化。
2. 只输出JSON，不要多余文字。不要编造未经提供的观点；没有依据的不写。
3. 全部使用繁體中文输出。`;
    const gdKeywords = [...bazi.favorable, ...bazi.unfavorable, bazi.dayMaster, '宜忌', '黄历'];
    const userPrompt = `【用户命盘】${dayMasterSummary(bazi)}；八字四柱：${bazi.shortDesc}；五行统计：${JSON.stringify(bazi.wuXing)}
【今日黄历 ${date}】农历${almanac.lunarDate}；宜：${almanac.yi.join('、') || '无'}；忌：${almanac.ji.join('、') || '无'}；财神方位：${almanac.position.cai}；喜神方位：${almanac.position.xi}；彭祖百忌：${almanac.pengZuGan} ${almanac.pengZuZhi}
【近期风水文章参考】
${articles.map(a => `-(${a.source})${a.title}：${a.summary.slice(0, 120)}`).join('\n') || '(暂无)'}
【命理古籍经典依据】
${ancientContext(gdKeywords) || '(暂无匹配)'}

请输出JSON：{ "score":0-100今日综合指数, "suitable":["适合做的事3-6条，含时辰/方位提示"], "avoid":["不宜做的事3-6条"], "tip":"一句今日开运锦囊(50字内)", "extra":["额外提醒2-3条，可含情感/财务/健康"] }`;
    const schema = {
        type: Type.OBJECT,
        properties: {
            score: { type: Type.NUMBER },
            suitable: { type: Type.ARRAY, items: { type: Type.STRING } },
            avoid: { type: Type.ARRAY, items: { type: Type.STRING } },
            tip: { type: Type.STRING },
            extra: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['score', 'suitable', 'avoid', 'tip', 'extra'],
    };
    const context = articles.map(a => a.url).filter(Boolean);
    const result = await callAi(systemPrompt, userPrompt, schema, context);
    const masters = masterNamesFromArticles(articles);
    if (result.data) {
        const d = result.data;
        return {
            date,
            birthSummary: dayMasterSummary(bazi),
            score: clampScore(Number(d.score)),
            suitable: strArr(d.suitable),
            avoid: strArr(d.avoid),
            tip: String(d.tip || ''),
            extra: strArr(d.extra),
            sources: masters,
            ancientSources: ancientTitles(),
            disclaimer: '以上内容为传统文化娱乐信息，仅供参考，命理依据取自公开古籍。',
        };
    }
    return localDailyAdvice({ date, almanac, bazi, articles });
}
/** 无 API Key 或失败时的本地规则建议 */
function localDailyAdvice(args) {
    const { almanac, bazi, articles } = args;
    const favorable = bazi.favorable.join('');
    const cai = almanac.position.cai;
    const xi = almanac.position.xi;
    const suitable = [];
    for (const action of almanac.yi.slice(0, 4)) {
        suitable.push(`宜${action}`);
    }
    if (favorable)
        suitable.push(`今日气场利${favorable}，重要决策宜向${cai}（财神）方位推进`);
    if (almanac.position.xi)
        suitable.push(`求人办事、约谈见客，宜面向${xi}（喜神）方位`);
    suitable.push('保持作息规律，顺应天时');
    const avoid = almanac.ji.slice(0, 4).map(j => `忌${j}`);
    avoid.push(`忌做与自身忌神（${bazi.unfavorable.join('、')}）相冲的冒进行为`);
    const score = Math.max(45, Math.min(90, 70 - avoid.length * 3 + Math.min(bazi.favorable.length, 3) * 5));
    return {
        date: args.date,
        birthSummary: dayMasterSummary(bazi),
        score,
        suitable,
        avoid,
        tip: `今日财神在${cai}，喜神在${xi}，${bazi.strength === '强' ? '利守成、克己复礼' : '利进取、借助贵人'}。`,
        extra: [
            `八字喜用神为${bazi.favorable.join('、')}，日常穿戴可点缀对应颜色。`,
            almanac.pengZuGan ? `彭祖百忌：${almanac.pengZuGan}。` : '',
        ].filter(Boolean),
        sources: masterNamesFromArticles(articles),
        ancientSources: ancientTitles(),
        disclaimer: '以上内容为传统文化娱乐信息，仅供参考。',
    };
}
/* ============ 流年/方位 AI 建议 ============ */
export async function generateAnnualAdvice(args) {
    const { year, zodiac, bazi, articles } = args;
    const zodiacInfo = FALLBACK_ZODIAC[zodiac] || genericZodiac(zodiac);
    const systemPrompt = `你是香港著名风水大师的AI助理，专注流年方位与出行择吉。
你拥有【2026丙午马年九宫飞星方位】资料与【本命生肖流年运程】资料，请结合用户八字五行喜忌与命理古籍依据，判断今年适合去/不适合去的地方与方位，输出JSON。全部使用繁體中文输出。`;
    const anKeywords = [...bazi.favorable, ...bazi.unfavorable, '流年', '大运', '十二长生', '神煞', '方位'];
    const userPrompt = `【用户】生肖属${zodiac}；${dayMasterSummary(bazi)}；八字：${bazi.shortDesc}
【2026马年流年方位】${JSON.stringify(FALLBACK_DIRECTIONS.map(d => `${d.direction}(${d.star}${d.meaning})${d.good ? '吉' : '凶'}`))}
【该生肖今年运程】${zodiacInfo.overview}
【近期大师文章参考】
${articles.filter(a => /运程|流年|方位|风水|犯太/.test(a.title)).map(a => `-(${a.source})${a.title}`).join('\n') || '(暂无)'}
【命理古籍经典依据】
${ancientContext(anKeywords) || '(暂无匹配)'}

请输出JSON：{ "goodPlaces":["今年适合去/可多去的地方或方位，含原因"], "badPlaces":["今年不宜去/需避开的地方或方位，含原因"], "travelAdvice":"出行择吉建议(100字内，结合五行喜忌与方位)" }`;
    const schema = {
        type: Type.OBJECT,
        properties: {
            goodPlaces: { type: Type.ARRAY, items: { type: Type.STRING } },
            badPlaces: { type: Type.ARRAY, items: { type: Type.STRING } },
            travelAdvice: { type: Type.STRING },
        },
        required: ['goodPlaces', 'badPlaces', 'travelAdvice'],
    };
    const context = articles.map(a => a.url).filter(Boolean);
    const result = await callAi(systemPrompt, userPrompt, schema, context);
    const masters = masterNamesFromArticles(articles);
    if (result.data) {
        const d = result.data;
        return {
            year,
            zodiac,
            overview: zodiacInfo,
            directions: FALLBACK_DIRECTIONS,
            goodPlaces: strArr(d.goodPlaces).length ? strArr(d.goodPlaces) : localGoodPlaces(bazi),
            badPlaces: strArr(d.badPlaces).length ? strArr(d.badPlaces) : localBadPlaces(),
            travelAdvice: String(d.travelAdvice || ''),
            masterSources: masters,
            ancientSources: ancientTitles(),
        };
    }
    return localAnnualAdvice({ year, zodiac, bazi, zodiacInfo, masters });
}
function localAnnualAdvice(args) {
    const { year, zodiac, bazi, zodiacInfo, masters } = args;
    return {
        year,
        zodiac,
        overview: zodiacInfo,
        directions: FALLBACK_DIRECTIONS,
        goodPlaces: localGoodPlaces(bazi),
        badPlaces: localBadPlaces(),
        travelAdvice: `属${zodiac}今年${zodiacInfo.overview}。八字喜用神为「${bazi.favorable.join('、')}」，出行宜向对应福地；凶方（正南五黄、西北二黑、西南七赤）少停留。${ELEMENT_PLACES[bazi.favorable[0]] || '宜以稳妥方式出行。'}`,
        masterSources: masters,
        ancientSources: ancientTitles(),
    };
}
function localGoodPlaces(bazi) {
    const first = bazi.favorable[0];
    const dir = { 木: '正东', 火: '正南', 土: '中部', 金: '正西', 水: '正北' }[first] || '中宫';
    const list = [];
    for (const d of FALLBACK_DIRECTIONS) {
        if (d.good)
            list.push(`${d.direction}（${d.star}${d.meaning}）：${d.advice}`);
    }
    if (first)
        list.push(`五行喜「${first}」：${ELEMENT_PLACES[first]}`);
    list.push(`流年吉方以${dir}为个人用方位`);
    return list.slice(0, 6);
}
function localBadPlaces() {
    return FALLBACK_DIRECTIONS.filter(d => !d.good).map(d => `${d.direction}（${d.star}${d.meaning}）：${d.advice}`);
}
function genericZodiac(zodiac) {
    return {
        zodiac,
        overview: `属${zodiac}今年运势平稳，宜稳中求进。`,
        career: '工作上多与人和善，忌强出头。',
        wealth: '财运中等，理性消费为宜。',
        love: '感情上宜多沟通陪伴。',
        health: '注意作息，适度运动。',
        tip: `属${zodiac}今年可参考流年方位，趋吉避凶。`,
        source: '',
    };
}
function strArr(v) {
    if (!Array.isArray(v))
        return [];
    return v.map(String).filter(Boolean);
}
function clampScore(n) {
    if (!Number.isFinite(n))
        return 70;
    return Math.max(0, Math.min(100, Math.round(n)));
}
export function hasApiKey() {
    if (config.aiProvider === 'gemini')
        return !!config.geminiApiKey;
    return config.aiProvider === 'deepseek' && !!config.deepseekApiKey;
}
export { FALLBACK_YEAR };
//# sourceMappingURL=aiService.js.map