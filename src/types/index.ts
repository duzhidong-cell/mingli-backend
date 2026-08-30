/** 用户地区：影响谐音语系与礼俗（hk=粤语广府，tw=国语/闽南） */
export type Region = 'hk' | 'tw';

/** 每日开运关键词卡（六合彩不适用：只出意象关键词，无任何具体号码） */
export interface LuckyCard {
  /** 五行 / 天干 / 地支 / 方位 / 时辰 / 色彩 */
  type: string;
  /** 卡名称，如 五行牌 */
  title: string;
  /** 大字牌面（如「木」「甲」「子」「南」「午时」「青」） */
  glyph: string;
  /** 关键词（开运意象词） */
  keyword: string;
  /** 释义（2-3 句） */
  interpretation: string;
  /** 开运提示（行动建议） */
  hint: string;
}

export interface DailyLuckyResult {
  date: string;
  region: Region;
  birthSummary: string;
  cards: LuckyCard[];
  /** 今日开运锦囊（一句话） */
  tip: string;
  /** 命理古籍出处（书名列表） */
  ancientSources: string[];
  disclaimer: string;
}

export interface BirthInput {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** true = 农历生日，false = 公历生日 */
  isLunar: boolean;
  /** 仅农历生日常用：true = 该月为闰月（如闰二月），lunar-typescript 用负月份表达 */
  isLeap?: boolean;
  /** 出生地经度（度，东经为正）。用于真太阳时校正时辰；缺省用香港 114.17°E */
  longitude?: number;
  /** 1 = 男, 0 = 女 */
  gender: 0 | 1;
}

export interface Pillar {
  ganzhi: string;
  gan: string;
  zhi: string;
  wuXing: string;
  naYin: string;
  hidGan: string[];
  shiShenGan: string;
  shiShenZhi: string[];
}

export interface BaZiResult {
  /** 四柱 */
  year: Pillar;
  month: Pillar;
  day: Pillar;
  time: Pillar;
  /** 日主(日干五行) */
  dayMaster: string;
  /** 五行统计 */
  wuXing: Record<string, number>;
  /** 身强 / 身弱 */
  strength: '强' | '弱' | '中和';
  /** 用神五行(简化规则) */
  usefulGods: string[];
  /** 喜(supportive)五行 与 忌(unsupportive)五行 */
  favorable: string[];
  unfavorable: string[];
  /** 属相 */
  shengXiao: string;
  /** 胎元/命宫等 */
  taiYuan: string;
  mingGong: string;
  ganZhiYear: string;
  shortDesc: string;
}

export interface AlmanacResult {
  date: string;
  lunarDate: string;
  ganzhiDay: string;
  ganzhiMonth: string;
  ganzhiYear: string;
  shengXiao: string;
  yi: string[];
  ji: string[];
  jiShen: string[];
  xiongSha: string[];
  pengZuGan: string;
  pengZuZhi: string;
  chong: string;
  sha: string;
  naYin: string;
  position: {
    cai: string;
    xi: string;
    fu: string;
    yangGui: string;
    yinGui: string;
  };
  week: string;
  zhiXing: string;
  jiXiong: string;
}

export interface Article {
  id: number;
  url: string;
  title: string;
  content: string;
  summary: string;
  source: string;
  publishedAt: string;
  scrapedAt: string;
  keywords: string[];
}

export interface AnnualZodiacInfo {
  zodiac: string;
  /** 总体 / 事业 / 财运 / 感情 / 健康 */
  overview: string;
  career: string;
  wealth: string;
  love: string;
  health: string;
  tip: string;
  source: string;
}

export interface AnnualDirection {
  direction: string;
  palace: string;
  star: string;
  meaning: string;
  good: boolean;
  advice: string;
}

export interface AnnualAdvice {
  year: number;
  zodiac: string;
  overview: AnnualZodiacInfo | null;
  directions: AnnualDirection[];
  /** 适合去的地方 */
  goodPlaces: string[];
  /** 不宜去/需避开的地方 */
  badPlaces: string[];
  travelAdvice: string;
  masterSources: string[];
  /** 命理古籍出处（书名列表） */
  ancientSources: string[];
  /** ai = AI 提供；local = 本地规则（AI 不可用） */
  mode: 'ai' | 'local';
}

export interface DailyAdvice {
  date: string;
  birthSummary: string;
  score: number;
  suitable: string[];
  avoid: string[];
  tip: string;
  extra: string[];
  sources: string[];
  /** 命理古籍出处（书名列表） */
  ancientSources: string[];
  disclaimer: string;
  /** ai = AI 提供；local = 自定义本地规则（AI 不可用） */
  mode: 'ai' | 'local';
  /** 实际使用的 AI 提供商（deepseek / gemini / openai），local 模式为空串 */
  aiProvider: string;
}

export interface CalendarDay {
  date: string;
  day: number;
  lunarDay: string;
  lunarMonth: string;
  ganzhiDay: string;
  shengXiao: string;
  yi: string[];
  ji: string[];
  festival: string;
  isToday: boolean;
}

export interface CalendarResult {
  year: number;
  month: number;
  /** 1=周一 … 7=周日（用于网格定位） */
  firstWeekday: number;
  days: CalendarDay[];
}

export interface LuckyHour {
  index: number;
  label: string;
  range: string;
  ganzhi: string;
  score: number;
  good: boolean;
}

export interface EventAdviceResult {
  eventType: string;
  date: string;
  verdict: '宜' | '平' | '慎' | '忌';
  score: number;
  reasons: string[];
  resolve: string[];
  luckyHours: LuckyHour[];
  /** 送礼忌讳（若该事件涉送礼） */
  giftTaboos: string[];
  /** 吉利礼物建议（若涉送礼） */
  giftTips: string[];
}