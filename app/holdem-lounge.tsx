"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, compareScores, evaluateHand, rankLabel, shuffleDeck } from "../lib/holdem";

type Player = { name: string; emoji: string; cards: Card[]; chips: number; folded: boolean };
type RankRow = { memberId: number; displayName: string; bestChips: number; gamesPlayed: number; wins: number };
type Outcome = { kind: "you-folded" | "you-won" | "you-lost" | "tie"; title: string; detail: string; winnerIndexes: number[] } | null;
type GameAction = "fold" | "check" | "call" | "raise";
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const RAISE_SIZE = 40;

function findNextActive(from: number, source: Player[]) {
  for (let offset = 1; offset <= source.length; offset += 1) {
    const index = (from + offset) % source.length;
    if (!source[index].folded && source[index].chips > 0) return index;
  }
  return -1;
}

function PlayingCard({ card, hidden = false }: { card?: Card; hidden?: boolean }) {
  if (!card || hidden) return <span className="poker-card card-back" aria-label="숨긴 카드">W</span>;
  const red = card.suit === "♥" || card.suit === "♦";
  return <span className={`poker-card ${red ? "red" : ""}`} aria-label={`${rankLabel(card.rank)} ${card.suit}`}><b>{rankLabel(card.rank)}</b><i>{card.suit}</i></span>;
}

