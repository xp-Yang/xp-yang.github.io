import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEVELS,
  TUTORIAL_CHAIN,
  attackCells,
  createRun,
  entityAt,
  getLevel,
  inspectPath,
  legalTargets,
  previewTurn,
  resolveTurn,
  rewardForKills,
  settleBoard,
  type ColorId,
  type Creep,
  type GameEvent,
  type RunState,
} from '../demos/chain-game/src/core/index';

function creep(
  id: string,
  x: number,
  y: number,
  color: ColorId = 'blue',
  angry = false,
  damage = 1,
): Creep {
  return {
    id,
    kind: 'creep',
    pos: { x, y },
    color,
    archetypeId: 'basic',
    bornTurn: 0,
    mood: angry ? 'angry' : 'calm',
    attackActiveFromTurn: angry ? 1 : null,
    damage,
  };
}

function fixture(): RunState {
  const state = createRun('level-001', 123);
  state.player.pos = { x: 0, y: 3 };
  state.entities = {};
  return state;
}

function commit(state: RunState, targets: readonly string[]) {
  const result = resolveTurn(state, {
    runId: state.runId,
    revision: state.revision,
    targets,
  });
  assert.ok(result.ok, result.ok ? undefined : result.error);
  return result;
}

void test('two configured levels use rows × columns; new runs carry provided health', () => {
  assert.equal(LEVELS.length, 2);
  const first = createRun('level-001', 4, 2);
  const second = createRun('level-002', 4, first.player.hp);
  assert.deepEqual(
    [getLevel(first.levelId).height, getLevel(first.levelId).width],
    [6, 5],
  );
  assert.deepEqual(
    [getLevel(second.levelId).height, getLevel(second.levelId).width],
    [7, 7],
  );
  assert.equal(Object.keys(first.entities).length, 29);
  assert.equal(Object.keys(second.entities).length, 48);
  assert.equal(second.player.hp, 2);
  assert.equal(createRun('level-001', 5, 0).status, 'dead');
  assert.equal(createRun('level-001', 5, 0).player.hp, 0);
  assert.equal(getLevel('level-002').unlockAfter, 'level-001');
});

void test('tutorial has a reachable 10-kill opening and its reward stays on the board', () => {
  const state = createRun('level-001', 9);
  const path = TUTORIAL_CHAIN.map((pos) => entityAt(state, pos)!.id);
  assert.equal(inspectPath(state, path).kills, 10);
  const result = commit(state, path);
  assert.equal(result.state.killCount, 10);
  assert.equal(result.preview.rewardValue, 1);
  assert.equal(result.state.carriedGems, 0);
  const gems = Object.values(result.state.entities).filter(
    (entity) => entity.kind === 'gem',
  );
  assert.equal(gems.length, 1);
  assert.deepEqual(gems[0].pos, TUTORIAL_CHAIN[0]);
  assert.equal(Object.keys(result.state.entities).length, 29);
});

void test('path validates adjacency, duplicates and colors, and gems permit a new color', () => {
  const state = fixture();
  state.entities = {
    b: creep('b', 1, 3),
    g: creep('g', 3, 3, 'green'),
    p: creep('p', 4, 4, 'purple'),
    gem: { id: 'gem', kind: 'gem', pos: { x: 2, y: 3 }, bornTurn: 0, value: 3 },
    gem2: {
      id: 'gem2',
      kind: 'gem',
      pos: { x: 2, y: 4 },
      bornTurn: 0,
      value: 2,
    },
  };
  assert.equal(inspectPath(state, []).valid, false);
  assert.equal(inspectPath(state, ['g']).valid, false);
  assert.equal(inspectPath(state, ['constructor']).valid, false);
  assert.equal(inspectPath(state, ['toString']).valid, false);
  assert.equal(inspectPath(state, ['b', 'b']).valid, false);
  assert.equal(inspectPath(state, ['b', 'gem', 'g']).valid, true);
  assert.equal(inspectPath(state, ['b', 'gem', 'g', 'p']).valid, false);
  const path = inspectPath(state, ['b', 'gem', 'gem2', 'g']);
  assert.equal(path.valid, true);
  assert.equal(path.kills, 2);
  assert.equal(path.collectedGems, 5);
  assert.equal(path.color, 'green');
  assert.equal(inspectPath(state, ['b', 'gem']).color, null);
  assert.deepEqual(legalTargets(state), ['b']);
});

