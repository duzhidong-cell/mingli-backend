"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDailyLucky = generateDailyLucky;
const baziService_1 = require("./baziService");
const ancientService_1 = require("./ancientService");
/** 天干 → 五行 */
const GAN_WX = {
    甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土',
    庚: '金', 辛: '金', 壬: '水', 癸: '水',
};
/** 地支 → 生肖（六合提示用） */
const ZHI_ZODIAC = {
    子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
    午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
};
/** 地支六合：子丑合、寅亥合、卯戌合、辰酉合、巳申合、午未合 */
const LIUHE = {
    子: '丑', 丑: '子', 寅: '亥', 亥: '寅',
    卯: '戌', 戌: '卯', 辰: '酉', 酉: '辰',
    巳: '申', 申: '巳', 午: '未', 未: '午',
};
/** 五行 → 意象 */
const ELEMENT_CARDS = {
    木: { keyword: '生发', color: '青绿', direction: '正东', desc: '草木欣欣，得春而发。' },
    火: { keyword: '光耀', color: '红紫', direction: '正南', desc: '光明普照，热情坦荡。' },
    土: { keyword: '厚稳', color: '土黄', direction: '中宫', desc: '厚德载物，稳定有信。' },
    金: { keyword: '收成', color: '白金', direction: '正西', desc: '收敛果断，秋收之象。' },
    水: { keyword: '智流', color: '深蓝', direction: '正北', desc: '智慧流动，变幻圆融。' },
};
/** 天干 → 意象 */
const GAN_CARDS = {
    甲: { keyword: '参天', desc: '甲木为栋梁参天，宜昂首进取、担当大局。' },
    乙: { keyword: '柔韧', desc: '乙木如藤蔓花草，宜以柔克刚、顺势而为。' },
    丙: { keyword: '炽阳', desc: '丙火如夏日太阳，光明磊落，利展现自我。' },
    丁: { keyword: '星辉', desc: '丁火如灯烛星辉，温暖细致，利守护耕耘。' },
    戊: { keyword: '高山', desc: '戊土如巍峨高山，沉稳可靠，利托付重任。' },
    己: { keyword: '沃田', desc: '己土如田园沃土，包容滋养，利培养善缘。' },
    庚: { keyword: '锋锐', desc: '庚金如钢铁锋芒，刚毅果决，利破旧立新。' },
    辛: { keyword: '精纯', desc: '辛金如珠玉精纯，明察秋毫，利精工细作。' },
    壬: { keyword: '奔腾', desc: '壬水如江河奔腾，气势磅礴，利宏图远略。' },
    癸: { keyword: '雨露', desc: '癸水如雨露润物，缜密周全，利润人泽己。' },
};
/** 地支 → 意象 */
const ZHI_CARDS = {
    子: { keyword: '藏机', desc: '子水藏智含机，午夜灵慧，宜静思谋划。' },
    丑: { keyword: '蕴厚', desc: '丑土蓄力蕴厚，宜踏实积累、不急于求成。' },
    寅: { keyword: '启新', desc: '寅木破土启新，朝气勃发，宜开拓新局。' },
    卯: { keyword: '和畅', desc: '卯木柔和和畅，宜沟通协作、广结善缘。' },
    辰: { keyword: '化育', desc: '辰土化育万物，宜包容万象、统筹全局。' },
    巳: { keyword: '升腾', desc: '巳火升腾活跃，宜快马加鞭、抓住时机。' },
    午: { keyword: '正阳', desc: '午火正阳当令，光明正大，宜坦荡行事。' },
    未: { keyword: '含秀', desc: '未土含秀温和，宜守约待人、静待收获。' },
    申: { keyword: '通达', desc: '申金通达机敏，宜灵活应变、多思变通。' },
    酉: { keyword: '凝练', desc: '酉金凝练专注，宜精益求精、尘埃落定。' },
    戌: { keyword: '承重', desc: '戌土承重坚守，宜担当责任、守住底线。' },
    亥: { keyword: '涵泳', desc: '亥水涵泳圆融，宜以柔济事、润心养性。' },
};
function dayMasterSummary(b) {
    return `日主属「${b.dayMaster}」，身${b.strength}，喜用五行 ${b.favorable.join('、')}，忌 ${b.unfavorable.join('、')}`;
}
/** 时辰打分（与事项择吉一致）：喜用五行 + 日主 + 忌神 + 冲生肖 */
function scoreHour(h, fav, unf, dayMaster, chongZhi) {
    let s = 0;
    if (fav.includes(h.element))
        s += 2;
    else if (h.element === dayMaster)
        s += 1;
    else if (unf.includes(h.element))
        s -= 1;
    if (chongZhi && (h.ganzhi.charAt(1) === chongZhi))
        s -= 3;
    return s;
}
/**
 * 每日开运关键词（本地规则生成，零成本）。
 * 合规红线：不出任何具体数字，只给五行/天干/地支/方位/时辰/色彩的意象关键词。
 */
