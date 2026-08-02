import { compareScores, evaluateHand, shuffleDeck, type Card } from "./holdem";

export const HOLDEM_STARTING_CHIPS = 1000;
export const HOLDEM_SMALL_BLIND = 10;
export const HOLDEM_BIG_BLIND = 20;

export type HoldemAction = "fold" | "check" | "call" | "raise" | "all-in";
export type HoldemDifficulty = "easy" | "normal" | "hard";

export type HoldemPlayer = {
  id: "hero" | "mungle" | "kong";
  name: string;
  emoji: string;
  style: string;
  cards: Card[];
  chips: number;
  folded: boolean;
  allIn: boolean;
  roundBet: number;
  contribution: number;
  acted: boolean;
  lastAction: string;
};

export type HoldemOutcome = {
  kind: "you-folded" | "you-won" | "you-lost" | "tie";
  title: string;
  detail: string;
  winnerIndexes: number[];
  payouts: number[];
} | null;

export type HoldemGameState = {
  players: HoldemPlayer[];
  community: Card[];
  street: 0 | 1 | 2 | 3 | 4;
  pot: number;
  currentBet: number;
  minRaise: number;
  turn: number;
  dealer: number;
  handNumber: number;
  sessionWins: number;
  bestHeroChips: number;
  complete: boolean;
  message: string;
  outcome: HoldemOutcome;
};

export type SidePot = { amount: number; eligibleIndexes: number[] };
export type AiMove = { action: HoldemAction; raiseTo?: number };

const playerTemplates = [
  { id: "hero" as const, emoji: "🙂", style: "나" },
  { id: "mungle" as const, emoji: "🐻", style: "신중형" },
  { id: "kong" as const, emoji: "🐰", style: "공격형" },
];

function nextSeat(
  from: number,
  players: HoldemPlayer[],
  predicate: (player: HoldemPlayer) => boolean,
) {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const index = (from + offset) % players.length;
    if (predicate(players[index])) return index;
  }
  return -1;
}

function basePlayers(displayName: string, previous?: HoldemPlayer[]) {
  return playerTemplates.map((template, index) => ({
    ...template,
    name: index === 0 ? displayName : index === 1 ? "몽글이" : "콩이",
    cards: [] as Card[],
    chips: previous?.[index]?.chips ?? HOLDEM_STARTING_CHIPS,
    folded: false,
    allIn: false,
    roundBet: 0,
    contribution: 0,
    acted: false,
    lastAction: "",
  }));
}

export function createHoldemGame(displayName: string): HoldemGameState {
  return {
    players: basePlayers(displayName),
    community: [],
    street: 0,
    pot: 0,
    currentBet: 0,
    minRaise: HOLDEM_BIG_BLIND,
    turn: -1,
    dealer: -1,
    handNumber: 0,
    sessionWins: 0,
    bestHeroChips: HOLDEM_STARTING_CHIPS,
    complete: true,
    message: "새 게임을 눌러 프리미엄 테이블에 앉아보세요.",
    outcome: null,
  };
}

function postBlind(player: HoldemPlayer, amount: number, label: string) {
  const paid = Math.min(player.chips, amount);
  player.chips -= paid;
  player.roundBet = paid;
  player.contribution = paid;
  player.allIn = player.chips === 0;
  player.lastAction = `${label} ${paid}`;
  return paid;
}

