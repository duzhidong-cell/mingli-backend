import { runScrapeOnce } from '../services/scraperService';
const result = await runScrapeOnce();
console.log(`[完成] 新增 ${result.added} 篇，库内共 ${result.total} 篇`);
//# sourceMappingURL=scrape.js.map