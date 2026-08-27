import {
  Solar,
  Lunar,
} from 'lunar-typescript';
import type {
  BirthInput,
  BaZiResult,
  AlmanacResult,
  Pillar,
  CalendarResult,
  CalendarDay,
} from '../types';

const WUXING: Record<string, string> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土',
  庚: '金', 辛: '金', 壬: '水', 癸: '水',
  寅: '木', 卯: '木', 巳: '火', 午: '火', 辰: '土', 戌: '土', 丑: '土', 未: '土',
  申: '金', 酉: '金', 亥: '水', 子: '水',
};

export const ELEMENT_ORDER = ['木', '火', '土', '金', '水'] as const;
export const DIR_DESC: Record<string, string> = {
  坎: '正北', 艮: '东北', 震: '正东', 巽: '东南',
  离: '正南', 坤: '西南', 兑: '正西', 乾: '西北',
  中: '中宫',
};
export const DIR_POS: Record<string, string> = {
  正北: '北', 东北: '东北', 正东: '东', 东南: '东南',
  正南: '南', 西南: '西南', 正西: '西', 西北: '西北', 中宫: '中',
};

function elementIndex(el: string): number {
  return ELEMENT_ORDER.indexOf(el as (typeof ELEMENT_ORDER)[number]);
}

function dayMasterFromGan(gan: string): string {
  return WUXING[gan] || '土';
}

/** 香港标准经度（东经，度）。用于缺省时真太阳时校正 */
const HK_LONGITUDE = 114.17;

/** 均时差（分钟）：一年中日晷时间与钟表时间的偏差（近似公式，±16 分钟内） */
function equationOfTime(dayOfYear: number): number {
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const diff = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start;
  return Math.floor(diff / 86400000);
}

/** 把钟表时间校正为真太阳时（返回新的 Date）。经度缺省用香港 114.17°E */
function toTrueSolarTime(date: Date, longitude?: number): Date {
  const lon = typeof longitude === 'number' && Number.isFinite(longitude)
    ? longitude
    : HK_LONGITUDE;
  const eot = equationOfTime(dayOfYear(date));
  const offsetMin = (lon - 120) * 4 + eot;
  return new Date(date.getTime() + offsetMin * 60000);
}

/** 把用户输入转成真实公历日期（农历自动转，闰月用负月份表达；再按出生地校正真太阳时） */
function toSolarDate(input: BirthInput): Date {
  let date: Date;
  if (input.isLunar) {
    const lMonth = input.isLeap ? -input.month : input.month;
    const lunar = Lunar.fromYmd(input.year, lMonth, input.day);
    const solar = lunar.getSolar();
    date = new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay());
  } else {
    date = new Date(input.year, input.month - 1, input.day);
  }
  date.setHours(input.hour || 0, input.minute || 0, 0, 0);
  return toTrueSolarTime(date, input.longitude);
}

function buildPillar(
  ganZhi: string,
  gan: string,
  zhi: string,
  naYin: string,
  hiddenGan: string[],
  shiShenGan: string,
  shiShenZhi: string[],
): Pillar {
  return {
    ganzhi: ganZhi,
    gan,
    zhi,
    wuXing: `${WUXING[gan] || '?'}${WUXING[zhi] || '?'}`,
    naYin,
    hidGan: hiddenGan,
    shiShenGan,
    shiShenZhi,
  };
}