export function startHoldemHand(
  current: HoldemGameState,
  displayName: string,
  resetSession = false,
  suppliedDeck?: Card[],
): HoldemGameState {
  const heroNeedsReset = current.players[0]?.chips <= 0;
  const shouldReset = resetSession || heroNeedsReset || current.players.length !== 3;
  const previous = shouldReset ? undefined : current.players;
  const players = basePlayers(displayName, previous);

  // AI 좌석은 게임 흐름이 끊기지 않도록 파산 시 가상 칩으로 자동 재입장합니다.
  for (let index = 1; index < players.length; index += 1) {
    if (players[index].chips < HOLDEM_BIG_BLIND) {
      players[index].chips = HOLDEM_STARTING_CHIPS;
      players[index].lastAction = "리바이";
    }
  }

  const deck = suppliedDeck ? [...suppliedDeck] : shuffleDeck();
  players.forEach((player, index) => {
    player.cards = deck.slice(index * 2, index * 2 + 2);
  });
  const community = deck.slice(players.length * 2, players.length * 2 + 5);
  const dealer = nextSeat(
    shouldReset ? -1 : current.dealer,
    players,
    (player) => player.chips > 0,
  );
  const smallBlind = nextSeat(dealer, players, (player) => player.chips > 0);
  const bigBlind = nextSeat(smallBlind, players, (player) => player.chips > 0);
  const smallPaid = postBlind(players[smallBlind], HOLDEM_SMALL_BLIND, "SB");
  const bigPaid = postBlind(players[bigBlind], HOLDEM_BIG_BLIND, "BB");
  const turn = nextSeat(
    bigBlind,
    players,
    (player) => !player.folded && !player.allIn && player.chips > 0,
  );

  return {
    players,
    community,
    street: 0,
    pot: smallPaid + bigPaid,
    currentBet: Math.max(smallPaid, bigPaid),
    minRaise: HOLDEM_BIG_BLIND,
    turn,
    dealer,
    handNumber: (shouldReset ? 0 : current.handNumber) + 1,
    sessionWins: shouldReset ? 0 : current.sessionWins,
    bestHeroChips: shouldReset
      ? HOLDEM_STARTING_CHIPS
      : Math.max(current.bestHeroChips, players[0].chips),
    complete: false,
    message: `${players[turn]?.name ?? "플레이어"}의 차례입니다.`,
    outcome: null,
  };
}

export function visibleCommunityCount(street: HoldemGameState["street"]) {
  return street === 0 ? 0 : street === 1 ? 3 : street === 2 ? 4 : 5;
}

export function createSidePots(players: HoldemPlayer[]): SidePot[] {
  const levels = [...new Set(players.map((player) => player.contribution).filter(Boolean))]
    .sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let previousLevel = 0;

  for (const level of levels) {
    const contributors = players
      .map((player, index) => ({ player, index }))
      .filter(({ player }) => player.contribution >= level);
    const amount = (level - previousLevel) * contributors.length;
    if (amount > 0) {
      pots.push({
        amount,
        eligibleIndexes: contributors
          .filter(({ player }) => !player.folded)
          .map(({ index }) => index),
      });
    }
    previousLevel = level;
  }
  return pots;
}

export function settleShowdown(players: HoldemPlayer[], community: Card[]) {
  const nextPlayers = players.map((player) => ({ ...player }));
  const payouts = players.map(() => 0);
  const winnerIndexes = new Set<number>();
  let headlineHand = "";

  for (const pot of createSidePots(players)) {
    if (!pot.eligibleIndexes.length) continue;
    const scored = pot.eligibleIndexes.map((index) => ({
      index,
      hand: evaluateHand([...players[index].cards, ...community]),
    }));
    scored.sort((a, b) => compareScores(b.hand.score, a.hand.score));
    const winners = scored.filter(
      (entry) => compareScores(entry.hand.score, scored[0].hand.score) === 0,
    );
    headlineHand ||= scored[0].hand.name;
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    winners.forEach(({ index }) => {
      const award = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      payouts[index] += award;
      winnerIndexes.add(index);
    });
  }

  nextPlayers.forEach((player, index) => {
    player.chips += payouts[index];
  });
  return {
    players: nextPlayers,
    payouts,
    winnerIndexes: [...winnerIndexes],
    handName: headlineHand || "승부 완료",
  };
}

function finishUncontested(state: HoldemGameState, winnerIndex: number): HoldemGameState {
  const players = state.players.map((player, index) => ({
    ...player,
    chips: player.chips + (index === winnerIndex ? state.pot : 0),
  }));
  const heroWon = winnerIndex === 0;
  return {
    ...state,
    players,
    street: 4,
    turn: -1,
    complete: true,
    sessionWins: state.sessionWins + (heroWon ? 1 : 0),
    bestHeroChips: Math.max(state.bestHeroChips, players[0].chips),
    message: `${players[winnerIndex].name}이 마지막까지 남아 팟을 가져갑니다.`,
    outcome: {
      kind: heroWon ? "you-won" : "you-folded",
      title: heroWon ? "상대가 모두 폴드했습니다!" : `${players[winnerIndex].name}의 승리`,
      detail: `${state.pot.toLocaleString()}칩을 가져갔습니다.`,
      winnerIndexes: [winnerIndex],
      payouts: players.map((_, index) => (index === winnerIndex ? state.pot : 0)),
    },
  };
}

