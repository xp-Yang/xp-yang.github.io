import {
  isSessionData,
  normalizeSessionData,
  type SessionData,
} from '../application/session';

export const SAVE_KEY = 'chain-game:save:v1';
interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One envelope commits health, loot and level progress together. */
export class SessionStore {
  data: SessionData;
  notice = '';
  preservedInvalidSave: string | null = null;
  private durable = true;
  private storedRevision: number | null = null;
  private storedProfileId: string | null = null;

  constructor(
    private storage: StoragePort | null,
    fresh: () => SessionData,
  ) {
    this.data = fresh();
    try {
      if (!storage) throw new Error('Unavailable');
      const raw = storage.getItem(SAVE_KEY);
      if (raw) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* Preserve invalid data below. */
        }
        if (isSessionData(parsed)) {
          this.data = normalizeSessionData(parsed);
          this.storedRevision = parsed.revision;
          this.storedProfileId = parsed.profile.id;
        } else {
          this.preservedInvalidSave = raw;
          this.durable = false;
          this.notice =
            '旧存档无法读取，已保留原始数据。当前为临时体验，可在菜单导出旧存档。';
        }
      } else {
        storage.setItem(SAVE_KEY, JSON.stringify(this.data));
        this.storedRevision = this.data.revision;
        this.storedProfileId = this.data.profile.id;
      }
    } catch {
      this.durable = false;
      this.notice = '浏览器未允许保存。当前可以游玩，关闭页面后进度可能丢失。';
    }
  }

  save(next: SessionData): boolean {
    if (
      !isSessionData(next) ||
      next.profile.id !== this.data.profile.id ||
      next.revision <= this.data.revision
    ) {
      this.notice = '这份进度已经过期或无法读取，请重新加载后继续。';
      return false;
    }
    if (this.durable && this.storage) {
      try {
        const raw = this.storage.getItem(SAVE_KEY);
        let disk: unknown;
        try {
          disk = raw ? JSON.parse(raw) : null;
        } catch {
          /* Treat changed unreadable data as a conflict. */
        }
        if (
          !isSessionData(disk) ||
          disk.revision !== this.storedRevision ||
          disk.profile.id !== this.storedProfileId
        ) {
          this.notice = '另一个页面已更新存档。请刷新此页后继续。';
          return false;
        }
        this.storage.setItem(SAVE_KEY, JSON.stringify(next));
        this.storedRevision = next.revision;
        this.storedProfileId = next.profile.id;
      } catch {
        this.durable = false;
        this.notice = '进度暂时无法写入浏览器。请在菜单导出存档后再关闭页面。';
      }
    }
    this.data = next;
    return true;
  }

  reset(next: SessionData): void {
    this.data = next;
    try {
      if (!this.storage) throw new Error('Unavailable');
      this.storage.setItem(SAVE_KEY, JSON.stringify(next));
      this.storedRevision = next.revision;
      this.storedProfileId = next.profile.id;
      this.durable = true;
      this.preservedInvalidSave = null;
      this.notice = '';
    } catch {
      this.durable = false;
      this.notice = '当前为临时体验，关闭页面后进度可能丢失。';
    }
  }

  export(): string {
    return this.preservedInvalidSave ?? JSON.stringify(this.data, null, 2);
  }
}
