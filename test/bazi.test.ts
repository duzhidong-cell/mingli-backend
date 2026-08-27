import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBaZi, getAlmanac, hkToday, hkYear } from '../src/services/baziService';
import type { BirthInput } from '../src/types';

test('computeBaZi: 公历生日四柱正确', () => {
  const r = computeBaZi({ year: 1990, month: 8, day: 15, hour: 10, minute: 30, gender: 1, isLunar: false });
  assert.equal(r.ganZhiYear, '庚午');
  assert.equal(r.dayMaster, '水'); // 壬日主
  assert.ok(r.shortDesc.includes('庚午'));
  assert.ok(r.time.ganzhi.length === 2);
});

test('computeBaZi: 农历闰二月（2023-闰二月初十 → 公历 2023-03-31）', () => {
  const r = computeBaZi({ year: 2023, month: 2, day: 10, hour: 6, minute: 0, gender: 1, isLunar: true, isLeap: true });
  assert.equal(r.ganZhiYear, '癸卯');
  assert.equal(r.month.ganzhi, '乙卯'); // 2023-03-31 在卯月
  assert.equal(r.day.ganzhi, '戊子');   // 戊子日
});

test('computeBaZi: 同一钟表时间，成都 vs 香港 时辰柱不同（真太阳时）', () => {
  const base = { year: 1990, month: 8, day: 15, hour: 13, minute: 30, gender: 1, isLunar: false } as BirthInput;
  const hk = computeBaZi({ ...base, longitude: 114.17 });
  const cd = computeBaZi({ ...base, longitude: 104.07 });
  // 成都校正约 -64 分钟 → 落在午时，香港接近未时；时辰干支应不同
  assert.notEqual(hk.time.ganzhi, cd.time.ganzhi);
});

test('computeBaZi: 公历闰年 2月29 日可排', () => {
  const r = computeBaZi({ year: 2000, month: 2, day: 29, hour: 0, minute: 0, gender: 0, isLunar: false });
  assert.ok(r.shortDesc.length > 0);
});

test('getAlmanac: 每日黄历返回宜忌与方位', () => {
  const a = getAlmanac('2026-08-17');
  assert.equal(a.date, '2026-08-17');
  assert.ok(Array.isArray(a.yi) && a.yi.length > 0);
  assert.ok(a.position.cai.length > 0);
  assert.ok(a.ganzhiDay.length === 2);
});

test('hkToday/hkYear: 返回合法日期', () => {
  const d = hkToday();
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  const y = hkYear();
  assert.ok(y >= 2024 && y <= 2100);
});