"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ancientLib = exports.AncientLibrary = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("../config");
class AncientLibrary {
    books = [];
    contentCache = new Map();
    load() {
        const dir = (0, node_path_1.join)(process.cwd(), config_1.config.ancientDir);
        try {
            const files = this.ensureDir(dir);
            this.books = files.map((f) => {
                const file = (0, node_path_1.join)(dir, f);
                const stat = (0, node_fs_1.statSync)(file);
                const raw = (0, node_fs_1.readFileSync)(file, 'utf8');
                const lines = raw.replace(/^\uFEFF/, '').split('\n');
                const introLine = lines.find((l) => l.startsWith('>')) || '';
                return {
                    id: f.replace(/\.md$/i, ''),
                    title: (lines.find((l) => l.startsWith('# ')) || f).replace(/^#\s*/, '').trim(),
                    intro: introLine.replace(/^>\s*/, '').slice(0, 120).trim(),
                    chars: stat.size,
                    file: f,
                };
            });
            this.books.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
        }
        catch {
            this.books = [];
        }
    }
    ensureDir(dir) {
        try {
            return (0, node_fs_1.readdirSync)(dir).filter((f) => f.endsWith('.md'));
        }
        catch {
            return [];
        }
    }
    constructor() {
        this.load();
    }
    get lists() {
        return this.books;
    }
    get count() {
        return this.books.length;
    }
    read(id) {
        const b = this.books.find((x) => x.id === id);
        if (!b)
            return null;
        const cached = this.contentCache.get(id);
        if (cached != null)
            return cached;
        const raw = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), config_1.config.ancientDir, b.file), 'utf8')
            .replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
        this.contentCache.set(id, raw);
        return raw;
    }
    search(keyword, limit = 10) {
        const kw = keyword.trim();
        if (!kw)
            return [];
        const out = [];
        for (const b of this.books) {
            const cached = this.contentCache.get(b.id) ?? this.read(b.id);
            if (!cached)
                continue;
            const paras = cached.replace(/\r\n/g, '\n').split(/\n{2,}/);
            const body = paras.filter((p) => {
                if (!p.trim())
                    return false;
                const t = p.trim();
                if (/^#{1,3}\s/.test(t))
                    return false;
                if (t.startsWith('>'))
                    return false;
                if (t.startsWith('---'))
                    return false;
                if (/^\s*\|/.test(t) && t.includes('|'))
                    return false;
                if (/^\s*-+\s*关联/.test(t))
                    return false;
                return true;
            });
            for (const p of body) {
                if (p.includes(kw)) {
                    const clean = p.replace(/^\s*[-*]\s*/gm, '').replace(/[*_`]/g, '').slice(0, 400);
                    out.push({ bookId: b.id, title: b.title, text: clean });
                    if (out.length >= limit)
                        return out;
                }
            }
        }
        return out;
    }
}
exports.AncientLibrary = AncientLibrary;
exports.ancientLib = new AncientLibrary();
//# sourceMappingURL=ancientService.js.map