void test('preview is authoritative, deterministic, and never mutates the live state', () => {
  const state = createRun('level-001', 13);
  const targets = TUTORIAL_CHAIN.map((pos) => entityAt(state, pos)!.id);
  const before = JSON.stringify(state);
  const preview = previewTurn(state, targets);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(previewTurn(state, targets), preview);
  const result = commit(state, targets);
  assert.deepEqual(result.preview, preview);
  assert.equal(JSON.stringify(state), before);
  assert.equal(result.state.turn, 1);
  assert.equal(result.state.revision, 1);
  assert.deepEqual(commit(state, targets), result);
  assert.equal(
    resolveTurn(result.state, { runId: state.runId, revision: 0, targets }).ok,
    false,
  );
  assert.equal(
    resolveTurn(state, { runId: 'stale', revision: 0, targets }).ok,
    false,
  );
});

void test('surviving angry cardinal neighbors each attack; diagonal and killed enemies do not', () => {
  const state = fixture();
  state.player.pos = { x: 0, y: 2 };
  state.entities = {
    target: creep('target', 1, 2, 'blue', true),
    north: creep('north', 1, 1, 'green', true),
    east: creep('east', 2, 2, 'green', true),
    diagonal: creep('diagonal', 2, 1, 'purple', true),
  };
  const result = commit(state, ['target']);
  assert.equal(result.preview.damage, 2);
  assert.deepEqual(result.preview.attackers, ['east', 'north']);
  assert.equal(result.state.player.hp, 1);
  assert.equal(result.state.status, 'playing');
  assert.ok(attackCells(state).some((pos) => pos.x === 1 && pos.y === 2));
});

void test('shield blocks one strongest attack once; preview does not consume its charge', () => {
  const state = fixture();
  state.player.pos = { x: 0, y: 2 };
  state.build.effects = [
    { type: 'block-creep-attack', effectId: 'shield', chargesPerRun: 1 },
  ];
  state.equipmentRuntime = { shield: { remainingCharges: 1 } };
  state.entities = {
    target: creep('target', 1, 2),
    north: creep('north', 1, 1, 'green', true, 2),
    east: creep('east', 2, 2, 'green', true),
  };
  const preview = previewTurn(state, ['target']);
  assert.equal(preview.blocked, 1);
  assert.equal(preview.damage, 1);
  assert.equal(state.equipmentRuntime.shield.remainingCharges, 1);
  const result = commit(state, ['target']);
  assert.deepEqual(result.preview, preview);
  assert.equal(result.state.equipmentRuntime.shield.remainingCharges, 0);
  assert.equal(result.state.player.hp, 2);
});

void test('lethal attacks lose carried and pending loot, without advancing the board', () => {
  const state = fixture();
  state.player.pos = { x: 0, y: 2 };
  state.player.hp = 1;
  state.carriedGems = 7;
  state.pendingDrops = [{ value: 2 }];
  state.entities = {
    target: creep('target', 1, 2),
    enemy: creep('enemy', 2, 2, 'green', true),
  };
  const result = commit(state, ['target']);
  assert.equal(result.state.status, 'dead');
  assert.equal(result.state.player.hp, 0);
  assert.equal(result.state.carriedGems, 0);
  assert.deepEqual(result.state.pendingDrops, []);
  assert.equal(result.state.turn, 1);
  assert.equal(result.state.revision, 1);
  assert.equal(
    result.events.some((event) => event.type === 'creep-spawned'),
    false,
  );
  assert.equal(inspectPath(result.state, ['enemy']).valid, false);
});

void test('an already-open exit ends the run before attacks; opening it cannot exit in the same action', () => {
  const state = fixture();
  state.player.pos = { x: 2, y: 0 };
  state.exitUnlocked = true;
  state.carriedGems = 4;
  state.entities = { angry: creep('angry', 2, 1, 'green', true) };
  const result = commit(state, ['exit']);
  assert.equal(result.state.status, 'escaped');
  assert.equal(result.state.carriedGems, 4);
  assert.equal(result.preview.damage, 0);
  assert.equal(result.state.player.hp, 3);
  assert.equal(inspectPath(state, ['exit', 'angry']).valid, false);
  state.exitUnlocked = false;
  state.killCount = 19;
  state.player.pos = { x: 0, y: 0 };
  state.entities = { last: creep('last', 1, 0) };
  assert.equal(inspectPath(state, ['last', 'exit']).valid, false);
  const opened = commit(state, ['last']);
  assert.equal(opened.state.exitUnlocked, true);
  assert.equal(opened.state.status, 'playing');
  assert.equal(
    opened.events.some((event) => event.type === 'creep-enraged'),
    false,
  );
  const after = commit(opened.state, [legalTargets(opened.state)[0]]);
  const angry = Object.values(after.state.entities).filter(
    (entity) => entity.kind === 'creep' && entity.mood === 'angry',
  );
  assert.equal(angry.length, 1);
  assert.equal(angry[0].kind === 'creep' && angry[0].attackActiveFromTurn, 3);
});

