import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config';
import { ancientLib } from './ancientService';
import type { BaZiResult, AlmanacResult, AnnualAdvice, AnnualZodiacInfo, Article, DailyAdvice, DailyLuckyResult, LuckyCard, Region } from '../types';
import { FALLBACK_DIRECTIONS, FALLBACK_YEAR, FALLBACK_ZODIAC, ELEMENT_PLACES } from '../data/fallbackData';

const gemini = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

interface AiJsonResult {
  data: Record<string, unknown> | null;
  sources: string[];
  /** 实际使用的提供商：deepseek / gemini / openai；空串 = 全部失败 */
  provider: string;
}

/** 可用提供商按主备顺序排列：AI_PROVIDER 优先，其余已配置 Key 的依次兜底 */
function providerOrder(): string[] {
  const all = ['deepseek', 'gemini', 'openai'];
  const has: Record<string, boolean> = {
    deepseek: !!config.deepseekApiKey,
    gemini: !!config.geminiApiKey,
    openai: !!config.openaiApiKey,
  };
  const primary = config.aiProvider === 'deepseek' || config.aiProvider === 'gemini' || config.aiProvider === 'openai'
    ? config.aiProvider
    : 'deepseek';
  const rest = all.filter(p => p !== primary);
  return [primary, ...rest].filter(p => has[p]);
}

/** 统一 AI 入口（双层机制）：依次尝试主提供商与备选提供商，全部失败返回 data:null */
async function callAi(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  context: string[],
): Promise<AiJsonResult> {
  const order = providerOrder();
  if (!order.length) return { data: null, sources: [], provider: '' };
  let lastErr = '';
  for (const p of order) {
    try {
      const r = p === 'gemini'
        ? await callGemini(system, user, schema)
        : p === 'openai'
          ? await callOpenAI(system, user, schema)
          : await callDeepSeek(system, user, schema, context);
      if (r.data) return { ...r, provider: p };
      lastErr = '无有效返回';
    } catch (e) {
      lastErr = (e as Error).message;
      console.warn(`[AI] ${p} 失败，切换下一家: ${lastErr}`);
    }
  }
  console.error(`[AI] 所有提供商均失败，回退本地规则: ${lastErr}`);
  return { data: null, sources: [], provider: '' };
}

/** 调用 OpenAI（ChatGPT，OpenAI 兼容 API），作为 DeepSeek 失败后的第二层兜底 */
async function callOpenAI(
  system: string,
  user: string,
  schema: Record<string, unknown>,
): Promise<AiJsonResult> {
  const schemaText = JSON.stringify(schemaToText(schema));
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [
        { role: 'system', content: `${system}\n只输出符合以下 JSON 结构的纯 JSON，不要多余文字：\n${schemaText}` },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content || '';
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, ''));
  } catch {
    data = text ? { raw: text } : null;
  }
  return { data, sources: [], provider: 'openai' };
}

/** 调用 Gemini + Google Search grounding，返回结构化 JSON */
async function callGemini(system: string, user: string, schema: Record<string, unknown>): Promise<AiJsonResult> {
  if (!gemini) return { data: null, sources: [], provider: 'gemini' };
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
        responseSchema: schema as never,
        temperature: 0.3,
      },
    });
    const res = await Promise.race([
      promise,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Gemini 请求超时(60s)')), 60_000)),
    ]);
    const text = res.text || '';
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, ''));
    } catch {
      data = text ? { raw: text } : null;
    }
    const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .map(c => c?.web && c.web.uri ? (c.web.uri || '') : '')
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 6);
    return { data, sources, provider: 'gemini' };
  } catch (e) {
    console.error('[Gemini] 调用失败:', (e as Error).message);
    return { data: null, sources: [], provider: 'gemini' };
  }
}

/** 调用 DeepSeek（OpenAI 兼容 API），来源取自文章库（无联网搜索） */
async function callDeepSeek(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  context: string[],
): Promise<AiJsonResult> {
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content || '';
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, ''));
    } catch {
      data = text ? { raw: text } : null;
    }
    const sources = context.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);
    return { data, sources, provider: 'deepseek' };
  } catch (e) {
    console.error('[DeepSeek] 调用失败:', (e as Error).message);
    return { data: null, sources: [], provider: 'deepseek' };
  }
}

/** 把 Gemini Type 枚举 schema 转成普通 JSON schema（喂给 DeepSeek 描述输出结构） */
const TYPE_NAMES: Record<string, string> = {
  [Type.STRING]: 'string',
  [Type.NUMBER]: 'number',
  [Type.INTEGER]: 'integer',
  [Type.BOOLEAN]: 'boolean',
  [Type.ARRAY]: 'array',
  [Type.OBJECT]: 'object',
};

