import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const { createDeck } = await import("../lib/holdem.ts");
const {
  applyHoldemAction,
  chooseAiMove,
  createHoldemGame,
  createSidePots,
  getRaiseBounds,
  startHoldemHand,
} = await import("../lib/holdem-game.ts");

const totalChips = (game) =>
  game.players.reduce((sum, player) => sum + player.chips, 0) + game.pot;

test("새 판은 딜러와 블라인드를 배치하고 전체 칩을 보존한다", () => {
  const game = startHoldemHand(createHoldemGame("양승민"), "양승민", false, createDeck());

  assert.equal(game.dealer, 0);
  assert.equal(game.players[1].roundBet, 10);
  assert.equal(game.players[2].roundBet, 20);
  assert.equal(game.turn, 0);
  assert.equal(game.pot, 30);
  assert.equal(totalChips(game), 3000);
});

test("프리플롭 콜이 끝나면 플롭으로 넘어가고 베팅이 초기화된다", () => {
  let game = startHoldemHand(createHoldemGame("양승민"), "양승민", false, createDeck());
  game = applyHoldemAction(game, 0, "call");
  game = applyHoldemAction(game, 1, "call");
  game = applyHoldemAction(game, 2, "check");

  assert.equal(game.street, 1);
  assert.equal(game.pot, 60);
  assert.equal(game.currentBet, 0);
  assert.deepEqual(game.players.map((player) => player.roundBet), [0, 0, 0]);
  assert.equal(game.turn, 1);
  assert.equal(totalChips(game), 3000);
});

test("서로 다른 올인 금액은 메인 팟과 사이드 팟으로 정확히 분리된다", () => {
  const game = createHoldemGame("양승민");
  const players = game.players.map((player, index) => ({
    ...player,
    contribution: [100, 300, 300][index],
    folded: index === 2,
  }));

  assert.deepEqual(createSidePots(players), [
    { amount: 300, eligibleIndexes: [0, 1] },
    { amount: 400, eligibleIndexes: [1] },
  ]);
});

test("레이즈 범위와 AI 행동은 현재 팟과 보유 칩 안에서만 결정된다", () => {
  const game = startHoldemHand(createHoldemGame("양승민"), "양승민", false, createDeck());
  const bounds = getRaiseBounds(game, 0);
  const move = chooseAiMove({ ...game, turn: 1 }, 1, "hard", () => 0.5);

  assert.equal(bounds.callAmount, 20);
  assert.equal(bounds.minRaiseTo, 40);
  assert.equal(bounds.maxRaiseTo, 1000);
  assert.ok(["fold", "call", "raise", "all-in"].includes(move.action));
  if (move.raiseTo != null) {
    assert.ok(move.raiseTo >= getRaiseBounds(game, 1).minRaiseTo);
    assert.ok(move.raiseTo <= getRaiseBounds(game, 1).maxRaiseTo);
  }
});

test("프리미엄 화면에 난이도, 베팅 조절, 올인, 연속 칩 기능이 노출된다", async () => {
  const source = await readFile(new URL("../app/holdem-lounge.tsx", import.meta.url), "utf8");

  for (const label of [
    "위즈업 프리미엄 홀덤",
    "편안하게",
    "진지하게",
    "레이즈 금액",
    "올인",
    "현재 칩",
    "칩 유지",
    "사이드 팟",
  ]) {
    assert.match(source, new RegExp(label));
  }
});
