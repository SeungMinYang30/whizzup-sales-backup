"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyHoldemAction,
  chooseAiMove,
  createHoldemGame,
  getRaiseBounds,
  startHoldemHand,
  visibleCommunityCount,
  type HoldemAction,
  type HoldemDifficulty,
  type HoldemPlayer,
} from "../lib/holdem-game";
import { evaluateHand, rankLabel, type Card } from "../lib/holdem";

type RankRow = {
  memberId: number;
  displayName: string;
  bestChips: number;
  gamesPlayed: number;
  wins: number;
};

const streetNames = ["프리플롭", "플롭", "턴", "리버", "쇼다운"];
const difficultyLabels: Record<HoldemDifficulty, string> = {
  easy: "편안하게",
  normal: "보통",
  hard: "진지하게",
};

function PlayingCard({
  card,
  hidden = false,
  index = 0,
}: {
  card?: Card;
  hidden?: boolean;
  index?: number;
}) {
  if (!card || hidden) {
    return (
      <span
        className="poker-card card-back"
        aria-label={card ? "숨긴 카드" : "아직 공개되지 않은 카드"}
        style={{ animationDelay: `${index * 55}ms` }}
      >
        <i>W</i>
      </span>
    );
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <span
      className={`poker-card ${red ? "red" : ""}`}
      aria-label={`${rankLabel(card.rank)} ${card.suit}`}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <b>{rankLabel(card.rank)}</b>
      <i>{card.suit}</i>
      <small>{rankLabel(card.rank)}</small>
    </span>
  );
}

function DealerButton() {
  return <span className="dealer-button" aria-label="딜러 버튼">D</span>;
}

function PlayerSeat({
  player,
  index,
  dealer,
  currentTurn,
  complete,
  winner,
  isHero = false,
}: {
  player: HoldemPlayer;
  index: number;
  dealer: number;
  currentTurn: number;
  complete: boolean;
  winner: boolean;
  isHero?: boolean;
}) {
  return (
    <div
      className={`poker-seat ${isHero ? "my-seat" : `ai-seat ai-${index - 1}`} ${
        currentTurn === index ? "seat-turn" : ""
      } ${player.folded ? "seat-folded" : ""} ${winner ? "seat-winner" : ""} ${
        player.allIn ? "seat-all-in" : ""
      }`}
    >
      <div className="seat-badges">
        {dealer === index && <DealerButton />}
        {currentTurn === index && <b className="seat-state turn">차례</b>}
        {player.folded && <b className="seat-state folded">폴드</b>}
        {player.allIn && !player.folded && <b className="seat-state all-in">올인</b>}
        {winner && <b className="seat-state winner">승리</b>}
      </div>
      <span className="seat-avatar">{player.emoji}</span>
      <strong>
        {player.name}
        {isHero && <u>나</u>}
      </strong>
      <small className="seat-style">{player.style}</small>
      <div className="seat-chip-line">
        <b>{player.chips.toLocaleString()}</b>칩
        {player.roundBet > 0 && <em>베팅 {player.roundBet.toLocaleString()}</em>}
      </div>
      <div className="seat-cards">
        <PlayingCard card={player.cards[0]} hidden={!isHero && !complete} />
        <PlayingCard card={player.cards[1]} hidden={!isHero && !complete} index={1} />
      </div>
      {player.lastAction && <em className="action-bubble">{player.lastAction}</em>}
    </div>
  );
}