export default function HoldemLounge({ displayName }: { displayName: string }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [community, setCommunity] = useState<Card[]>([]);
  const [street, setStreet] = useState(0);
  const [pot, setPot] = useState(0);
  const [turn, setTurn] = useState(-1);
  const [roundBets, setRoundBets] = useState([0, 0, 0]);
  const [currentBet, setCurrentBet] = useState(0);
  const [acted, setActed] = useState([false, false, false]);
  const [lastActions, setLastActions] = useState(["", "", ""]);
  const [message, setMessage] = useState("새 게임을 눌러 테이블에 앉아보세요.");
  const [complete, setComplete] = useState(true);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [leaderboard, setLeaderboard] = useState<RankRow[]>([]);
  const [memberId, setMemberId] = useState(0);
  const aiTimer = useRef<number | null>(null);

  const loadLeaderboard = useCallback(async () => {
    const response = await fetch("/api/holdem", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { memberId: number; leaderboard: RankRow[] };
    setMemberId(data.memberId); setLeaderboard(data.leaderboard);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadLeaderboard(), 0); return () => window.clearTimeout(timer); }, [loadLeaderboard]);
  useEffect(() => () => { if (aiTimer.current) window.clearTimeout(aiTimer.current); }, []);

  const visibleCommunity = street === 0 ? 0 : street === 1 ? 3 : street === 2 ? 4 : 5;
  const streetName = ["프리플롭", "플롭", "턴", "리버", "쇼다운"][street] ?? "";
  const myHand = useMemo(() => players[0] && visibleCommunity >= 3 ? evaluateHand([...players[0].cards, ...community.slice(0, visibleCommunity)]).name : "", [players, community, visibleCommunity]);
  const callAmount = players[0] ? Math.max(0, Math.min(players[0].chips, currentBet - roundBets[0])) : 0;

  function newGame() {
    if (aiTimer.current) window.clearTimeout(aiTimer.current);
    const deck = shuffleDeck();
    setPlayers([
      { name: displayName, emoji: "🙂", cards: deck.slice(0, 2), chips: STARTING_CHIPS, folded: false },
      { name: "몽글이", emoji: "🐻", cards: deck.slice(2, 4), chips: STARTING_CHIPS - SMALL_BLIND, folded: false },
      { name: "콩이", emoji: "🐰", cards: deck.slice(4, 6), chips: STARTING_CHIPS - BIG_BLIND, folded: false },
    ]);
    setCommunity(deck.slice(6, 11)); setStreet(0); setPot(SMALL_BLIND + BIG_BLIND);
    setRoundBets([0, SMALL_BLIND, BIG_BLIND]); setCurrentBet(BIG_BLIND); setActed([false, false, false]);
    setLastActions(["내 차례", `스몰 블라인드 ${SMALL_BLIND}`, `빅 블라인드 ${BIG_BLIND}`]);
    setTurn(0); setComplete(false); setOutcome(null);
    setMessage("프리플롭 · 내 차례입니다. 콜, 레이즈 또는 폴드를 선택하세요.");
  }

  const recordResult = useCallback(async (settled: Player[], didWin: boolean) => {
    const response = await fetch("/api/holdem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chips: settled[0].chips, won: didWin }) });
    if (response.ok) { const data = await response.json() as { memberId: number; leaderboard: RankRow[] }; setMemberId(data.memberId); setLeaderboard(data.leaderboard); }
  }, []);

  const finish = useCallback((source: Player[], finalPot: number) => {
    const active = source.map((player, index) => ({ player, index })).filter(({ player }) => !player.folded);
    const scored = active.map((entry) => ({ ...entry, hand: evaluateHand([...entry.player.cards, ...community]) }));
    scored.sort((a, b) => compareScores(b.hand.score, a.hand.score));
    const winners = scored.filter((entry) => compareScores(entry.hand.score, scored[0].hand.score) === 0);
    const winnerIndexes = winners.map((winner) => winner.index);
    const iWon = winnerIndexes.includes(0); const tied = winners.length > 1;
    const share = Math.floor(finalPot / winners.length);
    const settled = source.map((player, index) => winnerIndexes.includes(index) ? { ...player, chips: player.chips + share } : player);
    setPlayers(settled); setStreet(4); setTurn(-1); setComplete(true);
    setOutcome({ kind: tied && iWon ? "tie" : iWon ? "you-won" : source[0].folded ? "you-folded" : "you-lost", title: source[0].folded ? "나는 폴드했어요" : tied && iWon ? "무승부예요! 🤝" : iWon ? "내가 이겼어요! 🎉" : `${winners.map(({ player }) => player.name).join(", ")}의 승리예요`, detail: source[0].folded ? "이번 판에서는 카드를 내려놓았습니다. 다음 판을 시작해 보세요." : `${scored[0].hand.name} · ${iWon ? "팟을 가져왔습니다!" : "다음 판에 다시 도전해 보세요."}`, winnerIndexes });
    setMessage(source[0].folded ? "내가 폴드하여 이번 판에서 빠졌습니다." : `${scored[0].hand.name}으로 승부가 결정됐습니다.`);
    void recordResult(settled, iWon);
  }, [community, recordResult]);

  const applyAction = useCallback((index: number, action: GameAction) => {
    if (complete || index !== turn) return;
    const nextPlayers = players.map((player) => ({ ...player }));
    const nextBets = [...roundBets]; let nextActed = [...acted]; const nextActions = [...lastActions];
    let nextCurrentBet = currentBet; let nextPot = pot;
    if (action === "fold") { nextPlayers[index].folded = true; nextActed[index] = true; nextActions[index] = "폴드"; }
    else {
      let target = action === "raise" ? currentBet + RAISE_SIZE : currentBet;
      if (action === "check") target = nextBets[index];
      const payment = Math.max(0, Math.min(nextPlayers[index].chips, target - nextBets[index]));
      nextPlayers[index].chips -= payment; nextBets[index] += payment; nextPot += payment;
      if (action === "raise" && nextBets[index] > currentBet) { nextCurrentBet = nextBets[index]; nextActed = nextActed.map((_, playerIndex) => playerIndex === index || nextPlayers[playerIndex].folded); }
      nextActed[index] = true;
      nextActions[index] = action === "raise" ? `레이즈 ${nextBets[index]}` : payment > 0 ? `콜 ${payment}` : "체크";
    }
    setPlayers(nextPlayers); setRoundBets(nextBets); setCurrentBet(nextCurrentBet); setPot(nextPot); setActed(nextActed); setLastActions(nextActions);
    const active = nextPlayers.map((player, playerIndex) => ({ player, playerIndex })).filter(({ player }) => !player.folded);
    if (active.length === 1) { finish(nextPlayers, nextPot); return; }
    const roundDone = active.every(({ playerIndex, player }) => nextActed[playerIndex] && (nextBets[playerIndex] === nextCurrentBet || player.chips === 0));
    if (roundDone) {
      if (street >= 3) { finish(nextPlayers, nextPot); return; }
      const nextStreet = street + 1; const starter = findNextActive(0, nextPlayers);
      setStreet(nextStreet); setRoundBets([0, 0, 0]); setCurrentBet(0); setActed(nextPlayers.map((player) => player.folded || player.chips === 0));
      setLastActions(["", "", ""]); setTurn(starter);
      setMessage(`${["", "플롭", "턴", "리버"][nextStreet]} 공개 · ${nextPlayers[starter].name}의 차례입니다.`); return;
    }
    const nextTurn = findNextActive(index, nextPlayers); setTurn(nextTurn);
    setMessage(`${nextPlayers[nextTurn].name}의 차례입니다. ${nextTurn === 0 ? "행동을 선택하세요." : "AI가 생각하고 있습니다…"}`);
  }, [acted, complete, currentBet, finish, lastActions, players, pot, roundBets, street, turn]);

  useEffect(() => {
    if (complete || turn <= 0 || !players[turn]) return;
    aiTimer.current = window.setTimeout(() => {
      const owed = currentBet - roundBets[turn];
      const strength = visibleCommunity >= 3 ? evaluateHand([...players[turn].cards, ...community.slice(0, visibleCommunity)]).score[0] : 0;
      const roll = Math.random();
      const action: GameAction = owed > 0 && strength === 0 && roll < .18 ? "fold" : strength >= 2 && roll > .55 && players[turn].chips > owed + RAISE_SIZE ? "raise" : owed > 0 ? "call" : strength >= 1 && roll > .72 ? "raise" : "check";
      applyAction(turn, action);
    }, players[0]?.folded ? 1550 : 1100);
    return () => { if (aiTimer.current) window.clearTimeout(aiTimer.current); };
  }, [applyAction, community, complete, currentBet, players, roundBets, turn, visibleCommunity]);

  return <section className="holdem-layout">
    <article className="holdem-game panel">
      <div className="holdem-intro"><div><span className="section-kicker">WHIZZUP BREAK ROOM</span><h2>포근포근 홀덤 테이블</h2><p>한 명씩 차례대로 행동하는 3인 텍사스 홀덤입니다.</p></div><span>가상 칩 전용 · 현금 가치 없음</span></div>
      <div className="holdem-round-bar"><b>{streetName}</b><span>{turn >= 0 ? `${players[turn]?.name} 차례` : "판 종료"}</span><small>현재 베팅 {currentBet}칩</small></div>
      {players[0]?.folded && !complete && <div className="holdem-spectating" role="status"><span>👀</span><div><strong>나는 폴드 · 관전 중</strong><small>몽글이와 콩이의 남은 베팅을 천천히 진행하고 있습니다.</small></div></div>}
      <div className="poker-table">
        {players.slice(1).map((player, index) => { const seat = index + 1; return <div className={`poker-seat ai-seat ai-${index} ${turn === seat ? "seat-turn" : ""} ${player.folded ? "seat-folded" : ""} ${outcome?.winnerIndexes.includes(seat) ? "seat-winner" : ""}`} key={player.name}>{turn === seat && <b className="seat-state turn">생각 중…</b>}{player.folded && <b className="seat-state folded">폴드</b>}{outcome?.winnerIndexes.includes(seat) && <b className="seat-state winner">승리</b>}<span>{player.emoji}</span><strong>{player.name}</strong><small>{player.chips.toLocaleString()}칩 · 판돈 {roundBets[seat]}</small><div><PlayingCard card={player.cards[0]} hidden={!complete}/><PlayingCard card={player.cards[1]} hidden={!complete}/></div>{lastActions[seat] && <em className="action-bubble">{lastActions[seat]}</em>}</div>; })}
        <div className="poker-center"><div className="poker-pot-zone"><div className="poker-chip-stack" aria-hidden="true"><i/><i/><i/><i/></div><span className="pot-chip">POT {pot.toLocaleString()}칩</span></div><div className="community-cards">{Array.from({ length: 5 }, (_, index) => <PlayingCard key={index} card={community[index]} hidden={index >= visibleCommunity}/>)}</div><p>{message}</p></div>
        <div className={`poker-seat my-seat ${turn === 0 ? "seat-turn" : ""} ${players[0]?.folded ? "seat-folded" : ""} ${outcome?.winnerIndexes.includes(0) ? "seat-winner" : ""}`}>{turn === 0 && <b className="seat-state turn">내 차례</b>}{players[0]?.folded && <b className="seat-state folded">폴드 · 이번 판 종료</b>}{outcome?.winnerIndexes.includes(0) && <b className="seat-state winner">내 승리</b>}<span>🙂</span><strong>{displayName} <u>나</u></strong><small>{(players[0]?.chips ?? STARTING_CHIPS).toLocaleString()}칩 · 판돈 {roundBets[0]}</small><div><PlayingCard card={players[0]?.cards[0]}/><PlayingCard card={players[0]?.cards[1]}/></div>{myHand && <em>{myHand}</em>}{lastActions[0] && <em className="action-bubble">{lastActions[0]}</em>}</div>
      </div>
      {outcome && <div className={`holdem-outcome holdem-outcome-below ${outcome.kind}`} role="status" aria-live="polite"><strong>{outcome.title}</strong><span>{outcome.detail} 위 카드에서 결과를 비교해 보세요.</span></div>}
      <div className="holdem-actions">{complete ? <button className="holdem-new" onClick={newGame}>새 게임 시작</button> : turn === 0 ? <><button className="holdem-fold" onClick={() => applyAction(0, "fold")}>폴드</button>{callAmount === 0 ? <button onClick={() => applyAction(0, "check")}>체크</button> : <button onClick={() => applyAction(0, "call")}>콜 · {callAmount}</button>}<button className="holdem-raise" onClick={() => applyAction(0, "raise")}>레이즈 · {currentBet + RAISE_SIZE}</button></> : <div className="ai-turn-wait"><span/><b>{players[turn]?.name}가 생각하는 중입니다…</b></div>}</div>
      <p className="holdem-rule">프리플롭 → 플롭 → 턴 → 리버 순서로 진행하며, 모두의 베팅이 맞으면 다음 카드가 열립니다.</p>
    </article>
    <aside className="holdem-ranking panel"><span className="section-kicker">WEEKLY RANKING</span><h2>이번 주 칩 순위</h2><p>매주 월요일 새로 시작하는 사내 재미용 순위입니다.</p><ol>{leaderboard.length ? leaderboard.map((row, index) => <li className={row.memberId === memberId ? "mine" : ""} key={row.memberId}><b>{index + 1}</b><span>{row.displayName}<small>{row.gamesPlayed}판 · {row.wins}승</small></span><strong>{row.bestChips.toLocaleString()}칩</strong></li>) : <li className="ranking-empty">첫 번째 기록의 주인공이 되어보세요!</li>}</ol></aside>
  </section>;
}
