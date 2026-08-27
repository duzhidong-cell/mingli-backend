import { Solar, Lunar, } from 'lunar-typescript';
const WUXING = {
    甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土',
    庚: '金', 辛: '金', 壬: '水', 癸: '水',
    寅: '木', 卯: '木', 巳: '火', 午: '火', 辰: '土', 戌: '土', 丑: '土', 未: '土',
    申: '金', 酉: '金', 亥: '水', 子: '水',
};
export const ELEMENT_ORDER = ['木', '火', '土', '金', '水'];
export const DIR_DESC = {
    坎: '正北', 艮: '东北', 震: '正东', 巽: '东南',
    离: '正南', 坤: '西南', 兑: '正西', 乾: '西北',
    中: '中宫',
};
export const DIR_POS = {
    正北: '北', 东北: '东北', 正东: '东', 东南: '东南',
    正南: '南', 西南: '西南', 正西: '西', 西北: '西北', 中宫: '中',
};
function elementIndex(el) {
    return ELEMENT_ORDER.indexOf(el);
}
function dayMasterFromGan(gan) {
    return WUXING[gan] || '土';
}
/** 香港标准经度（东经，度）。用于缺省时真太阳时校正 */
const HK_LONGITUDE = 114.17;
/** 均时差（分钟）：一年中日晷时间与钟表时间的偏差（近似公式，±16 分钟内） */
function equationOfTime(dayOfYear) {
    const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
    return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}
function dayOfYear(date) {
    const start = Date.UTC(date.getFullYear(), 0, 0);
    const diff = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start;
    return Math.floor(diff / 86400000);
}
/** 把钟表时间校正为真太阳时（返回新的 Date）。经度缺省用香港 114.17°E */
function toTrueSolarTime(date, longitude) {
    const lon = typeof longitude === 'number' && Number.isFinite(longitude)
        ? longitude
        : HK_LONGITUDE;
    const eot = equationOfTime(dayOfYear(date));
    const offsetMin = (lon - 120) * 4 + eot;
    return new Date(date.getTime() + offsetMin * 60000);
}
/** 把用户输入转成真实公历日期（农历自动转，闰月用负月份表达；再按出生地校正真太阳时） */
function toSolarDate(input) {
    let date;
    if (input.isLunar) {
        const lMonth = input.isLeap ? -input.month : input.month;
        const lunar = Lunar.fromYmd(input.year, lMonth, input.day);
        const solar = lunar.getSolar();
        date = new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay());
    }
    else {
        date = new Date(input.year, input.month - 1, input.day);
    }
    date.setHours(input.hour || 0, input.minute || 0, 0, 0);
    return toTrueSolarTime(date, input.longitude);
}
function buildPillar(ganZhi, gan, zhi, naYin, hiddenGan, shiShenGan, shiShenZhi) {
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
export function analyzeStrengthAndGods(dayMaster, year, month, day, time) {
    const dmIdx = elementIndex(dayMaster);
    const dmEl = ELEMENT_ORDER[dmIdx];
    // 五行计数（天干×1 + 地支人元×0.6，简化）
    const wuXing = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
    const addCount = (el, w) => {
        if (el)
            wuXing[el] = (wuXing[el] || 0) + w;
    };
    for (const p of [year, month, day, time]) {
        addCount(WUXING[p.gan], 1);
        addCount(WUXING[p.zhi], 0.6);
        for (const g of p.hidGan)
            addCount(WUXING[g], 0.2);
    }
    let score = 0;
    // 得令：月支五行与日主关系
    const mbEl = WUXING[month.zhi];
    if (mbEl === dmEl)
        score += 2.0;
    else if (ELEMENT_ORDER[(dmIdx + 4) % 5] === mbEl)
        score += 1.5; // 生我(印)
    else if (ELEMENT_ORDER[(dmIdx + 1) % 5] === mbEl)
        score -= 1.2; // 我生(食伤)
    else if (ELEMENT_ORDER[(dmIdx + 2) % 5] === mbEl)
        score -= 1.0; // 我克(财)
    else if (ELEMENT_ORDER[(dmIdx + 3) % 5] === mbEl)
        score -= 1.4; // 克我(官杀)
    // 得地：日支藏干同我
    if (day.hidGan.some(g => WUXING[g] === dmEl))
        score += 1.0;
    // 得势：其它天干
    for (const g of [year.gan, month.gan, time.gan]) {
        if (WUXING[g] === dmEl)
            score += 0.5;
    }
    for (const p of [year, month, time]) {
        for (const g of p.hidGan) {
            if (WUXING[g] === dmEl)
                score += 0.15;
        }
    }
    const strength = score >= 1.8 ? '强' : score <= -0.6 ? '弱' : '中和';
    // 简单量化：±分映射为可用五行
    const hm = score >= 1.8 ? 1 : score <= -0.6 ? -1 : 0;
    const mother = ELEMENT_ORDER[(dmIdx + 4) % 5]; // 生我 印
    const child = ELEMENT_ORDER[(dmIdx + 1) % 5]; // 我生 食伤
    const wealth = ELEMENT_ORDER[(dmIdx + 2) % 5]; // 我克 财
    const officer = ELEMENT_ORDER[(dmIdx + 3) % 5]; // 克我 官杀
    let favorable;
    let unfavorable;
    if (hm > 0) {
        favorable = [child, wealth, officer];
        unfavorable = [mother, dmEl];
    }
    else if (hm < 0) {
        favorable = [mother, dmEl];
        unfavorable = [child, wealth, officer];
    }
    else {
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
export function computeBaZi(input) {
    const date = toSolarDate(input);
    const solar = Solar.fromYmdHms(date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), 0);
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
export function getAlmanac(dateStr) {
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
export function toDateStr(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 香港时区（UTC+8）的当前日期，避免依赖服务器本地时区导致跨天误判 */
export function hkNow() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t) => parts.find(p => p.type === t)?.value || '0';
    return new Date(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(get('hour')), Number(get('minute')), Number(get('second')));
}
export function hkToday() {
    return toDateStr(hkNow());
}
export function hkYear() {
    return hkNow().getFullYear();
}
//# sourceMappingURL=baziService.js.map