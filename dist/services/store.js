"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.upsertArticle = upsertArticle;
exports.getArticles = getArticles;
exports.searchArticles = searchArticles;
exports.getArticleCount = getArticleCount;
exports.upsertSubscription = upsertSubscription;
exports.getSubscription = getSubscription;
exports.cacheGet = cacheGet;
exports.cacheSet = cacheSet;
exports.cacheDel = cacheDel;
exports.purgeExpiredCache = purgeExpiredCache;
exports.pruneArticles = pruneArticles;
exports.pruneCache = pruneCache;
exports.cleanupDb = cleanupDb;
const node_sqlite_1 = require("node:sqlite");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("../config");
const zhTradition_1 = require("../utils/zhTradition");
const dbPath = (0, node_path_1.join)(process.cwd(), config_1.config.dbPath);
(0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(dbPath), { recursive: true });
// 启动时偶发 SQLITE_BUSY（其他进程正写库），重试几次再放弃
function openDbWithRetry(retries = 5) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            const d = new node_sqlite_1.DatabaseSync(dbPath);
            d.exec('PRAGMA journal_mode = WAL;');
            d.exec('PRAGMA busy_timeout = 5000;');
            return d;
        }
        catch (e) {
            lastErr = e;
            const delay = 200 * (i + 1);
            console.warn(`[存储] 打开数据库失败，${delay}ms 后重试 (${i + 1}/${retries})`);
            const t1 = Date.now();
            while (Date.now() - t1 < delay) { /* sleep */ }
        }
    }
    throw lastErr;
}
exports.db = openDbWithRetry();
/** 缓存默认有效时长（毫秒），过期的条目视为未命中 */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
exports.db.exec(`
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE,
  title TEXT,
  content TEXT,
  summary TEXT,
  source TEXT,
  keywords TEXT,
  published_at TEXT,
  scraped_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS advice_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  device_id TEXT PRIMARY KEY,
  product_id TEXT,
  purchase_token TEXT,
  status TEXT,
  expiry_ms INTEGER DEFAULT 0,
  auto_renewing INTEGER DEFAULT 0,
  verified_mode TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_scraped ON articles(scraped_at);
`);
// 旧库迁移：若 advice_cache 缺 expires_at 列则补上
const cacheCols = exports.db.prepare('PRAGMA table_info(advice_cache)').all();
if (!cacheCols.some(c => c.name === 'expires_at')) {
    exports.db.exec('ALTER TABLE advice_cache ADD COLUMN expires_at TEXT');
}
try {
    exports.db.exec('CREATE INDEX IF NOT EXISTS idx_advice_cache_expires ON advice_cache(expires_at)');
}
catch { /* 索引冲突忽略 */ }
function upsertArticle(a) {
    exports.db.prepare(`
    INSERT INTO articles (url, title, content, summary, source, keywords, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title=excluded.title, content=excluded.content, summary=excluded.summary,
      keywords=excluded.keywords, scraped_at=datetime('now')
  `).run(a.url, a.title, a.content, a.summary, a.source, JSON.stringify(a.keywords), a.publishedAt);
}
function getArticles(limit = 50, keyword) {
    let sql = `SELECT * FROM articles ORDER BY scraped_at DESC LIMIT ?`;
    const params = [limit];
    if (keyword) {
        sql = `SELECT * FROM articles WHERE content LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY scraped_at DESC LIMIT ?`;
        // 文章为繁体，把简/繁关键词都转成繁体再匹配（tw 对繁体输入是幂等）
        const esc = String((0, zhTradition_1.tw)(keyword)).replace(/[\\%_]/g, m => `\\${m}`);
        params.unshift(`%${esc}%`, `%${esc}%`);
    }
    const rows = exports.db.prepare(sql).all(...params);
    return rows.map(r => ({
        id: Number(r.id),
        url: String(r.url),
        title: String(r.title || ''),
        content: String(r.content || ''),
        summary: String(r.summary || ''),
        source: String(r.source || ''),
        keywords: safeJson(r.keywords),
        publishedAt: String(r.published_at || ''),
        scrapedAt: String(r.scraped_at || ''),
    }));
}
function searchArticles(keyword, limit = 10) {
    return getArticles(limit, keyword);
}
function getArticleCount() {
    const row = exports.db.prepare('SELECT COUNT(*) AS c FROM articles').get();
    return row.c;
}
function upsertSubscription(s) {
    exports.db.prepare(`
    INSERT INTO subscriptions (device_id, product_id, purchase_token, status, expiry_ms, auto_renewing, verified_mode, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(device_id) DO UPDATE SET
      product_id=excluded.product_id, purchase_token=excluded.purchase_token,
      status=excluded.status, expiry_ms=excluded.expiry_ms,
      auto_renewing=excluded.auto_renewing, verified_mode=excluded.verified_mode,
      updated_at=datetime('now')
  `).run(s.deviceId, s.productId, s.purchaseToken, s.status, s.expiryMs, s.autoRenewing ? 1 : 0, s.verifiedMode);
}
function getSubscription(deviceId) {
    const r = exports.db.prepare('SELECT * FROM subscriptions WHERE device_id = ?').get(deviceId);
    if (!r)
        return null;
    return {
        deviceId: String(r.device_id),
        productId: String(r.product_id || ''),
        purchaseToken: String(r.purchase_token || ''),
        status: String(r.status || 'unknown'),
        expiryMs: Number(r.expiry_ms) || 0,
        autoRenewing: Number(r.auto_renewing) === 1,
        verifiedMode: String(r.verified_mode || ''),
        updatedAt: String(r.updated_at || ''),
    };
}
function cacheGet(key, ttlMs = DEFAULT_TTL_MS) {
    const row = exports.db.prepare('SELECT payload, created_at FROM advice_cache WHERE cache_key = ?').get(key);
    if (!row)
        return null;
    const createdAt = Date.parse(String(row.created_at).replace(' ', 'T') + 'Z');
    if (!Number.isFinite(createdAt))
        return null;
    if (Date.now() - createdAt > ttlMs) {
        cacheDel(key);
        return null;
    }
    try {
        return JSON.parse(row.payload);
    }
    catch {
        cacheDel(key);
        return null;
    }
}
function cacheSet(key, payload, ttlMs = DEFAULT_TTL_MS) {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString().replace('T', ' ').slice(0, 19);
    exports.db.prepare(`
    INSERT INTO advice_cache (cache_key, payload, created_at, expires_at) VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, created_at=excluded.created_at, expires_at=excluded.expires_at
  `).run(key, JSON.stringify(payload), expiresAt);
}
function cacheDel(key) {
    exports.db.prepare('DELETE FROM advice_cache WHERE cache_key = ?').run(key);
}
/** 清理已过期缓存，防止数据库无限膨胀（按每条记录各自的过期时间删除） */
function purgeExpiredCache() {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const cutoff = new Date(Date.now() - DEFAULT_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
    // expires_at 未写入的旧行回退用默认 TTL
    const res = exports.db.prepare(`DELETE FROM advice_cache WHERE expires_at IS NOT NULL AND expires_at < ? OR expires_at IS NULL AND created_at < ?`).run(now, cutoff);
    return Number(res.changes);
}
/** 各表保留行数上限，防止数据库无限膨胀 */
const MAX_ARTICLES = 2000;
const MAX_CACHE_ENTRIES = 2000;
/** 修剪 articles：只保留最新的 N 条，删除更旧的行 */
function pruneArticles() {
    const res = exports.db.prepare(`DELETE FROM articles WHERE id NOT IN (
       SELECT id FROM articles ORDER BY scraped_at DESC, id DESC LIMIT ?
     )`).run(MAX_ARTICLES);
    return Number(res.changes);
}
/** 修剪 advice_cache：只保留最新的 N 条缓存（created_at 为 YYYY-MM-DD HH:MM:SS，可直接字典序比较） */
function pruneCache() {
    const res = exports.db.prepare(`DELETE FROM advice_cache WHERE cache_key NOT IN (
       SELECT cache_key FROM advice_cache ORDER BY created_at DESC LIMIT ?
     )`).run(MAX_CACHE_ENTRIES);
    return Number(res.changes);
}
/** 综合清理：过期缓存 + 各表行数上限 */
function cleanupDb() {
    let removed = 0;
    removed += purgeExpiredCache();
    removed += pruneArticles();
    removed += pruneCache();
    return removed;
}
function safeJson(v) {
    if (v == null)
        return [];
    try {
        const p = JSON.parse(String(v));
        return Array.isArray(p) ? p.map(String) : [];
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=store.js.map