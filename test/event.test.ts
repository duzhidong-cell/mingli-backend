import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCalendarMonth, getHourPillars } from '../src/services/baziService';
import { generateEventAdvice, EVENT_TYPES } from '../src/services/eventService';
import type { BirthInput } from '../src/types';

const birth: BirthInput = {
  year: 1990, month: 8, day: 15, hour: 6, minute: 35, gender: 1, isLunar: false, longitude: 114.17,
};

test('getCalendarMonth: 8月返回31天且含农历与宜忌', () => {
  const cal = getCalendarMonth(2026, 8);
  assert.equal(cal.days.length, 31);
  assert.ok(cal.days[0].lunarDay.length > 0);
  assert.ok(cal.days[0].ganzhiDay.length === 2);
  assert.ok(typeof cal.days[0].yi.length === 'number');
});

test('getHourPillars: 返回12个时辰且干支合法', () => {
  const hs = getHourPillars('2026-08-18');
  assert.equal(hs.length, 12);
  assert.equal(hs[0].range, '23-01');
  assert.equal(hs[0].ganzhi.length, 2);
});

test('generateEventAdvice: 婚礼返回完整判定', () => {
  const r = generateEventAdvice({ birth, eventType: '婚礼', date: '2026-09-08' });
  assert.ok(['宜', '平', '慎', '忌'].includes(r.verdict));
  assert.ok(r.score >= 15 && r.score <= 98);
  assert.ok(r.reasons.length > 0);
  assert.ok(Array.isArray(r.luckyHours));
  // 婚礼为送礼场合 → 应有赠送建议
  assert.ok(r.giftTips.length > 0);
});

test('generateEventAdvice: 非法事件类型回退到首个类型', () => {
  const r = generateEventAdvice({ birth, eventType: '不存在的类型', date: '2026-09-08' });
  assert.equal(r.eventType, EVENT_TYPES[0].type);
});