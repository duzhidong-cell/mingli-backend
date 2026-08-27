"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScrapeOnce = runScrapeOnce;
exports.startSchedule = startSchedule;
exports.stopSchedule = stopSchedule;
const crawlee_1 = require("crawlee");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const sources_json_1 = __importDefault(require("../data/sources.json"));
const store_1 = require("./store");
const config_1 = require("../config");
// 清理 crawlee 的持久化目录（本项目不做断点续爬，storage/ 只是垃圾）
const crawleeStorage = (0, node_path_1.join)(process.cwd(), 'storage');
if ((0, node_fs_1.existsSync)(crawleeStorage)) {
    try {
        (0, node_fs_1.rmSync)(crawleeStorage, { recursive: true, force: true });
        console.log('[抓取] 已清理 crawlee 残留目录 storage/');
    }
    catch (e) {
        console.warn('[抓取] 清理 storage/ 失败:', e.message);
    }
}
// 关闭 crawlee 磁盘持久化，避免每次抓取重新生成 storage/
crawlee_1.Configuration.getGlobalConfig().set('persistStorage', false);
const KEYWORDS = sources_json_1.default.keywords;
function hasKeyword(text) {
    const t = text || '';
    for (const k of KEYWORDS) {
        if (t.includes(k))
            return k;
    }
    return null;
}
function extractArticle($) {
    let title = $('h1').first().text().trim();
    const ogTitle = $('meta[property="og:title"]').attr('content');
    if (!title && ogTitle)
        title = ogTitle;
    // 取正文：优先已知容器，其次取全文最多<p>的区块
    const containers = [
        'article', '.article-content', '.article-body', '.post-content',
        '.story-content', '.entry-content', '.content', '#content',
        '#article', '#main-content', 'main',
    ];
    let best = [];
    for (const sel of containers) {
        const el = $(sel).first();
        if (!el.length)
            continue;
        const paras = [];
        el.find('p').each((_, p) => {
            const t = $(p).text().trim();
            if (t.length > 5)
                paras.push(t);
        });
        if (paras.length > best.length)
            best = paras;
    }
    // 兜底：全文 p
    if (!best.length) {
        $('p').each((_, p) => {
            const t = $(p).text().trim();
            if (t.length > 5)
                best.push(t);
        });
    }
    const content = best.join('\n').slice(0, 8000);
    let publishedAt = $('meta[property="article:published_time"]').attr('content') || '';
    if (!publishedAt) {
        const t = $('time[datetime]').attr('datetime');
        if (t)
            publishedAt = t;
    }
    return { title: title.slice(0, 300), content, publishedAt };
}
async function runSource(source) {
    let added = 0;
    const crawler = new crawlee_1.CheerioCrawler({
        maxConcurrency: 3,
        maxRequestsPerCrawl: 120,
        maxRequestRetries: 1,
        retryOnBlocked: true,
        requestHandlerTimeoutSecs: 30,
        proxyConfiguration: config_1.config.proxyUrl
            ? new crawlee_1.ProxyConfiguration({ proxyUrls: [config_1.config.proxyUrl] })
            : undefined,
        async requestHandler(ctx) {
            const { request, $ } = ctx;
            const depth = request.userData?.depth || 0;
            const metaKw = hasKeyword(request.url);
            const titleText = metaKw || '';
            const pageTitle = $('h1').first().text().trim();
            const linkHit = metaKw ?? hasKeyword(pageTitle);
            // 列表/搜索页：把命中关键字的链接入队
            if (depth < 2) {
                const links = new Set();
                $('a[href]').each((_, a) => {
                    const href = $(a).attr('href') || '';
                    const text = $(a).text().trim() || '';
                    if (!href || href.startsWith('javascript') || href.startsWith('#'))
                        return;
                    if (hasKeyword(href) || hasKeyword(text) || (linkHit && /article|story|news|\/\d+\.html|\.html$|\.php/i.test(href))) {
                        links.add(new URL(href, request.loadedUrl).toString());
                    }
                });
                if (links.size) {
                    await ctx.enqueueLinks({
                        urls: [...links].slice(0, 60),
                        userData: { depth: depth + 1 },
                    });
                }
            }
            // 文章页：抽取正文
            if ((linkHit || depth >= 1) && pageTitle.length > 6) {
                const { title, content, publishedAt } = extractArticle($);
                if (content.length > 80) {
                    const summary = content.slice(0, 160);
                    const art = {
                        url: request.loadedUrl || request.url,
                        title: title || pageTitle,
                        content,
                        summary,
                        source: source.name,
                        keywords: [linkHit || 'general'],
                        publishedAt,
                    };
                    (0, store_1.upsertArticle)(art);
                    added++;
                }
            }
        },
    });
    try {
        await crawler.run(source.startUrls.map(url => ({ url, userData: { depth: 0 } })));
    }
    catch (e) {
        console.error(`[抓取] ${source.name} 失败:`, e.message);
        return { added: 0, failed: true };
    }
    return { added, failed: false };
}
let running = false;
/** 连续失败次数：连续 3 轮失败则跳过该源（冷却期） */
const FAIL_LIMIT = 3;
const FAIL_COOLDOWN_MS = 30 * 60 * 1000;
const failCount = new Map();
const skipUntil = new Map();
async function runScrapeOnce() {
    if (running)
        return { added: 0, total: (0, store_1.getArticleCount)() }; // 已有抓取在跑，直接跳过避免并发
    running = true;
    try {
        const now = Date.now();
        const results = await Promise.allSettled(sources_json_1.default.sources
            .filter(s => s.enabled)
            .map(async (source) => {
            const until = skipUntil.get(source.name) || 0;
            if (now < until) {
                console.log(`[抓取] 跳过 ${source.name}（连续失败，冷却中）`);
                return { added: 0, failed: false };
            }
            console.log(`[抓取] 开始: ${source.name}`);
            const r = await runSource(source);
            if (r.failed) {
                const n = (failCount.get(source.name) || 0) + 1;
                failCount.set(source.name, n);
                if (n >= FAIL_LIMIT) {
                    skipUntil.set(source.name, now + FAIL_COOLDOWN_MS);
                    failCount.delete(source.name);
                    console.log(`[抓取] ${source.name} 连续失败 ${n} 轮，暂停 ${FAIL_COOLDOWN_MS / 60000} 分钟`);
                }
            }
            else {
                failCount.delete(source.name);
            }
            return r;
        }));
        let added = 0;
        for (const res of results) {
            if (res.status === 'fulfilled')
                added += res.value.added;
        }
        return { added, total: (0, store_1.getArticleCount)() };
    }
    finally {
        running = false;
    }
}
/** 启动定时抓取 */
let scheduleTimer = null;
let bootTimer = null;
function startSchedule() {
    if (!config_1.config.scrapeEnabled)
        return;
    const run = async () => {
        try {
            const result = await runScrapeOnce();
            console.log(`[抓取] 本轮新增 ${result.added} 篇，累计 ${result.total} 篇`);
        }
        catch (e) {
            console.error('[抓取] 定时任务异常:', e.message);
        }
    };
    scheduleTimer = setInterval(run, config_1.config.scrapeIntervalMin * 60 * 1000);
    bootTimer = setTimeout(run, 3000);
}
/** 停止定时抓取（优雅关闭时调用） */
function stopSchedule() {
    if (scheduleTimer)
        clearInterval(scheduleTimer);
    if (bootTimer)
        clearTimeout(bootTimer);
    scheduleTimer = null;
    bootTimer = null;
}
//# sourceMappingURL=scraperService.js.map