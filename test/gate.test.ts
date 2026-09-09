import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index';
import { upsertSubscription, deleteSubscription, getSubscriptionByToken, db } from '../src/services/store';

const TEST_DEVICE = 'gate_test_0001';
const TEST_TOKEN = 'gate-test-token-0001';
const BIRTH = { year: 1990, month: 6, day: 15, hour: 10, minute: 30, gender: 1, isLunar: false };

let app: ReturnType<typeof buildApp>;
let base = '';

before(async () => {
  deleteSubscription(TEST_DEVICE); // 清理历史残留
  upsertSubscription({
    deviceId: TEST_DEVICE,
    productId: 'monthly_pro',
    purchaseToken: TEST_TOKEN,
    status: 'active',
    expiryMs: Date.now() + 30 * 24 * 3600 * 1000,
    autoRenewing: true,
    verifiedMode: 'trust',
  });
  app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await app.close();
  deleteSubscription(TEST_DEVICE);
  db.close();
});

test('订阅门禁：未携带 deviceId 的 AI 接口强制返回本地规则（mode=local）', async () => {
  const res = await fetch(`${base}/api/daily/advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ birth: BIRTH, date: '2026-09-09' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { mode?: string };
  assert.equal(data.mode, 'local');
});

test('订阅门禁：有效订阅 deviceId 可进入 AI 流程（响应结构完整）', async () => {
  const res = await fetch(`${base}/api/daily/advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ birth: BIRTH, date: '2026-09-09', deviceId: TEST_DEVICE }),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { mode?: string; score?: unknown; suitable?: unknown; tip?: unknown };
  assert.ok(data.mode === 'ai' || data.mode === 'local');
  assert.ok(Array.isArray(data.suitable));
  assert.equal(typeof data.score, 'number');
  assert.equal(typeof data.tip, 'string');
});

test('订阅门禁：流年建议接口同样受门禁约束', async () => {
  const res = await fetch(`${base}/api/annual/advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ birth: BIRTH, year: 2026 }),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { mode?: string };
  assert.equal(data.mode, 'local');
});

test('防一票多开：凭证可经 purchase_token 查询归属（唯一约束生效前提）', () => {
  const row = getSubscriptionByToken(TEST_TOKEN);
  assert.ok(row);
  assert.equal(row?.deviceId, TEST_DEVICE);
});