function schemaToText(schema: Record<string, unknown>): unknown {
  if (schema == null) return schema;
  const t = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    items?: Record<string, unknown>;
    required?: string[];
  };
  const out: Record<string, unknown> = {};
  if (typeof t.type === 'string') {
    out.type = TYPE_NAMES[t.type] || 'object';
  }
  if (t.properties) {
    out.properties = Object.fromEntries(
      Object.entries(t.properties).map(([k, v]) => [k, schemaToText(v as Record<string, unknown>)]),
    );
  }
  if (t.items) out.items = schemaToText(t.items as Record<string, unknown>);
  if (t.required) out.required = t.required;
  return out;
}

/** 常见香港大师名单（用于从文章标题识别作者） */
const MASTER_NAMES = [
  '麦玲玲', '麥玲玲', '苏民峰', '蘇民峰', '李居明', '杨天命', '楊天命',
  '蔡伯励', '蔡伯勵', '蔡兴华', '蔡興華', '董慕节', '陳朗', '陈朗',
  '张凤雏', '龍震天', '龙震天', '李丞责', '白龙王', '周汉明', '云文子', '傅沛基',
  '鲁洪生', '宋韶光',
];

/** 从文章标题提取大师名（如「李居明-风水第一大忌…」→ 李居明） */
function masterFromTitle(title: string): string {
  const t = title || '';
  for (const n of MASTER_NAMES) if (t.includes(n)) return n;
  const m = t.match(/^([\u4e00-\u9fa5]{2,4})[-—·]/);
  return m ? m[1] : '';
}

/** 返回这批文章涉及的大师名（去重，最多5位） */
export function masterNamesFromArticles(articles: Article[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of articles) {
    const n = masterFromTitle(a.title);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.slice(0, 5);
}

function dayMasterSummary(b: BaZiResult): string {
  return `日主为【${b.dayMaster}】，身${b.strength}，喜用神五行 ${b.favorable.join('、')}，忌 ${b.unfavorable.join('、')}`;
}

/** 返回命理古籍书目中的代表性书名（供 App 标注出处） */
function ancientTitles(): string[] {
  return ancientLib.lists.slice(0, 4).map((b) => b.title);
}

/** 从古籍库检索与关键词相关的段落，作为 AI 的经典依据 */
function ancientContext(keywords: string[], maxHits = 4): string {
  const parts: string[] = [];
  for (const kw of keywords) {
    const hits = ancientLib.search(kw, 2);
    for (const h of hits) {
      parts.push(`《${h.title}》：${h.text}`);
    }
    if (parts.length >= maxHits) break;
  }
  return parts.slice(0, maxHits).join('\n');
}

/* ============ 每日宜忌 AI 建议 ============ */

export async function generateDailyAdvice(args: {
  date: string;
  almanac: AlmanacResult;
  bazi: BaZiResult;
  articles: Article[];
}): Promise<DailyAdvice> {
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
  } as never;

  const context = articles.map(a => a.url).filter(Boolean);
  const result = await callAi(systemPrompt, userPrompt, schema, context);
  const masters = masterNamesFromArticles(articles);

  if (result.data) {
    const d = result.data as Record<string, unknown>;
    const suitable = strArr(d.suitable);
    const avoid = strArr(d.avoid);
    // AI 返回内容为空数组时视作不可用 → 走本地个性化规则（不再抄黄历充当 AI 结果）
    if (suitable.length < 2 || avoid.length < 2) {
      const local = localDailyAdvice({ date, almanac, bazi, articles });
      return { ...local, date, aiProvider: '' };
    }
    const extra = strArr(d.extra);
    return {
      date,
      birthSummary: dayMasterSummary(bazi),
      score: clampScore(Number(d.score)),
      suitable,
      avoid,
      tip: String(d.tip || '今日宜稳中求进，顺势而为。'),
      extra,
      sources: masters,
      ancientSources: ancientTitles(),
      disclaimer: '以上内容为传统文化娱乐信息，仅供参考，命理依据取自公开古籍。',
      mode: 'ai',
      aiProvider: result.provider,
    };
  }
  return localDailyAdvice({ date, almanac, bazi, articles });
}

