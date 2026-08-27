"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_ZODIAC = exports.ELEMENT_PLACES = exports.FALLBACK_DIRECTIONS = exports.FALLBACK_YEAR_SHENGXIAO = exports.FALLBACK_YEAR_GANZHI = exports.FALLBACK_YEAR = void 0;
/** 2026 丙午马年九宫飞星方位（源自大师公开文章整理，作为抓取失败时的兜底） */
exports.FALLBACK_YEAR = 2026;
exports.FALLBACK_YEAR_GANZHI = '丙午';
exports.FALLBACK_YEAR_SHENGXIAO = '马';
exports.FALLBACK_DIRECTIONS = [
    { direction: '正东', palace: '震宫', star: '八白', meaning: '左辅星入位，财星照临', good: true, advice: '利财运置业，可多加利用东面空间或前往东方城市发展商贸。' },
    { direction: '东南', palace: '巽宫', star: '九紫', meaning: '喜庆当运星', good: true, advice: '利喜事、姻缘、人缘，走东南方办事顺遂，利催旺喜庆。' },
    { direction: '东北', palace: '艮宫', star: '四绿', meaning: '文昌星', good: true, advice: '利读书考试、提升名气，求职面试或进修宜选东北方位。' },
    { direction: '正北', palace: '坎宫', star: '六白', meaning: '武曲星', good: true, advice: '利事业权力、升职加薪，从事技术/实务工作更佳。' },
    { direction: '中宫', palace: '中宫', star: '桃花', meaning: '人缘桃花位', good: true, advice: '利人际桃花，单身者走中央方位呼应人缘。' },
    { direction: '正南', palace: '离宫', star: '五黄', meaning: '大病位（最凶）', good: false, advice: '今年不宜久居正南，忌动土装修，少往正南方向山头医院处久留。' },
    { direction: '西北', palace: '乾宫', star: '二黑', meaning: '小病位', good: false, advice: '注意呼吸道肠胃健康，西北方向尽量避免长时间办公起居。' },
    { direction: '西南', palace: '坤宫', star: '七赤', meaning: '破军贼星', good: false, advice: '防失窃破财，西南方向旅游购物宜谨慎，忌摆重要财物。' },
    { direction: '正西', palace: '兑宫', star: '三碧', meaning: '是非争斗位', good: false, advice: '防口舌是非，正西方向争执较多，出门在外忌多言。' },
];
/** 五行喜忌 → 出行/地点建议（供本地兜底生成） */
exports.ELEMENT_PLACES = {
    '木': '东方位、绿色山林之地；适合到园林景区远足（如台北阳明山、香港大屿山郊野区），从事与木、教育、文字相关行业有利。',
    '火': '南方位、阳光温暖之地；适合去海滩、夜市、繁华闹市（如垦丁、高雄、香港铜锣湾），宜配合照明充足的环境。',
    '土': '本地、中部山区原位；郊野公园、田间农庄有利（如香港马鞍山、台中市郊），宜稳定置业储蓄。',
    '金': '西方位、金属/现代产业之地；适合去城市商业区、科技园区（如澳门、香港中环），利进修与金属相关行业。',
    '水': '北方位、近水之地；适合海边、水乡、渡假岛（如台北淡水、香港离岛、青岛），利流动与智慧谋略。',
};
/** 2026年12生肖流年运程（源自公开报道文字整理，兜底用） */
exports.FALLBACK_ZODIAC = {
    鼠: { zodiac: '鼠', overview: '冲太岁，变动多，宜动不宜静。', career: '工作宜主动求变，转工或进修有突破。', wealth: '财运波动，忌投机。', love: '感情易生变，多沟通。', health: '注意交通安全与肝胆。', tip: '全年可戴生肖马/牛饰品，喜事冲喜。', source: '' },
    牛: { zodiac: '牛', overview: '害太岁，防小人，人际关系要谨慎。', career: '勿强出头，防同事口舌。', wealth: '财库略陷，投资宜保守。', love: '防感情第三者干扰。', health: '注意脾胃与旧患。', tip: '宜佩戴生肖鼠饰品，多行善积德。', source: '' },
    虎: { zodiac: '虎', overview: '运势平稳回升，贵人运渐显。', career: '事业有晋升机会，宜把握。', wealth: '正财稳定，偏财小吉。', love: '桃花运不错，单身的可把握。', health: '注意呼吸道，少熬夜。', tip: '今年可向东北文昌位发力进修。', source: '' },
    兔: { zodiac: '兔', overview: '破太岁，防意外破耗，谨慎理财。', career: '工作琐事多，忍一时风平浪静。', wealth: '破财风险，开支做好预算。', love: '感情需多陪伴，忌冷暴力。', health: '防跌碰与皮肤损伤。', tip: '宜戴生肖羊/猪饰物，家中东南放水催旺。', source: '' },
    龙: { zodiac: '龙', overview: '运势平稳，人缘社交旺。', career: '团队协作顺利，忌单打独斗。', wealth: '财运平稳，可稳健理财。', love: '人缘好，桃花平平。', health: '注意饮食规律。', tip: '今年利学习进修，东北方位得力。', source: '' },
    蛇: { zodiac: '蛇', overview: '吉星拱照，事业通达。', career: '职权有望提升，实干为要。', wealth: '财运上升，偏财也有进账。', love: '先婚后爱趋势，稳字当头。', health: '注意心脑血管与三高。', tip: '宜往正东财位发展，保持低调。', source: '' },
    马: { zodiac: '马', overview: '本命年犯太岁，运势起伏最大，宜一喜挡三灾。', career: '得将星、岁驾助力，领导才能发挥，但波折难免。', wealth: '财运尚可，量入为出。', love: '感情不稳定，未有喜事要多包容。', health: '慎防金属利器与交通意外，忌开快车。', tip: '宜佩羊形饰物化太岁，结婚添丁置业冲喜。', source: '' },
    羊: { zodiac: '羊', overview: '与太岁相合，全年顺遂亨通。', career: '贵人相助，晋升机会大。', wealth: '财运畅旺，可望置业。', love: '感情升温，宜定终身。', health: '整体健康良好。', tip: '把握吉星，大胆尝试新计划。', source: '' },
    猴: { zodiac: '猴', overview: '运势中平，需防操劳过度。', career: '工作量增，注意劳逸结合。', wealth: '财来财去，开源节流。', love: '聚少离多，多安排见面。', health: '注意肠胃与睡眠。', tip: '宜正北武曲位发力，稳中求进。', source: '' },
    鸡: { zodiac: '鸡', overview: '吉星大满贯，财运桃花亮眼。', career: '金榜题名类型，考试晋升皆宜。', wealth: '正偏财俱佳，可适度投资。', love: '桃花旺盛，脱单好时机。', health: '注意皮肤过敏。', tip: '今年把握机遇，可外派或迁移求发展。', source: '' },
    狗: { zodiac: '狗', overview: '与太岁相合，运势顺遂。', career: '职场顺心，贵人帮扶。', wealth: '财运作佳，利存款。', love: '感情稳定前行。', health: '严防暴饮暴食。', tip: '进财之余宜置业，落袋为安。', source: '' },
    猪: { zodiac: '猪', overview: '运势平稳，宜守不宜攻。', career: '事业稳步，勿急进。', wealth: '财运平平，锻炼聚财。', love: '感情细水长流。', health: '注意旧疾复发。', tip: '宜正东财星坐向，多看少动。', source: '' },
};
//# sourceMappingURL=fallbackData.js.map