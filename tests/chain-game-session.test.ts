import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitPath,
  isLevelUnlocked,
  isSessionData,
  newSession,
  startLevel,
  type SessionData,
} from '../demos/chain-game/src/application/session';
import {
  entityAt,
  getLevel,
  TUTORIAL_CHAIN,
  type Creep,
  type Point,
} from '../demos/chain-game/src/core';
import {
  SAVE_KEY,
  SessionStore,
} from '../demos/chain-game/src/platform/storage';

class MemoryStorage {
  values = new Map<string, string>();
  writesFail = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.writesFail) throw new Error('Storage quota reached');
    this.values.set(key, value);
  }
}

function commit(data: SessionData, targets: readonly string[]): SessionData {
  const result = commitPath(data, targets);
  assert.ok(result.ok, result.ok ? undefined : result.error);
  assert.equal(
    isSessionData(result.data),
    true,
    'committed state must be persistable',
  );
  return result.data;
}

function enemyAt(data: SessionData, point: Point): Creep {
  const entity = entityAt(data.run, point);
  assert.ok(entity?.kind === 'creep');
  return entity;
}

function damageOnce(data: SessionData): SessionData {
  const start = data.run.player.pos;
  const target = enemyAt(data, { x: start.x, y: start.y - 1 });
  const attacker = enemyAt(data, { x: start.x + 1, y: start.y - 1 });
  attacker.mood = 'angry';
  attacker.attackActiveFromTurn = data.run.turn + 1;
  return commit(data, [target.id]);
}

function escape(data: SessionData, gems = 7): SessionData {
  const level = getLevel(data.run.levelId);
  const gateCell = level.exit.entryCells[1];
  const previous = data.run.player.pos;
  const swap = entityAt(data.run, gateCell);
  if (swap) swap.pos = previous;
  data.run.player.pos = gateCell;
  data.run.killCount = level.goal;
  data.run.exitUnlocked = true;
  data.run.carriedGems = gems;
  return commit(data, ['exit']);
}

void test('retrying and switching levels preserve health instead of providing a free heal', () => {
  const damaged = damageOnce(newSession(102, 'health'));
  assert.equal(damaged.profile.health, 2);
  assert.equal(damaged.run.player.hp, 2);
  const retry = startLevel(damaged, 'level-001', 103, 'retry');
  assert.equal(retry.profile.health, 2);
  assert.equal(retry.run.player.hp, 2);
  assert.equal(retry.run.turn, 0);
  assert.deepEqual(retry.actions, []);
  assert.equal(isSessionData(retry), true);
  const escaped = escape(retry);
  const second = startLevel(escaped, 'level-002', 104, 'second');
  assert.equal(second.profile.health, 2);
  assert.equal(second.run.player.hp, 2);
  assert.equal(second.run.carriedGems, 0);
  assert.equal(second.run.killCount, 0);
  assert.equal(second.profile.bankedGems, 7);
  assert.equal(isSessionData(second), true);
});

void test('only successful escape unlocks the second level and settlement happens once', () => {
  const initial = newSession(42, 'settlement');
  assert.equal(isLevelUnlocked(initial, 'level-002'), false);
  assert.equal(isLevelUnlocked(initial, 'missing'), false);
  assert.throws(() => startLevel(initial, 'level-002', 43, 'locked'));
  initial.run.killCount = getLevel(initial.run.levelId).goal;
  initial.run.exitUnlocked = true;
  assert.equal(isLevelUnlocked(initial, 'level-002'), false);
  const escaped = escape(initial, 9);
  assert.equal(isLevelUnlocked(escaped, 'level-002'), true);
  assert.equal(escaped.profile.bankedGems, 9);
  assert.deepEqual(escaped.profile.settledRunIds, [initial.run.runId]);
  assert.deepEqual(escaped.profile.clearedLevelIds, ['level-001']);
  assert.equal(commitPath(escaped, ['exit']).ok, false);
  assert.equal(escaped.profile.bankedGems, 9);
  assert.equal(escaped.profile.settledRunIds.length, 1);
});

void test('death persists zero health, loses only carried loot, and cannot be bypassed by retry', () => {
  const data = newSession(51, 'death');
  data.profile.health = 1;
  data.run.player.hp = 1;
  data.profile.bankedGems = 8;
  data.run.carriedGems = 6;
  const dead = damageOnce(data);
  assert.equal(dead.run.status, 'dead');
  assert.equal(dead.profile.health, 0);
  assert.equal(dead.run.player.hp, 0);
  assert.equal(dead.run.carriedGems, 0);
  assert.equal(dead.profile.bankedGems, 8);
  assert.throws(() => startLevel(dead, 'level-001', 52, 'cannot-heal'));
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify(dead));
  const reloaded = new SessionStore(storage, () => newSession(53, 'unused'));
  assert.deepEqual(reloaded.data, dead);
  assert.equal(reloaded.data.profile.health, 0);
});