function generateDailyLucky(input) {
    const region = input.region === 'tw' ? 'tw' : 'hk';
    const bazi = (0, baziService_1.computeBaZi)(input.birth);
    const almanac = (0, baziService_1.getAlmanac)(input.date);
    const dayGan = almanac.ganzhiDay.charAt(0);
    const dayZhi = almanac.ganzhiDay.charAt(1);
    const dayEl = GAN_WX[dayGan] || '土';
    const fav = bazi.favorable?.length ? bazi.favorable : [dayEl];
    const unf = bazi.unfavorable || [];
    const favEl = fav[0];
    const el = ELEMENT_CARDS[favEl] || ELEMENT_CARDS.土;
    // 五行牌：今日日干五行与命主喜忌的关系
    let wxInterp;
    if (fav.includes(dayEl)) {
        wxInterp = `今日日干属「${dayEl}」，正合您的喜用五行，气场相投，宜放大「${el.keyword}」之势。`;
    }
    else if (unf.includes(dayEl)) {
        wxInterp = `今日日干属「${dayEl}」，略近忌神，宜以喜用「${favEl}」（${el.keyword}）来中和提气。`;
    }
    else {
        wxInterp = `今日五行主气在「${dayEl}」，您喜用「${favEl}」，以「${el.keyword}」为今日开运意象。`;
    }
    // 地支牌：今日地支 + 六合生肖
    const liuheZhi = LIUHE[dayZhi];
    const liuheZodiac = ZHI_ZODIAC[liuheZhi] || '';
    // 时辰牌：挑今日最好的一至两个时辰
    const ZHI_CHARS = '子丑寅卯辰巳午未申酉戌亥';
    const hours = (0, baziService_1.getHourPillars)(input.date).map(h => ({
        ...h,
        label: `${ZHI_CHARS.charAt(h.hourIndex)}时`,
        score: scoreHour(h, fav, unf, bazi.dayMaster, null),
    }));
    const best = [...hours].sort((a, b) => b.score - a.score)[0];
    const cards = [
        {
            type: '五行',
            title: '五行牌',
            glyph: favEl,
            keyword: `旺「${favEl}」·${el.keyword}`,
            interpretation: `${el.desc}${wxInterp}`,
            hint: `今日宜亲近「${el.color}」系列之色，${el.direction}方位多走动。`,
        },
        {
            type: '天干',
            title: '天干牌',
            glyph: dayGan,
            keyword: `${dayGan}日·${GAN_CARDS[dayGan]?.keyword || ''}`,
            interpretation: `${GAN_CARDS[dayGan]?.desc || `今日天干为「${dayGan}」。`}`,
            hint: '此意象可贯穿今日言行，行事顺势得力。',
        },
        {
            type: '地支',
            title: '地支牌',
            glyph: dayZhi,
            keyword: `${dayZhi}·${ZHI_CARDS[dayZhi]?.keyword || ''}`,
            interpretation: `${ZHI_CARDS[dayZhi]?.desc || ''}`,
            hint: liuheZodiac
                ? `今日地支与「${liuheZodiac}」相合，与属「${liuheZodiac}」的人共事更顺。`
                : '今日地支意象宜多体味、顺势而为。',
        },
        {
            type: '方位',
            title: '方位牌',
            glyph: almanac.position.cai || '财',
            keyword: `财神${almanac.position.cai || '未定'}·喜神${almanac.position.xi || '未定'}`,
            interpretation: `今日财神在${almanac.position.cai || '中宫'}，喜神在${almanac.position.xi || '中宫'}。求财谋事面向财神方，喜事人缘面向喜神方。`,
            hint: `面朝${almanac.position.cai || '中宫'}（财神）方向可助财运，${almanac.position.xi || '中宫'}（喜神）方向利喜事。`,
        },
        {
            type: '时辰',
            title: '时辰牌',
            glyph: best?.label ? best.label.charAt(0) : '吉',
            keyword: best?.label ? `${best.label}（${best.range}）` : '吉时',
            interpretation: best?.label
                ? `${best.label}（${best.range}）五行与您喜用相投，是今日办事、出行最旺的时段。`
                : '今日时辰平平，顺其自然即可。',
            hint: best?.label ? `重要之事安排在${best.label}（${best.range}）更顺。` : '今日无特别旺时，平稳度过即可。',
        },
        {
            type: '色彩',
            title: '色彩牌',
            glyph: el.color.charAt(0),
            keyword: `${el.color}色`,
            interpretation: `喜用五行「${favEl}」对应「${el.color}」色系，穿戴与随身配饰以此色为佳。`,
            hint: `今日穿戴可点缀「${el.color}」色，贴身之物避开忌神「${unf[0] || ''}」属相之色。`,
        },
    ];
    const tip = `今日关键词：旺「${favEl}」、${dayGan}日、${dayZhi}地、财神${almanac.position.cai || '中'}方。宜亲「${el.color}」色、向${el.direction}行，${best?.label ? `${best.label}（${best.range}）最旺` : '以平和为吉'}。`;
    // 古籍依据：检索几个代表性关键词，去重取书名
    const sourceKeys = [dayGan, favEl, '贵人', '五行', '六合'];
    const found = new Set();
    const ancientSources = [];
    for (const kw of sourceKeys) {
        for (const h of ancientService_1.ancientLib.search(kw, 2)) {
            if (!found.has(h.bookId)) {
                found.add(h.bookId);
                ancientSources.push(h.title);
                if (ancientSources.length >= 4)
                    break;
            }
        }
        if (ancientSources.length >= 4)
            break;
    }
    return {
        date: input.date,
        region,
        birthSummary: dayMasterSummary(bazi),
        cards,
        tip,
        ancientSources,
        disclaimer: '以上均为传统文化开运意象关键词，不含任何具体数字或投注建议，仅供娱乐参考。',
    };
}
//# sourceMappingURL=luckyService.js.map