function finishShowdown(state: HoldemGameState): HoldemGameState {
  const settled = settleShowdown(state.players, state.community);
  const heroPayout = settled.payouts[0];
  const heroWon = heroPayout > 0;
  const shared = heroWon && settled.winnerIndexes.length > 1;
  const winnerNames = settled.winnerIndexes
    .map((index) => state.players[index].name)
    .join(", ");
  return {
    ...state,
    players: settled.players,
    street: 4,
    turn: -1,
    complete: true,
    sessionWins: state.sessionWins + (heroWon ? 1 : 0),
    bestHeroChips: Math.max(state.bestHeroChips, settled.players[0].chips),
    message: `${settled.handName}으로 쇼다운이 끝났습니다.`,
    outcome: {
      kind: state.players[0].folded
        ? "you-folded"
        : shared
          ? "tie"
          : heroWon
            ? "you-won"
            : "you-lost",
      title: state.players[0].folded
        ? `${winnerNames}의 승리`
        : shared
          ? "팟을 나눴습니다"
          : heroWon
            ? "멋진 승리입니다!"
            : `${winnerNames}의 승리`,
      detail: heroWon
        ? `${settled.handName} · ${heroPayout.toLocaleString()}칩 획득`
        : `${settled.handName} · 다음 판을 준비해 보세요.`,
      winnerIndexes: settled.winnerIndexes,
      payouts: settled.payouts,
    },
  };
}

function advanceStreet(state: HoldemGameState, players: HoldemPlayer[]): HoldemGameState {
  const street = (state.street + 1) as HoldemGameState["street"];
  const resetPlayers = players.map((player) => ({
    ...player,
    roundBet: 0,
    acted: player.folded || player.allIn,
    lastAction: player.folded ? "폴드" : player.allIn ? "올인" : "",
  }));
  const turn = nextSeat(
    state.dealer,
    resetPlayers,
    (player) => !player.folded && !player.allIn && player.chips > 0,
  );
  if (turn < 0) return finishShowdown({ ...state, players: resetPlayers });
  const label = ["", "플롭", "턴", "리버"][street];
  return {
    ...state,
    players: resetPlayers,
    street,
    currentBet: 0,
    minRaise: HOLDEM_BIG_BLIND,
    turn,
    message: `${label} 공개 · ${resetPlayers[turn].name}의 차례입니다.`,
  };
}

export function getRaiseBounds(state: HoldemGameState, index: number) {
  const player = state.players[index];
  if (!player) return { callAmount: 0, minRaiseTo: 0, maxRaiseTo: 0, canRaise: false };
  const callAmount = Math.max(
    0,
    Math.min(player.chips, state.currentBet - player.roundBet),
  );
  const maxRaiseTo = player.roundBet + player.chips;
  const minRaiseTo = Math.min(
    maxRaiseTo,
    state.currentBet + Math.max(HOLDEM_BIG_BLIND, state.minRaise),
  );
  return {
    callAmount,
    minRaiseTo,
    maxRaiseTo,
    canRaise: maxRaiseTo > state.currentBet,
  };
}