void test('save and reload restore board, health, RNG, progress and action history atomically', () => {
  const storage = new MemoryStorage();
  const store = new SessionStore(storage, () => newSession(73, 'saved'));
  const targets = TUTORIAL_CHAIN.map(
    (pos) => entityAt(store.data.run, pos)!.id,
  );
  const progressed = commit(store.data, targets);
  assert.equal(store.save(progressed), true);
  const reloaded = new SessionStore(storage, () =>
    newSession(999, 'discarded'),
  );
  assert.deepEqual(reloaded.data, progressed);
  assert.equal(reloaded.data.actions.length, 1);
  assert.equal(
    Object.values(reloaded.data.run.entities).some(
      (entity) => entity.kind === 'gem',
    ),
    true,
  );
  assert.equal(reloaded.notice, '');
  assert.equal(
    store.save(progressed),
    false,
    'the same revision cannot be applied again',
  );
});

void test('unreadable and structurally corrupt saves remain available for export', () => {
  for (const raw of [
    '{not json',
    JSON.stringify({ schemaVersion: 99 }),
    JSON.stringify({
      ...newSession(4, 'bad'),
      run: { ...newSession(4, 'bad').run, rng: null },
    }),
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, raw);
    const store = new SessionStore(storage, () => newSession(5, 'temporary'));
    assert.equal(store.export(), raw);
    assert.match(store.notice, /旧存档/);
    const target = entityAt(store.data.run, TUTORIAL_CHAIN[0])!.id;
    assert.equal(store.save(commit(store.data, [target])), true);
    assert.equal(storage.getItem(SAVE_KEY), raw);
    assert.equal(store.export(), raw);
  }
});

void test('validation rejects state that would corrupt rules or grant invalid health/progress', () => {
  const cases: ((data: SessionData) => void)[] = [
    (data) => {
      data.run.rng.board = Number.NaN;
    },
    (data) => {
      data.run.build.effects = [
        { type: 'block-creep-attack', effectId: 'shield', chargesPerRun: 1 },
      ];
    },
    (data) => {
      data.run.pendingDrops = [{ value: -1 }];
    },
    (data) => {
      data.profile.health = 2;
    },
    (data) => {
      data.run.status = 'dead';
    },
    (data) => {
      data.run.rulesVersion = 'unknown-future';
    },
    (data) => {
      data.run.nextEntityId = 1;
    },
    (data) => {
      data.run.turn = 1;
    },
    (data) => {
      const enemy = Object.values(data.run.entities)[0] as Creep;
      enemy.damage = -3;
    },
    (data) => {
      const enemy = Object.values(data.run.entities)[0] as Creep;
      enemy.attackActiveFromTurn = 10;
    },
    (data) => {
      delete data.run.entities[Object.keys(data.run.entities)[0]];
    },
  ];
  for (const mutate of cases) {
    const data = newSession(99, 'validate');
    mutate(data);
    assert.equal(isSessionData(data), false);
  }
  assert.equal(isSessionData(null), false);
  assert.equal(isSessionData([]), false);
  assert.equal(isSessionData(newSession(99, 'valid')), true);
});

void test('a second page cannot overwrite a newer revision or a replaced profile', () => {
  const storage = new MemoryStorage();
  const first = new SessionStore(storage, () => newSession(20, 'shared'));
  const second = new SessionStore(storage, () => newSession(21, 'unused'));
  const target = entityAt(first.data.run, TUTORIAL_CHAIN[0])!.id;
  const firstMove = commit(first.data, [target]);
  const secondMove = commit(second.data, [target]);
  assert.equal(first.save(firstMove), true);
  assert.equal(second.save(secondMove), false);
  assert.equal(second.data.revision, 0);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)!), firstMove);
  assert.match(second.notice, /另一个页面/);
  first.reset(newSession(22, 'replaced'));
  assert.equal(second.save(secondMove), false);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)!).profile.id, 'replaced');
});

void test('storage changed to malformed data is a conflict and is not overwritten', () => {
  const storage = new MemoryStorage();
  const store = new SessionStore(storage, () => newSession(31, 'changed'));
  const next = commit(store.data, [
    entityAt(store.data.run, TUTORIAL_CHAIN[0])!.id,
  ]);
  storage.setItem(SAVE_KEY, '{broken elsewhere');
  assert.equal(store.save(next), false);
  assert.equal(store.data.revision, 0);
  assert.equal(storage.getItem(SAVE_KEY), '{broken elsewhere');
});

void test('blocked browser storage and quota failure retain a playable exportable session', () => {
  const temporary = new SessionStore(null, () => newSession(32, 'temporary'));
  const next = commit(temporary.data, [
    entityAt(temporary.data.run, TUTORIAL_CHAIN[0])!.id,
  ]);
  assert.equal(temporary.save(next), true);
  assert.deepEqual(JSON.parse(temporary.export()), next);
  const storage = new MemoryStorage();
  const store = new SessionStore(storage, () => newSession(33, 'quota'));
  storage.writesFail = true;
  const progressed = commit(store.data, [
    entityAt(store.data.run, TUTORIAL_CHAIN[0])!.id,
  ]);
  assert.equal(store.save(progressed), true);
  assert.deepEqual(store.data, progressed);
  assert.match(store.notice, /导出存档/);
  assert.deepEqual(JSON.parse(store.export()), progressed);
});
