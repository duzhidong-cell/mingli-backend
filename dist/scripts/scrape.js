"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const scraperService_1 = require("../services/scraperService");
const result = await (0, scraperService_1.runScrapeOnce)();
console.log(`[完成] 新增 ${result.added} 篇，库内共 ${result.total} 篇`);
//# sourceMappingURL=scrape.js.map