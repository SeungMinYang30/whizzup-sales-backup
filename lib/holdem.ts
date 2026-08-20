export type Suit = "♠" | "♥" | "♦" | "♣";
export type Card = { rank: number; suit: Suit };

export const rankLabel = (rank: number) =>
  rank === 14 ? "A" : rank === 13 ? "K" : rank === 12 ? "Q" : rank === 11 ? "J" : String(rank);

export function createDeck(): Card[] {
  return (["♠", "♥", "♦", "♣"] as Suit[]).flatMap((suit) =>
    Array.from({ length: 13 }, (_, index) => ({ suit, rank: index + 2 })),
  );
}

export function shuffleDeck(deck = createDeck()): Card[] {
  const next = [...deck];
  const random = new Uint32Array(next.length);
  crypto.getRandomValues(random);
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = random[index] % (index + 1);
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

type HandScore = { score: number[]; name: string };

function evaluateFive(cards: Card[]): HandScore {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(ranks)];
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique[index] - unique[index + 4] === 4) {
      straightHigh = unique[index];
      break;
    }
  }
  const flush = cards.every((card) => card.suit === cards[0].suit);
  if (flush && straightHigh) return { score: [8, straightHigh], name: "스트레이트 플러시" };
  if (groups[0][1] === 4) return { score: [7, groups[0][0], groups[1][0]], name: "포카드" };
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return { score: [6, groups[0][0], groups[1][0]], name: "풀하우스" };
  if (flush) return { score: [5, ...ranks], name: "플러시" };
  if (straightHigh) return { score: [4, straightHigh], name: "스트레이트" };
  if (groups[0][1] === 3) return { score: [3, groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)], name: "트리플" };
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = groups.filter(([, count]) => count === 2).map(([rank]) => rank).sort((a, b) => b - a);
    const kicker = groups.find(([, count]) => count === 1)?.[0] ?? 0;
    return { score: [2, ...pairs, kicker], name: "투 페어" };
  }
  if (groups[0][1] === 2) return { score: [1, groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)], name: "원 페어" };
  return { score: [0, ...ranks], name: "하이 카드" };
}

export function compareScores(a: number[], b: number[]) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

export function evaluateHand(cards: Card[]): HandScore {
  let best: HandScore | null = null;
  for (let a = 0; a < cards.length - 4; a += 1)
    for (let b = a + 1; b < cards.length - 3; b += 1)
      for (let c = b + 1; c < cards.length - 2; c += 1)
        for (let d = c + 1; d < cards.length - 1; d += 1)
          for (let e = d + 1; e < cards.length; e += 1) {
            const candidate = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareScores(candidate.score, best.score) > 0) best = candidate;
          }
  return best ?? { score: [0], name: "하이 카드" };
}