export default function HoldemLounge({ displayName }: { displayName: string }) {
  const [game, setGame] = useState(() => createHoldemGame(displayName));
  const [difficulty, setDifficulty] = useState<HoldemDifficulty>("normal");
  const [raiseTo, setRaiseTo] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [leaderboard, setLeaderboard] = useState<RankRow[]>([]);
  const [memberId, setMemberId] = useState(0);
  const aiTimer = useRef<number | null>(null);
  const recordedHand = useRef(0);

  const loadLeaderboard = useCallback(async () => {
    const response = await fetch("/api/holdem", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as {
      memberId: number;
      leaderboard: RankRow[];
    };
    setMemberId(data.memberId);
    setLeaderboard(data.leaderboard);
  }, []);

  const playTone = useCallback(
    (kind: "deal" | "action" | "win") => {
      if (!soundEnabled) return;
      const AudioContextClass =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "win" ? "sine" : "triangle";
      oscillator.frequency.value = kind === "win" ? 740 : kind === "deal" ? 260 : 390;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
      window.setTimeout(() => void context.close(), 260);
    },
    [soundEnabled],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLeaderboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLeaderboard]);

  useEffect(
    () => () => {
      if (aiTimer.current) window.clearTimeout(aiTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (game.complete || game.turn <= 0 || !game.players[game.turn]) return;
    aiTimer.current = window.setTimeout(
      () => {
        setGame((current) => {
          if (current.complete || current.turn <= 0) return current;
          const move = chooseAiMove(current, current.turn, difficulty);
          return applyHoldemAction(
            current,
            current.turn,
            move.action,
            move.raiseTo,
          );
        });
        playTone("action");
      },
      game.players[0]?.folded ? 650 : 900 + Math.round(Math.random() * 450),
    );
    return () => {
      if (aiTimer.current) window.clearTimeout(aiTimer.current);
    };
  }, [difficulty, game.complete, game.players, game.turn, playTone]);

  useEffect(() => {
    if (!game.complete || !game.outcome || game.handNumber <= recordedHand.current) return;
    recordedHand.current = game.handNumber;
    const heroWon = game.outcome.payouts[0] > 0;
    if (heroWon) playTone("win");
    const heroChips = game.players[0]?.chips ?? 0;
    void fetch("/api/holdem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chips: heroChips, won: heroWon }),
    }).then(async (response) => {
      if (!response.ok) return;
      const data = (await response.json()) as {
        memberId: number;
        leaderboard: RankRow[];
      };
      setMemberId(data.memberId);
      setLeaderboard(data.leaderboard);
    });
  }, [game.complete, game.handNumber, game.outcome, game.players, playTone]);

  const visibleCount = visibleCommunityCount(game.street);
  const hero = game.players[0];
  const raiseBounds = getRaiseBounds(game, 0);
  const selectedRaiseTo = Math.min(
    raiseBounds.maxRaiseTo,
    Math.max(raiseBounds.minRaiseTo, raiseTo || raiseBounds.minRaiseTo),
  );
  const myHand = useMemo(() => {
    if (!hero || visibleCount < 3) return "";
    return evaluateHand([
      ...hero.cards,
      ...game.community.slice(0, visibleCount),
    ]).name;
  }, [game.community, hero, visibleCount]);
  const finishedHands = Math.max(0, game.handNumber - (game.complete ? 0 : 1));
  const winRate = finishedHands
    ? Math.round((game.sessionWins / finishedHands) * 100)
    : 0;

  const startNextHand = (resetSession = false) => {
    if (aiTimer.current) window.clearTimeout(aiTimer.current);
    setRaiseTo(0);
    setGame((current) =>
      startHoldemHand(current, displayName, resetSession),
    );
    playTone("deal");
  };

  const takeAction = (action: HoldemAction, amount?: number) => {
    setRaiseTo(0);
    setGame((current) => applyHoldemAction(current, 0, action, amount));
    playTone("action");
  };

  const setPotRaise = (ratio: number) => {
    const target = game.currentBet + Math.max(game.minRaise, Math.round(game.pot * ratio));
    setRaiseTo(
      Math.min(raiseBounds.maxRaiseTo, Math.max(raiseBounds.minRaiseTo, target)),
    );
  };

  return (
    <section className="holdem-layout premium-holdem">
      <article className="holdem-game panel">
        <div className="holdem-intro">
          <div>
            <span className="section-kicker">WHIZZUP PRIVATE TABLE</span>
            <h2>위즈업 프리미엄 홀덤</h2>
            <p>AI 플레이 스타일을 읽으며 이어서 즐기는 3인 텍사스 홀덤입니다.</p>
          </div>
          <div className="holdem-top-controls">
            <div className="holdem-difficulty" aria-label="AI 난이도">
              {(Object.keys(difficultyLabels) as HoldemDifficulty[]).map((value) => (
                <button
                  type="button"
                  className={difficulty === value ? "active" : ""}
                  key={value}
                  onClick={() => setDifficulty(value)}
                >
                  {difficultyLabels[value]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="holdem-sound"
              onClick={() => setSoundEnabled((current) => !current)}
              aria-pressed={soundEnabled}
            >
              {soundEnabled ? "🔊 효과음" : "🔇 음소거"}
            </button>
          </div>
        </div>

        <div className="holdem-session-strip">
          <div><span>현재 칩</span><strong>{(hero?.chips ?? 1000).toLocaleString()}</strong></div>
          <div><span>진행한 판</span><strong>{finishedHands}</strong></div>
          <div><span>승리</span><strong>{game.sessionWins}</strong></div>
          <div><span>승률</span><strong>{winRate}%</strong></div>
          <div><span>최고 칩</span><strong>{game.bestHeroChips.toLocaleString()}</strong></div>
          <small>가상 칩 전용 · 현금 가치 없음</small>
        </div>

        <div className="holdem-round-bar">
          <b>HAND #{game.handNumber || "-"}</b>
          <span>{streetNames[game.street]}</span>
          <small>{game.turn >= 0 ? `${game.players[game.turn]?.name} 차례` : "판 종료"}</small>
          <em>현재 베팅 {game.currentBet.toLocaleString()}칩</em>
        </div>

        {hero?.folded && !game.complete && (
          <div className="holdem-spectating" role="status">
            <span>👀</span>
            <div>
              <strong>폴드 후 관전 중</strong>
              <small>남은 AI 플레이를 빠르게 마무리하고 있습니다.</small>
            </div>
          </div>
        )}

        <div className={`poker-table street-${game.street}`}>
          <div className="table-rail-light" aria-hidden="true" />
          {game.players.slice(1).map((player, playerIndex) => {
            const index = playerIndex + 1;
            return (
              <PlayerSeat
                player={player}
                index={index}
                dealer={game.dealer}
                currentTurn={game.turn}
                complete={game.complete}
                winner={Boolean(game.outcome?.winnerIndexes.includes(index))}
                key={player.id}
              />
            );
          })}

          <div className="poker-center">
            <div className="poker-pot-zone">
              <div className="poker-chip-stack" aria-hidden="true"><i /><i /><i /><i /></div>
              <span className="pot-chip">POT {game.pot.toLocaleString()}</span>
            </div>
            <div className="community-cards">
              {Array.from({ length: 5 }, (_, index) => (
                <PlayingCard
                  key={index}
                  card={game.community[index]}
                  hidden={index >= visibleCount}
                  index={index}
                />
              ))}
            </div>
            <p>{game.message}</p>
          </div>

          {hero && (
            <PlayerSeat
              player={hero}
              index={0}
              dealer={game.dealer}
              currentTurn={game.turn}
              complete={game.complete}
              winner={Boolean(game.outcome?.winnerIndexes.includes(0))}
              isHero
            />
          )}
        </div>

        {game.outcome && (
          <div
            className={`holdem-outcome holdem-outcome-below ${game.outcome.kind}`}
            role="status"
            aria-live="polite"
          >
            <strong>{game.outcome.title}</strong>
            <span>{game.outcome.detail}</span>
          </div>
        )}

        <div className="holdem-console">
          <div className="holdem-hand-status">
            <span>내 패</span>
            <strong>{myHand || (game.complete ? "새 판 준비" : "커뮤니티 카드 대기")}</strong>
            <small>
              {raiseBounds.callAmount > 0
                ? `콜에 ${raiseBounds.callAmount.toLocaleString()}칩 필요`
                : "체크할 수 있습니다"}
            </small>
          </div>

          {game.complete ? (
            <div className="holdem-actions completed">
              <button
                type="button"
                className="holdem-new"
                onClick={() => startNextHand((hero?.chips ?? 0) <= 0)}
              >
                {game.handNumber === 0
                  ? "게임 시작"
                  : (hero?.chips ?? 0) <= 0
                    ? "새 세션 시작"
                    : "다음 판 시작"}
              </button>
              {game.handNumber > 0 && (hero?.chips ?? 0) > 0 && (
                <button type="button" onClick={() => startNextHand(true)}>
                  칩 초기화
                </button>
              )}
            </div>
          ) : game.turn === 0 ? (
            <div className="holdem-turn-controls">
              <div className="holdem-raise-control">
                <div>
                  <span>레이즈 금액</span>
                  <strong>{selectedRaiseTo.toLocaleString()}칩까지</strong>
                </div>
                <input
                  type="range"
                  min={raiseBounds.minRaiseTo}
                  max={Math.max(raiseBounds.minRaiseTo, raiseBounds.maxRaiseTo)}
                  step={10}
                  value={selectedRaiseTo}
                  disabled={!raiseBounds.canRaise}
                  onChange={(event) => setRaiseTo(Number(event.target.value))}
                  aria-label="레이즈 총액"
                />
                <div className="holdem-quick-raise">
                  <button type="button" onClick={() => setPotRaise(0.5)} disabled={!raiseBounds.canRaise}>½ 팟</button>
                  <button type="button" onClick={() => setPotRaise(1)} disabled={!raiseBounds.canRaise}>팟</button>
                  <button type="button" onClick={() => setRaiseTo(raiseBounds.maxRaiseTo)} disabled={!raiseBounds.canRaise}>최대</button>
                </div>
              </div>
              <div className="holdem-actions">
                <button type="button" className="holdem-fold" onClick={() => takeAction("fold")}>폴드</button>
                {raiseBounds.callAmount === 0 ? (
                  <button type="button" onClick={() => takeAction("check")}>체크</button>
                ) : (
                  <button type="button" onClick={() => takeAction("call")}>콜 {raiseBounds.callAmount.toLocaleString()}</button>
                )}
                <button
                  type="button"
                  className="holdem-raise"
                  disabled={!raiseBounds.canRaise}
                  onClick={() => takeAction("raise", selectedRaiseTo)}
                >
                  레이즈 {selectedRaiseTo.toLocaleString()}
                </button>
                <button type="button" className="holdem-all-in" onClick={() => takeAction("all-in")}>
                  올인
                </button>
              </div>
            </div>
          ) : (
            <div className="ai-turn-wait">
              <span />
              <div><b>{game.players[game.turn]?.name}가 패를 읽는 중입니다</b><small>{game.players[game.turn]?.style} 플레이</small></div>
            </div>
          )}
        </div>
        <p className="holdem-rule">
          딜러 버튼과 블라인드가 매 판 이동하며, AI 두 명은 서로 다른 성향으로 베팅합니다.
        </p>
      </article>

      <aside className="holdem-sidebar">
        <section className="holdem-ranking panel">
          <span className="section-kicker">WEEKLY RANKING</span>
          <h2>이번 주 칩 순위</h2>
          <p>매주 월요일 새로 시작하는 사내 재미용 순위입니다.</p>
          <ol>
            {leaderboard.length ? (
              leaderboard.map((row, index) => (
                <li className={row.memberId === memberId ? "mine" : ""} key={row.memberId}>
                  <b>{index + 1}</b>
                  <span>{row.displayName}<small>{row.gamesPlayed}판 · {row.wins}승</small></span>
                  <strong>{row.bestChips.toLocaleString()}칩</strong>
                </li>
              ))
            ) : (
              <li className="ranking-empty">첫 번째 기록의 주인공이 되어보세요!</li>
            )}
          </ol>
        </section>
        <section className="holdem-guide panel">
          <span className="section-kicker">TABLE GUIDE</span>
          <h3>이번 버전의 플레이</h3>
          <ul>
            <li><b>몽글이</b><span>좋은 패를 기다리는 신중형</span></li>
            <li><b>콩이</b><span>블러프와 레이즈가 잦은 공격형</span></li>
            <li><b>칩 유지</b><span>다음 판에도 현재 칩으로 계속 진행</span></li>
            <li><b>정식 정산</b><span>올인과 사이드 팟까지 자동 계산</span></li>
          </ul>
        </section>
      </aside>
    </section>
  );
}