export function applyHoldemAction(
  state: HoldemGameState,
  index: number,
  action: HoldemAction,
  requestedRaiseTo?: number,
): HoldemGameState {
  if (state.complete || state.turn !== index) return state;
  const players = state.players.map((player) => ({ ...player }));
  const player = players[index];
  const { callAmount, minRaiseTo, maxRaiseTo } = getRaiseBounds(state, index);
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;

  if (action === "fold") {
    player.folded = true;
    player.acted = true;
    player.lastAction = "폴드";
  } else if (action === "check" && callAmount === 0) {
    player.acted = true;
    player.lastAction = "체크";
  } else if (action === "call" || (action === "check" && callAmount > 0)) {
    const paid = Math.min(player.chips, callAmount);
    player.chips -= paid;
    player.roundBet += paid;
    player.contribution += paid;
    player.allIn = player.chips === 0;
    player.acted = true;
    player.lastAction = player.allIn ? `올인 ${player.roundBet}` : `콜 ${paid}`;
  } else {
    const allInTarget = maxRaiseTo;
    const target = action === "all-in"
      ? allInTarget
      : Math.min(allInTarget, Math.max(minRaiseTo, requestedRaiseTo ?? minRaiseTo));
    if (target <= currentBet) {
      const paid = Math.min(player.chips, callAmount);
      player.chips -= paid;
      player.roundBet += paid;
      player.contribution += paid;
      player.allIn = player.chips === 0;
      player.acted = true;
      player.lastAction = player.allIn ? `올인 ${player.roundBet}` : `콜 ${paid}`;
    } else {
      const previousBet = currentBet;
      const paid = Math.min(player.chips, target - player.roundBet);
      player.chips -= paid;
      player.roundBet += paid;
      player.contribution += paid;
      player.allIn = player.chips === 0;
      currentBet = player.roundBet;
      const raiseSize = currentBet - previousBet;
      if (raiseSize >= minRaise) minRaise = raiseSize;
      players.forEach((other, otherIndex) => {
        other.acted =
          otherIndex === index || other.folded || other.allIn || other.chips === 0;
      });
      player.lastAction = player.allIn ? `올인 ${currentBet}` : `레이즈 ${currentBet}`;
    }
  }

  const pot = players.reduce((sum, current) => sum + current.contribution, 0);
  const liveIndexes = players
    .map((current, playerIndex) => ({ current, playerIndex }))
    .filter(({ current }) => !current.folded)
    .map(({ playerIndex }) => playerIndex);
  const nextState = { ...state, players, pot, currentBet, minRaise };

  if (liveIndexes.length === 1) return finishUncontested(nextState, liveIndexes[0]);

  const roundComplete = players.every(
    (current) =>
      current.folded ||
      current.allIn ||
      (current.acted && current.roundBet === currentBet),
  );
  if (roundComplete) {
    const actionable = players.filter(
      (current) => !current.folded && !current.allIn && current.chips > 0,
    );
    if (state.street >= 3 || actionable.length <= 1) return finishShowdown(nextState);
    return advanceStreet(nextState, players);
  }

  const turn = nextSeat(
    index,
    players,
    (current) => !current.folded && !current.allIn && current.chips > 0,
  );
  if (turn < 0) return finishShowdown(nextState);
  return {
    ...nextState,
    turn,
    message: `${players[turn].name}의 차례입니다.`,
  };
}

function preflopStrength(cards: Card[]) {
  if (cards.length < 2) return 0;
  const [first, second] = cards;
  const high = Math.max(first.rank, second.rank);
  const low = Math.min(first.rank, second.rank);
  let strength = (high + low) / 32;
  if (first.rank === second.rank) strength += 0.3 + high / 40;
  if (first.suit === second.suit) strength += 0.08;
  if (Math.abs(first.rank - second.rank) <= 2) strength += 0.07;
  if (high >= 13) strength += 0.08;
  return Math.min(1, strength);
}

export function estimateHandStrength(cards: Card[], community: Card[]) {
  if (community.length < 3) return preflopStrength(cards);
  const hand = evaluateHand([...cards, ...community]);
  const category = hand.score[0] / 8;
  const kickers = hand.score.slice(1).reduce((sum, rank, index) => {
    return sum + rank / (14 * Math.pow(10, index + 1));
  }, 0);
  return Math.min(1, category * 0.82 + kickers + 0.08);
}

export function chooseAiMove(
  state: HoldemGameState,
  index: number,
  difficulty: HoldemDifficulty,
  random = Math.random,
): AiMove {
  const player = state.players[index];
  const visible = state.community.slice(0, visibleCommunityCount(state.street));
  const baseStrength = estimateHandStrength(player.cards, visible);
  const personality = player.id === "kong" ? 0.12 : -0.05;
  const noise = difficulty === "hard" ? 0.08 : difficulty === "easy" ? 0.28 : 0.16;
  const strength = Math.max(
    0,
    Math.min(1, baseStrength + personality + (random() - 0.5) * noise),
  );
  const { callAmount, minRaiseTo, maxRaiseTo, canRaise } = getRaiseBounds(state, index);
  const pressure = callAmount / Math.max(HOLDEM_BIG_BLIND, state.pot + callAmount);
  const bluff = random() < (player.id === "kong" ? 0.13 : 0.05);

  if (callAmount > 0 && !bluff && strength < 0.31 + pressure * 0.7) {
    return { action: "fold" };
  }
  if (player.chips <= callAmount) return { action: "call" };
  if (canRaise && (strength > 0.7 || bluff)) {
    const potRaise = state.currentBet + Math.max(state.minRaise, Math.round(state.pot * 0.55));
    const raiseTo = Math.min(maxRaiseTo, Math.max(minRaiseTo, potRaise));
    if (strength > 0.9 && maxRaiseTo <= state.pot * 1.4) return { action: "all-in" };
    return { action: "raise", raiseTo };
  }
  return callAmount > 0 ? { action: "call" } : { action: "check" };
}
