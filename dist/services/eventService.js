"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_TYPES = void 0;
exports.generateEventAdvice = generateEventAdvice;
exports.findNextGoodDate = findNextGoodDate;
const baziService_1 = require("./baziService");
const customRegions_1 = require("../data/customRegions");
/** 生肖 → 地支 */
const ZODIAC_ZHI = {
    鼠: '子', 牛: '丑', 虎: '寅', 兔: '卯', 龙: '辰', 蛇: '巳',
    马: '午', 羊: '未', 猴: '申', 鸡: '酉', 狗: '戌', 猪: '亥',
};
/** 地支相冲 */
const CHONG = {
    子: '午', 丑: '未', 寅: '申', 卯: '酉', 辰: '戌', 巳: '亥',
    午: '子', 未: '丑', 申: '寅', 酉: '卯', 戌: '辰', 亥: '巳',
};
/** 事件类型定义：keywords 为该事件的「宜做」关键词（与黄历宜忌匹配） */
exports.EVENT_TYPES = [
    { type: '庆生', icon: '🎂', keywords: ['祭祀', '祈福', '开光', '会友'], gift: true },
    { type: '婚礼', icon: '💍', keywords: ['嫁娶', '纳采', '订盟', '安床', '冠笄'], gift: true },
    { type: '搬迁', icon: '🏠', keywords: ['入宅', '移徙', '安床', '出行', '拆卸'], gift: true },
    { type: '高升', icon: '🎉', keywords: ['开市', '交易', '立券', '纳财', '求财'], gift: true },
    { type: '开业', icon: '🏮', keywords: ['开市', '交易', '立券', '纳财', '求财'], gift: true },
    { type: '满月', icon: '👶', keywords: ['祈福', '开光', '祭祀'], gift: true },
    { type: '考试', icon: '📚', keywords: ['祈福', '开光', '祭祀'], gift: false },
    { type: '出行', icon: '🚗', keywords: ['出行', '开光', '祈福'], gift: false },
    { type: '签约', icon: '📝', keywords: ['交易', '立券', '纳财', '会友'], gift: false },
    { type: '动土', icon: '🚧', keywords: ['动土', '修造', '拆卸', '安床'], gift: false },
    { type: '安葬', icon: '🕯', keywords: ['安葬', '破土', '入殓', '立碑'], gift: false },
];
/** 给出某日某时辰对用户是否为吉时（本地规则） */
function scoreHour(h, user, penalizeNight) {
    const zhi = h.ganzhi.charAt(1);
    let score = 0;
    if (user.favorable.includes(h.element))
        score += 2;
    else if (h.element === user.dayMaster)
        score += 1;
    else if (user.unfavorable.includes(h.element))
        score -= 1;
    if (CHONG[zhi] === user.shengXiaoZhi || CHONG[user.shengXiaoZhi] === zhi)
        score -= 3;
    const idx = '子丑寅卯辰巳午未申酉戌亥'.indexOf(zhi);
    const hourIndex = idx < 0 ? 0 : idx;
    // 深夜时段（子/丑/寅：23:00-05:00）对多数事项不合适，做办的事减分
    if (penalizeNight && (hourIndex === 0 || hourIndex === 1 || hourIndex === 2))
        score -= 1.5;
    return { index: hourIndex, label: `${'子丑寅卯辰巳午未申酉戌亥'.charAt(idx)}时`, range: h.range, ganzhi: h.ganzhi, score, good: score >= 1 };
}
/** 事项择吉：结合当日黄历 + 用户八字喜忌 + 冲煞，给出吉凶判断与化解建议 */
function generateEventAdvice(input) {
    const region = input.region === 'tw' ? 'tw' : 'hk';
    const et = exports.EVENT_TYPES.find(e => e.type === input.eventType) || exports.EVENT_TYPES[0];
    const almanac = (0, baziService_1.getAlmanac)(input.date);
    const bazi = (0, baziService_1.computeBaZi)(input.birth);
    const userZhi = ZODIAC_ZHI[bazi.shengXiao] || '';
    let score = 60;
    const reasons = [];
    // 1) 当日黄历宜忌是否命中该事项
    const hitYi = almanac.yi.filter(y => et.keywords.some(k => y.includes(k)));
    const hitJi = almanac.ji.filter(j => et.keywords.some(k => j.includes(k)));
    if (hitYi.length) {
        score += hitYi.length * 12;
        reasons.push(`当日黄历宜「${hitYi.join('、')}」，与该事项相合。`);
    }
    if (hitJi.length) {
        score -= hitJi.length * 18;
        reasons.push(`当日黄历忌「${hitJi.join('、')}」，与该事项相冲，宜避让。`);
    }
    if (!hitYi.length && !hitJi.length) {
        reasons.push('当日黄历与该事项无直接相冲，属中平之日。');
    }
    // 2) 个人化：冲生肖
    if (userZhi && almanac.chong.includes(`(${bazi.shengXiao})`)) {
        score -= 20;
        reasons.push(`当日冲「${bazi.shengXiao}」生肖，与您相冲，需谨慎。`);
    }
    // 3) 个人化：当日日干五行与命主喜忌
    const dayGanEl = almanac.ganzhiDay.charAt(0);
    const dayEl = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' }[dayGanEl] || '';
    if (dayEl && bazi.favorable.includes(dayEl)) {
        score += 8;
        reasons.push(`当日日干属「${dayEl}」，正合您的喜用五行，气场相投。`);
    }
    else if (dayEl && bazi.unfavorable.includes(dayEl)) {
        score -= 8;
        reasons.push(`当日日干属「${dayEl}」，与您的忌神五行相类，略有阻滞。`);
    }
    score = Math.max(15, Math.min(98, score));
    const verdict = score >= 80 ? '宜' : score >= 65 ? '平' : score >= 45 ? '慎' : '忌';
    // 4) 吉时建议（12 时辰按喜忌+冲生肖打分）
    const nightOk = et.type === '出行' || et.type === '安葬'; // 夜行/下葬类不限制深夜
    const hours = (0, baziService_1.getHourPillars)(input.date)
        .map(h => scoreHour(h, { shengXiaoZhi: userZhi, favorable: bazi.favorable, unfavorable: bazi.unfavorable, dayMaster: bazi.dayMaster }, !nightOk))
        .sort((a, b) => b.score - a.score);
    const luckyHours = hours.filter(h => h.good).slice(0, 3);
    const worst = [...hours].sort((a, b) => a.score - b.score).slice(0, 1)[0];
    // 5) 化解建议
    const resolve = [];
    const nextGood = findNextGoodDate(et.type, new Date(input.date + 'T00:00:00'), 30);
    if (verdict === '忌' || verdict === '慎') {
        if (nextGood)
            resolve.push(`建议改期：近期更宜「${et.keywords[0]}」的吉日是 ${nextGood}（${(0, baziService_1.getAlmanac)(nextGood).yi.filter(y => et.keywords.some(k => y.includes(k))).slice(0, 2).join('、')}）。`);
        else
            resolve.push('建议改期：再观察一段时日，另择黄历宜日进行。');
        if (luckyHours.length)
            resolve.push(`若日期无法更改，务必安排在吉时（如 ${luckyHours.map(h => h.label).join('、')}）进行。`);
        if (worst && !worst.good)
            resolve.push(`尽量避开 ${worst.label}时（${worst.ganzhi}）——${worst.score <= -2 ? '与您相冲或犯忌神' : '气场不旺'}。`);
    }
    else {
        if (luckyHours.length)
            resolve.push(`选吉时进行：${luckyHours.map(h => `${h.label}(${h.range})`).join('、')}。`);
    }
    if (bazi.favorable.length)
        resolve.push(`当日可穿/佩戴「${bazi.favorable.join('、')}」属相的衣物配饰助运。`);
    if (almanac.position.xi)
        resolve.push(`面向${almanac.position.xi}（喜神）方位进行，更添喜气。`);
    if (almanac.pengZuGan)
        resolve.push(`注意彭祖百忌：「${almanac.pengZuGan}」，办此类事避开即可。`);
    // 6) 送礼忌讳与佳礼（按地区谐音语系取表）
    const gifts = customRegions_1.REGION_GIFTS[region];
    const giftTaboos = et.gift ? gifts.taboos : [];
    const perTips = gifts.tips[et.type] || gifts.fallbackTips;
    const giftTips = [...perTips];
    if (bazi.favorable.length)
        giftTips.push(`礼物颜色宜带「${bazi.favorable.join('、')}」属相（您的喜用色），更显用心。`);
    if (bazi.unfavorable.length)
        giftTips.push(`礼物颜色宜避开「${bazi.unfavorable.join('、')}」属相（您的忌神色）。`);
    return {
        eventType: et.type,
        date: input.date,
        verdict,
        score,
        reasons,
        resolve,
        luckyHours,
        giftTaboos,
        giftTips,
    };
}
/** 找一个 30 天内「宜该事项」的日期（给化解建议用） */
function findNextGoodDate(eventType, from, days = 30) {
    const et = exports.EVENT_TYPES.find(e => e.type === eventType);
    if (!et)
        return null;
    for (let i = 1; i <= days; i++) {
        const d = new Date(from.getTime() + i * 86400000);
        const ds = (0, baziService_1.toDateStr)(d);
        const a = (0, baziService_1.getAlmanac)(ds);
        if (a.yi.some(y => et.keywords.some(k => y.includes(k))))
            return ds;
    }
    return null;
}
//# sourceMappingURL=eventService.js.map