/** 本地兜底建议（第二层规则）：基于用户八字喜忌 + 当日方位/吉时/冲煞，避免与原样黄历重复 */
function localDailyAdvice(args: {
  date: string; almanac: AlmanacResult; bazi: BaZiResult; articles: Article[];
}): DailyAdvice {
  const { almanac, bazi, articles } = args;
  const favorable = bazi.favorable.join('、');
  const unfavorable = bazi.unfavorable.join('、');
  const cai = almanac.position.cai;
  const xi = almanac.position.xi;
  const strong = bazi.strength === '强';

  const suitable: string[] = [
    `今日气场利「${favorable}」，重大决策、签约合作宜向${cai}（财神）方位推进。`,
    `喜神在${xi}，求人办事、拜访贵相宜面朝此方，事半功倍。`,
    strong
      ? `命主身强：利主动出击、独当一面，重要事项趁热打铁。`
      : `命主身弱：利借力贵人、稳扎稳打，不宜单打独斗。`,
    `性格开运：日主属「${bazi.dayMaster}」，${'「' + favorable + '」属的色彩/方位是你的能量源'}，今日可多亲近。`,
  ];

  const avoid: string[] = [
    `忌做与忌神「${unfavorable}」相冲的冒进行为，如冲动消费、赌性投机。`,
    `今日冲「${almanac.chong}」，与相关生肖/方位的人事往来保持和气、少起冲突。`,
  ];
  if (almanac.pengZuGan) avoid.push(`彭祖百忌：「${almanac.pengZuGan}」，办相关之事请避开。`);

  const score = Math.max(45, Math.min(90, 72 - avoid.length * 3 + Math.min(bazi.favorable.length, 3) * 5));

  return {
    date: args.date,
    birthSummary: dayMasterSummary(bazi),
    score,
    suitable,
    avoid,
    tip: strong
      ? `今日利财神${cai}、喜神${xi}，${cai}方向的一举一动多为你添运。`
      : `今日宜随喜神${xi}而行、借力而行，${cai}方向多走动能纳财。`,
    extra: [
      `八字喜用神为「${favorable}」，日常穿戴可点缀对应颜色与方位。`,
      `贴身饰品宜避开「${unfavorable}」属相的颜色。`,
    ],
    sources: masterNamesFromArticles(articles),
    ancientSources: ancientTitles(),
    disclaimer: '此为本地规则生成（AI 服务暂不可用），基于您的八字喜忌，仅供娱乐参考。',
    mode: 'local',
    aiProvider: '',
  };
}

/* ============ 流年/方位 AI 建议 ============ */

export async function generateAnnualAdvice(args: {
  year: number;
  zodiac: string;
  bazi: BaZiResult;
  articles: Article[];
}): Promise<AnnualAdvice> {
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
  } as never;

  const context = articles.map(a => a.url).filter(Boolean);
  const result = await callAi(systemPrompt, userPrompt, schema, context);
  const masters = masterNamesFromArticles(articles);

  if (result.data) {
    const d = result.data as Record<string, unknown>;
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
      mode: 'ai',
    };
  }
  return localAnnualAdvice({ year, zodiac, bazi, zodiacInfo, masters });
}

function localAnnualAdvice(args: { year: number; zodiac: string; bazi: BaZiResult; zodiacInfo: AnnualZodiacInfo; masters: string[] }): AnnualAdvice {
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
    mode: 'local',
  };
}

function localGoodPlaces(bazi: BaZiResult): string[] {
  const first = bazi.favorable[0];
  const dir = { 木: '正东', 火: '正南', 土: '中部', 金: '正西', 水: '正北' }[first] || '中宫';
  const list: string[] = [];
  for (const d of FALLBACK_DIRECTIONS) {
    if (d.good) list.push(`${d.direction}（${d.star}${d.meaning}）：${d.advice}`);
  }
  if (first) list.push(`五行喜「${first}」：${ELEMENT_PLACES[first]}`);
  list.push(`流年吉方以${dir}为个人用方位`);
  return list.slice(0, 6);
}

function localBadPlaces(): string[] {
  return FALLBACK_DIRECTIONS.filter(d => !d.good).map(d =>
    `${d.direction}（${d.star}${d.meaning}）：${d.advice}`
  );
}

function genericZodiac(zodiac: string): AnnualZodiacInfo {
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

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String).filter(Boolean);
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 70;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function hasApiKey(): boolean {
  return providerOrder().length > 0;
}

/** 当前配置且带 Key 的提供商（主备顺序） */
export function availableProviders(): string[] {
  return providerOrder();
}

