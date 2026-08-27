"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const routes_1 = require("./routes");
const config_1 = require("./config");
const scraperService_1 = require("./services/scraperService");
const store_1 = require("./services/store");
const aiService_1 = require("./services/aiService");
const manualMasters_1 = require("./data/manualMasters");
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const app = (0, fastify_1.default)({ logger: true });
// 全局限流：默认宽松（静态接口），烧钱接口在路由内单独收紧
app.register(rate_limit_1.default, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (req, context) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: `请求过于频繁，请 ${context.after} 后再试`,
    }),
});
app.register(routes_1.registerRoutes);
// CORS（供 Expo 真机/浏览器调试）——收窄到允许来源，避免任意网页蹭 AI 额度
app.addHook('onSend', async (_req, reply) => {
    const origin = _req.headers.origin;
    const allowed = config_1.config.corsOrigins;
    if (origin && (allowed.includes('*') || allowed.includes(origin))) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Access-Control-Allow-Credentials', 'true');
    }
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
});
// 浏览器跨域预检（preflight）——返回 204 而非 404
app.options('/api/*', async (_req, reply) => {
    reply.code(204).send();
});
app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'Not Found', path: req.url });
});
app.setErrorHandler((err, req, reply) => {
    const e = err;
    reply.log.error({ err }, '请求处理异常');
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    if (status >= 500) {
        reply.code(500).send({ error: '服务器内部错误，请稍后重试' });
    }
    else {
        reply.code(status).send({ error: e.message || 'Bad Request' });
    }
});
async function main() {
    const removed = (0, store_1.cleanupDb)();
    if (removed)
        console.log(`[清理] 启动时清理 ${removed} 条过期/超量数据`);
    const seeded = (0, manualMasters_1.seedManualArticles)();
    if (seeded)
        console.log(`[资料] 人工整理大师文献 ${seeded} 条已就绪`);
    await app.listen({ port: config_1.config.port, host: '0.0.0.0' });
    console.log(`[启动] 趋吉避凶后端已运行 http://0.0.0.0:${config_1.config.port}`);
    if ((0, aiService_1.hasApiKey)()) {
        console.log(`[AI] ${config_1.config.aiProvider} 模式`);
    }
    else {
        console.warn(`[AI] 未配置 ${config_1.config.aiProvider === 'gemini' ? 'GEMINI_API_KEY' : 'DEEPSEEK_API_KEY'}，将使用本地规则模式（建议配置后体验完整功能）`);
    }
    (0, scraperService_1.startSchedule)();
    // 定时清理数据库，避免长期运行膨胀
    setInterval(() => {
        try {
            const n = (0, store_1.cleanupDb)();
            if (n)
                console.log(`[清理] 定时清理 ${n} 条过期/超量数据`);
        }
        catch (e) {
            console.error('[清理] 定时清理异常:', e.message);
        }
    }, 24 * 60 * 60 * 1000);
}
main().catch(e => {
    console.error('启动失败:', e);
    process.exit(1);
});
// 全局异常兜底：记录日志而非静默崩溃
process.on('unhandledRejection', (reason) => {
    console.error('[未处理拒绝]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[未捕获异常]', err);
});
// 优雅关闭：停止定时任务、关闭 HTTP 与数据库，让在途请求与 WAL 落盘
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    console.log(`[关闭] 收到 ${signal}，正在优雅退出…`);
    try {
        (0, scraperService_1.stopSchedule)();
        await app.close();
    }
    catch (e) {
        console.error('[关闭] HTTP 关闭异常:', e);
    }
    try {
        store_1.db.close();
    }
    catch (e) {
        console.error('[关闭] 数据库关闭异常:', e);
    }
    process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
//# sourceMappingURL=index.js.map