void test('level two enrages from action six, excludes newly born enemies and grants next-turn grace', () => {
  const state = createRun('level-002', 92);
  state.turn = 4;
  const five = commit(state, [legalTargets(state)[0]]);
  assert.equal(
    five.events.some((event) => event.type === 'creep-enraged'),
    false,
  );
  const six = commit(five.state, [legalTargets(five.state)[0]]);
  const event = six.events.find((event) => event.type === 'creep-enraged');
  assert.ok(event?.type === 'creep-enraged');
  assert.equal(event.activeFromTurn, 7);
  const enemy = six.state.entities[event.entityId];
  assert.ok(enemy.bornTurn < 6);
  assert.equal(six.preview.damage, 0);
});

void test('gravity preserves enemy identity and rage while respecting fixed gems and player cells', () => {
  const state = fixture();
  state.player.pos = { x: 4, y: 5 };
  state.entities = {
    upper: creep('upper', 0, 0, 'green', true),
    lower: creep('lower', 0, 4),
    gem: { id: 'gem', kind: 'gem', pos: { x: 0, y: 3 }, value: 2, bornTurn: 0 },
    playerColumn: creep('playerColumn', 4, 0),
  };
  const events: GameEvent[] = [];
  settleBoard(state, 1, events);
  assert.deepEqual(state.entities.upper.pos, { x: 0, y: 2 });
  assert.deepEqual(state.entities.lower.pos, { x: 0, y: 5 });
  assert.deepEqual(state.entities.gem.pos, { x: 0, y: 3 });
  assert.deepEqual(state.entities.playerColumn.pos, { x: 4, y: 4 });
  assert.equal(
    state.entities.upper.kind === 'creep' && state.entities.upper.mood,
    'angry',
  );
  assert.equal(entityAt(state, state.player.pos), undefined);
  const occupied = Object.values(state.entities).map(
    (entity) => `${entity.pos.x},${entity.pos.y}`,
  );
  assert.equal(new Set(occupied).size, 29);
  assert.equal(occupied.length, 29);
});

void test('reward thresholds count actual kills, and a build bonus is applied once to a new gem', () => {
  assert.deepEqual(
    [0, 1, 9, 10, 14, 15, 19, 20, 24, 25, 40].map(rewardForKills),
    [0, 0, 0, 1, 1, 2, 2, 3, 3, 5, 5],
  );
  const state = createRun('level-001', 7, 3, 'bonus', {
    catalogVersion: 'test',
    effects: [
      {
        type: 'chain-reward-flat-bonus',
        effectId: 'chain',
        minKills: 10,
        bonusValue: 2,
      },
    ],
  });
  const targets = TUTORIAL_CHAIN.map((pos) => entityAt(state, pos)!.id);
  const result = commit(state, targets);
  assert.equal(result.preview.rewardValue, 3);
  const gem = Object.values(result.state.entities).find(
    (entity) => entity.kind === 'gem',
  );
  assert.ok(gem?.kind === 'gem');
  assert.equal(gem.value, 3);
});

void test('same seed and accepted actions reproduce every state and keep occupancy valid', () => {
  let left = createRun('level-002', 9128);
  let right = createRun('level-002', 9128);
  assert.deepEqual(left, right);
  assert.notDeepEqual(left.entities, createRun('level-002', 9999).entities);
  for (let index = 0; index < 16 && left.status === 'playing'; index += 1) {
    const options = legalTargets(left).filter((target) => target !== 'exit');
    const target =
      options.find((id) => previewTurn(left, [id]).damage === 0) ?? options[0];
    assert.ok(target);
    left = commit(left, [target]).state;
    right = commit(right, [target]).state;
    assert.deepEqual(left, right);
    const positions = Object.values(left.entities).map(
      (entity) => `${entity.pos.x},${entity.pos.y}`,
    );
    assert.equal(new Set(positions).size, positions.length);
    assert.equal(entityAt(left, left.player.pos), undefined);
  }
});