/**
 * 每日开运六牌·AI 解读增强。
 * 用通俗语言解释每张牌（如「旺木」= 今天对你有利的五行是木），并依传统河图洛书五行数理
 * 给出「点到即止」的彩讯数字意象提示（不直接报具体投注号码）：
 *   水1/6 · 火2/7 · 木3/8 · 金4/9 · 土5/10，
 * 天干地支再给天然序数（甲乙丙丁…1~10 / 子丑寅卯…1~12）作隐含参照。
 * AI 不可用时原样返回本地结果，不中断流程。
 */
export async function enhanceDailyLucky(args: {
  result: DailyLuckyResult;
  bazi: BaZiResult;
  almanac: AlmanacResult;
  articles: Article[];
  region: Region;
}): Promise<DailyLuckyResult> {
  const { result, bazi, almanac, articles, region } = args;

  const userLocal = result.cards.map((c, i) =>
    `${i + 1}.【${c.title}】牌面「${c.glyph}」·关键词「${c.keyword}」\n   释义：${c.interpretation}\n   提示：${c.hint}`,
  ).join('\n');

  const systemPrompt = `你是香港著名命理师与六合彩分析师的AI助理，专精「开运关键词」解说。
请用通俗的话替普通人解读每日开运六牌，并给出彩讯数字意象的暗示。
铁律：
1. 每张牌都要先「用人话解释牌面含义」——例如「旺木」就是：今天对你最有利的五行是木，代表生发、向上，做与木相关的事易得福。
2. 给出数字意象提示时，只做「暗示」不要直接报出投注号码或具体下单（如说「木行主旺，开运数可多向三、八之象靠拢」），点到即止。
3. 五行天然数理：水1/6、火2/7、木3/8、金4/9、土5/10；天干天干序数甲1乙2...癸10，地支序数子1丑2...亥12，可作隐含参照。不要编造玄色理论。
4. 全部使用繁體中文输出，只输出JSON，不要多余文字。`;
  const userPrompt = `【用户命盘】${dayMasterSummary(bazi)}；八字：${bazi.shortDesc}；地区：${region === 'tw' ? '台湾' : '香港'}
【今日 ${result.date}】农历${almanac.lunarDate}；日柱：${almanac.ganzhiDay}；财神方位${almanac.position.cai}；喜神方位${almanac.position.xi}
【今日开运六牌（本地规则生成）】
${userLocal}
【近期大师文章参考（可选观点）】
${articles.map(a => `-(${a.source})${a.title}：${a.summary.slice(0, 100)}`).join('\n') || '(暂无)'}

请输出JSON：{
  "luckyKeyword":"一句话的开运关键词标语(10字内)，用作今日最醒目的大标题，例如『木·开运上行』",
  "cards":[
    {"index":1,"plain":"用人话解释这张牌对这位用户意味着什么(40-80字)","numHint":"彩讯数字意象暗示(30字内，点到即止，勿报具体号码)"},
    ... 与上面6张牌一一对应，共6条 ...
  ],
  "tip":"今日开运锦囊(50字内，可含一句彩讯意象暗示)"
}`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      luckyKeyword: { type: Type.STRING },
      cards: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.NUMBER },
            plain: { type: Type.STRING },
            numHint: { type: Type.STRING },
          },
          required: ['index', 'plain', 'numHint'],
        },
      },
      tip: { type: Type.STRING },
    },
    required: ['luckyKeyword', 'cards', 'tip'],
  } as never;

  const context = articles.map(a => a.url).filter(Boolean);
  const ai = await callAi(systemPrompt, userPrompt, schema, context);
  const d = ai.data as Record<string, unknown> | null;
  if (!d) return result; // AI 不可用 → 原样本地结果

  const luckyKeyword = String(d.luckyKeyword || result.tip || '');
  const notes: Record<number, { plain?: string; numHint?: string }> = {};
  if (Array.isArray(d.cards)) {
    for (const item of d.cards) {
      const o = item as Record<string, unknown>;
      const i = Number(o.index);
      notes[i] = { plain: String(o.plain || ''), numHint: String(o.numHint || '') };
    }
  }

  // 合并回卡片：有 AI 内容则覆盖，否则保留本地
  const cards = result.cards.map((c, i) => {
    const n = notes[i + 1] || notes[i] || {};
    const plain = n.plain ? n.plain : c.interpretation;
    const numHint = n.numHint ? n.numHint : c.hint;
    return {
      ...c,
      interpretation: plain,
      hint: numHint,
    } as LuckyCard;
  });

  const aiTip = String(d.tip || '');

  return {
    ...result,
    luckyKeyword: luckyKeyword || result.tip,
    cards,
    tip: aiTip || result.tip,
    aiProvider: ai.provider || 'local',
    mode: ai.provider ? 'ai' : 'local',
  };
}

export { FALLBACK_YEAR };