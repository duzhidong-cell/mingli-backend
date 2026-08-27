import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';

interface AncientBook {
  id: string;
  title: string;
  intro: string;
  chars: number;
  file: string;
}

export class AncientLibrary {
  private books: AncientBook[] = [];
  private contentCache = new Map<string, string>();

  private load(): void {
    const dir = join(process.cwd(), config.ancientDir);
    try {
      const files = this.ensureDir(dir);
      this.books = files.map((f) => {
        const file = join(dir, f);
        const stat = statSync(file);
        const raw = readFileSync(file, 'utf8');
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
    } catch {
      this.books = [];
    }
  }

  private ensureDir(dir: string): string[] {
    try {
      return readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      return [];
    }
  }

  constructor() {
    this.load();
  }

  get lists(): AncientBook[] {
    return this.books;
  }

  get count(): number {
    return this.books.length;
  }

  read(id: string): string | null {
    const b = this.books.find((x) => x.id === id);
    if (!b) return null;
    const cached = this.contentCache.get(id);
    if (cached != null) return cached;
    const raw = readFileSync(join(process.cwd(), config.ancientDir, b.file), 'utf8')
      .replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    this.contentCache.set(id, raw);
    return raw;
  }

  search(keyword: string, limit = 10): { bookId: string; title: string; text: string }[] {
    const kw = keyword.trim();
    if (!kw) return [];
    const out: { bookId: string; title: string; text: string }[] = [];
    for (const b of this.books) {
      const cached = this.contentCache.get(b.id) ?? this.read(b.id);
      if (!cached) continue;
      const paras = cached.replace(/\r\n/g, '\n').split(/\n{2,}/);
      const body = paras.filter((p) => {
        if (!p.trim()) return false;
        const t = p.trim();
        if (/^#{1,3}\s/.test(t)) return false;
        if (t.startsWith('>')) return false;
        if (t.startsWith('---')) return false;
        if (/^\s*\|/.test(t) && t.includes('|')) return false;
        if (/^\s*-+\s*关联/.test(t)) return false;
        return true;
      });
      for (const p of body) {
        if (p.includes(kw)) {
          const clean = p.replace(/^\s*[-*]\s*/gm, '').replace(/[*_`]/g, '').slice(0, 400);
          out.push({ bookId: b.id, title: b.title, text: clean });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }
}

export const ancientLib = new AncientLibrary();