import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8787),
  /** 允许的浏览器来源（CORS），逗号分隔；* 表示全部放开（默认开发期全部，上线收紧） */
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()),
  aiProvider: process.env.AI_PROVIDER || 'deepseek',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  /** 兜底 AI（第二层）：DeepSeek/Gemini 失败时自动切换。留空则跳过 */
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  scrapeEnabled: String(process.env.SCRAPE_ENABLED || 'true') !== 'false',
  scrapeIntervalMin: Number(process.env.SCRAPE_INTERVAL_MIN || 720),
  /** 抓取代理，如 http://user:pass@host:port（访问香港站点受限的环境使用） */
  proxyUrl: process.env.PROXY_URL || '',
  dbPath: 'data/app.db',
  scrapedDir: 'scraped',
  ancientDir: 'ancient',
  /** Google Play 应用包名（订阅校验用） */
  playPackageName: process.env.PLAY_PACKAGE_NAME || 'com.qjbx.app',
  /** Google Play 服务账号 JSON 路径；文件不存在时进入「沙盒直通」模式（信任客户端，仅供内测） */
  playServiceAccountPath: process.env.PLAY_SERVICE_ACCOUNT || 'credentials/google-play-service-account.json',
};