/** 简化版五行喜忌：基于日主强弱 */
export function analyzeStrengthAndGods(
  dayMaster: string,
  year: Pillar, month: Pillar, day: Pillar, time: Pillar,
): Pick<BaZiResult, 'strength' | 'usefulGods' | 'favorable' | 'unfavorable' | 'wuXing'> {
  const dmIdx = elementIndex(dayMaster);
  const dmEl = ELEMENT_ORDER[dmIdx];

  // 五行计数（天干×1 + 地支人元×0.6，简化）
  const wuXing: Record<string, number> = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  const addCount = (el: string | undefined, w: number) => {
    if (el) wuXing[el] = (wuXing[el] || 0) + w;
  };
  for (const p of [year, month, day, time]) {
    addCount(WUXING[p.gan], 1);
    addCount(WUXING[p.zhi], 0.6);
    for (const g of p.hidGan) addCount(WUXING[g], 0.2);
  }

  let score = 0;
  // 得令：月支五行与日主关系
  const mbEl = WUXING[month.zhi];
  if (mbEl === dmEl) score += 2.0;
  else if (ELEMENT_ORDER[(dmIdx + 4) % 5] === mbEl) score += 1.5; // 生我(印)
  else if (ELEMENT_ORDER[(dmIdx + 1) % 5] === mbEl) score -= 1.2; // 我生(食伤)
  else if (ELEMENT_ORDER[(dmIdx + 2) % 5] === mbEl) score -= 1.0; // 我克(财)
  else if (ELEMENT_ORDER[(dmIdx + 3) % 5] === mbEl) score -= 1.4; // 克我(官杀)

  // 得地：日支藏干同我
  if (day.hidGan.some(g => WUXING[g] === dmEl)) score += 1.0;

  // 得势：其它天干
  for (const g of [year.gan, month.gan, time.gan]) {
    if (WUXING[g] === dmEl) score += 0.5;
  }
  for (const p of [year, month, time]) {
    for (const g of p.hidGan) {
      if (WUXING[g] === dmEl) score += 0.15;
    }
  }

  const strength: BaZiResult['strength'] = score >= 1.8 ? '强' : score <= -0.6 ? '弱' : '中和';

  // 简单量化：±分映射为可用五行
  const hm = score >= 1.8 ? 1 : score <= -0.6 ? -1 : 0;
  const mother = ELEMENT_ORDER[(dmIdx + 4) % 5]; // 生我 印
  const child = ELEMENT_ORDER[(dmIdx + 1) % 5];  // 我生 食伤
  const wealth = ELEMENT_ORDER[(dmIdx + 2) % 5]; // 我克 财
  const officer = ELEMENT_ORDER[(dmIdx + 3) % 5];// 克我 官杀

  let favorable: string[];
  let unfavorable: string[];
  if (hm > 0) {
    favorable = [child, wealth, officer];
    unfavorable = [mother, dmEl];
  } else if (hm < 0) {
    favorable = [mother, dmEl];
    unfavorable = [child, wealth, officer];
  } else {
    favorable = [mother];
    unfavorable = [officer];
  }

  return {
    wuXing,
    strength,
    usefulGods: favorable,
    favorable,
    unfavorable,
  };
}

/** 八字排盘 */
export function computeBaZi(input: BirthInput): BaZiResult {
  const date = toSolarDate(input);
  const solar = Solar.fromYmdHms(
    date.getFullYear(), date.getMonth() + 1, date.getDate(),
    date.getHours(), date.getMinutes(), 0,
  );
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();
  ec.setSect(1);

  const yearP = buildPillar(ec.getYear(), ec.getYearGan(), ec.getYearZhi(), ec.getYearNaYin(), ec.getYearHideGan(), ec.getYearShiShenGan(), ec.getYearShiShenZhi());
  const monthP = buildPillar(ec.getMonth(), ec.getMonthGan(), ec.getMonthZhi(), ec.getMonthNaYin(), ec.getMonthHideGan(), ec.getMonthShiShenGan(), ec.getMonthShiShenZhi());
  const dayP = buildPillar(ec.getDay(), ec.getDayGan(), ec.getDayZhi(), ec.getDayNaYin(), ec.getDayHideGan(), ec.getDayShiShenGan(), ec.getDayShiShenZhi());
  const timeP = buildPillar(ec.getTime(), ec.getTimeGan(), ec.getTimeZhi(), ec.getTimeNaYin(), ec.getTimeHideGan(), ec.getTimeShiShenGan(), ec.getTimeShiShenZhi());

  const dayMaster = dayMasterFromGan(ec.getDayGan());

  const strengthInfo = analyzeStrengthAndGods(dayMaster, yearP, monthP, dayP, timeP);

  return {
    year: yearP,
    month: monthP,
    day: dayP,
    time: timeP,
    dayMaster,
    ...strengthInfo,
    shengXiao: lunar.getYearShengXiao(),
    taiYuan: ec.getTaiYuan(),
    mingGong: ec.getMingGong(),
    ganZhiYear: `${ec.getYearGan()}${ec.getYearZhi()}`,
    shortDesc: `${ec.getYear()} ${ec.getMonth()} ${ec.getDay()} ${ec.getTime()}`,
  };
}

/** 每日黄历（本地计算，不需AI） */
export function getAlmanac(dateStr: string): AlmanacResult {
  const [y, m, d] = dateStr.split('-').map(Number);
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();
  const zhiXing = lunar.getZhiXing();

  return {
    date: dateStr,
    lunarDate: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    ganzhiDay: lunar.getDayInGanZhi(),
    ganzhiMonth: lunar.getMonthInGanZhiExact(),
    ganzhiYear: lunar.getYearInGanZhiExact(),
    shengXiao: lunar.getYearShengXiao(),
    yi: lunar.getDayYi(),
    ji: lunar.getDayJi(),
    jiShen: lunar.getDayJiShen(),
    xiongSha: lunar.getDayXiongSha(),
    pengZuGan: lunar.getPengZuGan(),
    pengZuZhi: lunar.getPengZuZhi(),
    chong: lunar.getDayChongDesc(),
    sha: lunar.getDaySha(),
    naYin: lunar.getDayNaYin(),
    position: {
      cai: DIR_DESC[lunar.getDayPositionCai()] || lunar.getDayPositionCai(),
      xi: DIR_DESC[lunar.getDayPositionXi()] || lunar.getDayPositionXi(),
      fu: DIR_DESC[lunar.getDayPositionFu()] || lunar.getDayPositionFu(),
      yangGui: DIR_DESC[lunar.getDayPositionYangGui()] || lunar.getDayPositionYangGui(),
      yinGui: DIR_DESC[lunar.getDayPositionYinGui()] || lunar.getDayPositionYinGui(),
    },
    week: solar.getWeekInChinese(),
    zhiXing,
    jiXiong: zhiXing,
  };
}

export function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 香港时区（UTC+8）的当前日期，避免依赖服务器本地时区导致跨天误判 */
export function hkNow(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || '0';
  return new Date(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')), Number(get('minute')), Number(get('second')),
  );
}

export function hkToday(): string {
  return toDateStr(hkNow());
}

export function hkYear(): number {
  return hkNow().getFullYear();
}

/** 某月的完整黄历数据（万年历用）：逐日 农历/干支/宜忌/节日 */
export function getCalendarMonth(year: number, month: number): CalendarResult {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = first.getDay() === 0 ? 7 : first.getDay(); // 1=周一…7=周日
  const today = hkToday();

  const days: CalendarDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const solar = Solar.fromYmd(year, month, d);
    const lunar = solar.getLunar();
    const dateStr = toDateStr(new Date(year, month - 1, d));
    days.push({
      date: dateStr,
      day: d,
      lunarDay: lunar.getDayInChinese(),
      lunarMonth: `${lunar.getMonthInChinese()}月`,
      ganzhiDay: lunar.getDayInGanZhi(),
      shengXiao: lunar.getYearShengXiao(),
      yi: lunar.getDayYi(),
      ji: lunar.getDayJi(),
      festival: lunar.getFestivals().join('、'),
      isToday: dateStr === today,
    });
  }
  return { year, month, firstWeekday, days };
}

/** 某日 12 个时辰的干支与五行（子时=23-01 起 12 个时段） */
export function getHourPillars(dateStr: string): { hourIndex: number; range: string; ganzhi: string; element: string }[] {
  const [y, m, d] = dateStr.split('-').map(Number);
  const HOUR_RANGES = ['23-01', '01-03', '03-05', '05-07', '07-09', '09-11', '11-13', '13-15', '15-17', '17-19', '19-21', '21-23'];
  // 时辰中心的钟表小时（子时中心 0 点，丑时中心 2 点…）
  const centers = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
  return centers.map((h, i) => {
    const solar = Solar.fromYmdHms(y, m, d, h, 30, 0);
    const lunar = solar.getLunar();
    const gz = lunar.getTimeInGanZhi();
    return {
      hourIndex: i,
      range: HOUR_RANGES[i],
      ganzhi: gz,
      element: WUXING[gz.charAt(0)] || '土',
    };
  });
}