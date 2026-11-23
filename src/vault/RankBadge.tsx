import { useId, type CSSProperties, type ReactNode } from 'react';
import type { QuizRank } from './homeMilestones';
import { hexPoints, pointList, seededRandom, svgId } from './svgArt';

const HEX = hexPoints(60, 60, 44);
const HEX_POINTS = pointList(HEX);
const INNER_POINTS = pointList(hexPoints(60, 60, 39.5));
const RING_RADIUS = 56;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

type Props = {
  rank: QuizRank;
  size?: number;
  /** 0–1 progress toward the next rank; draws a ring around the badge when set. */
  progress?: number;
};

/** Hexagonal material badge for a quiz rank. Decorative: callers render the rank name as text. */
export function RankBadge({ rank, size = 120, progress }: Props) {
  const id = svgId(useId());
  const art = MATERIALS[rank.key](id, seededRandom(rank.min * 13 + 5));
  const solid = rank.key !== 'sand';
  const fontSize = rank.label.length > 2 ? 17 : 21;
  const baseline = 61 + fontSize * 0.36;

  return (
    <svg className={`rank-badge rank-badge-${rank.key}`} viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}><polygon points={HEX_POINTS} /></clipPath>
        <linearGradient id={`${id}bev`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,.65)" />
          <stop offset=".5" stopColor="rgba(255,255,255,0)" />
          <stop offset="1" stopColor="rgba(0,0,0,.28)" />
        </linearGradient>
        <linearGradient id={`${id}sw`} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity={art.sweep?.opacity ?? 0} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        {art.defs}
      </defs>
      {progress !== undefined ? (
        <>
          <circle className="rank-badge-track" cx="60" cy="60" r={RING_RADIUS} fill="none" strokeWidth="3.5" />
          <circle
            className="rank-badge-ring"
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke={rank.color}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - Math.min(1, Math.max(0, progress)))}
            transform="rotate(-90 60 60)"
          />
        </>
      ) : null}
      {art.body}
      <g clipPath={`url(#${id}c)`}>{art.texture}</g>
      {solid ? (
        <>
          <polygon points={INNER_POINTS} fill="none" stroke={`url(#${id}bev)`} strokeWidth="2.5" strokeLinejoin="round" />
          <polygon points={HEX_POINTS} fill="none" stroke="rgba(0,0,0,.28)" strokeWidth="1.2" strokeLinejoin="round" />
        </>
      ) : null}
      <text x="60" y={baseline + 1} textAnchor="middle" fontSize={fontSize} fontWeight="800" fill={art.labelHighlight}>{rank.label}</text>
      <text x="60" y={baseline} textAnchor="middle" fontSize={fontSize} fontWeight="800" fill={art.labelFill}>{rank.label}</text>
      {art.sweep ? (
        <g clipPath={`url(#${id}c)`}>
          <g transform="skewX(-22)">
            <rect
              className="rank-badge-sweep"
              style={{ '--sweep': art.sweep.duration, '--sweep-delay': art.sweep.delay ?? '0s' } as CSSProperties}
              x="-50"
              y="0"
              width={art.sweep.width ?? 26}
              height="120"
              fill={`url(#${id}sw)`}
            />
          </g>
        </g>
      ) : null}
      {art.overlay}
    </svg>
  );
}

type Art = {
  defs?: ReactNode;
  body: ReactNode;
  texture?: ReactNode;
  overlay?: ReactNode;
  labelFill: string;
  labelHighlight: string;
  sweep?: { opacity: number; duration: string; delay?: string; width?: number };
};

const hexFill = (fill: string) => <polygon points={HEX_POINTS} fill={fill} />;

function linear(id: string, stops: string[], diagonal = false) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={diagonal ? 1 : 0} y2="1">
      {stops.map((color, i) => <stop key={i} offset={i / (stops.length - 1)} stopColor={color} />)}
    </linearGradient>
  );
}

function speckles(random: () => number, count: number, colors: string[], rMin: number, rMax: number) {
  return Array.from({ length: count }, (_, i) => (
    <circle
      key={i}
      cx={(14 + random() * 92).toFixed(1)}
      cy={(12 + random() * 96).toFixed(1)}
      r={(rMin + random() * (rMax - rMin)).toFixed(2)}
      fill={colors[Math.floor(random() * colors.length)]}
    />
  ));
}

function sparkle(x: number, y: number, a: number, delay: number) {
  const b = a * 0.22;
  return (
    <path
      key={`${x}-${y}`}
      className="rank-badge-twinkle"
      style={{ animationDelay: `${delay}s` }}
      fill="#fff"
      d={`M${x} ${y - a} L${x + b} ${y - b} L${x + a} ${y} L${x + b} ${y + b} L${x} ${y + a} L${x - b} ${y + b} L${x - a} ${y} L${x - b} ${y - b} Z`}
    />
  );
}

function rotatingSpectrum(id: string, colors: string[], duration: string) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      {colors.map((color, i) => <stop key={i} offset={i / (colors.length - 1)} stopColor={color} />)}
      <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur={duration} repeatCount="indefinite" />
    </linearGradient>
  );
}

const DARK_LABEL = { labelFill: 'rgba(0,0,0,.32)', labelHighlight: 'rgba(255,255,255,.35)' };

const MATERIALS: Record<QuizRank['key'], (id: string, random: () => number) => Art> = {
  sand: (_id, random) => ({
    body: <polygon className="rank-badge-sand-outline" points={HEX_POINTS} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />,
    texture: speckles(random, 30, ['#c9bc9a', '#a8997a'], 0.5, 1.2),
    labelFill: 'var(--mv-muted)',
    labelHighlight: 'transparent',
  }),
  pebble: (id, random) => ({
    defs: (
      <radialGradient id={`${id}g`} cx="35%" cy="28%" r="80%">
        <stop offset="0" stopColor="#dcdcd9" />
        <stop offset=".55" stopColor="#9c9c98" />
        <stop offset="1" stopColor="#5c5c59" />
      </radialGradient>
    ),
    body: hexFill(`url(#${id}g)`),
    texture: speckles(random, 14, ['rgba(0,0,0,.12)', 'rgba(255,255,255,.2)'], 0.8, 2.2),
    ...DARK_LABEL,
  }),
  brick: (id, random) => ({
    defs: (
      <>
        {linear(`${id}g`, ['#d0704c', '#9b4229', '#7c321f'])}
        <pattern id={`${id}p`} width="22" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 0.5H22M0 7.5H22M0.5 0V7M11.5 7V14" stroke="#f3dcc3" strokeWidth="1.3" opacity=".55" fill="none" />
        </pattern>
      </>
    ),
    body: hexFill(`url(#${id}g)`),
    texture: (
      <>
        <rect width="120" height="120" fill={`url(#${id}p)`} />
        {speckles(random, 40, ['rgba(0,0,0,.18)', 'rgba(255,220,190,.15)'], 0.4, 1.1)}
      </>
    ),
    labelFill: 'rgba(60,15,5,.45)',
    labelHighlight: 'rgba(255,255,255,.35)',
  }),
  concrete: (id, random) => ({
    defs: linear(`${id}g`, ['#bdbbb6', '#8d8b86', '#74726d']),
    body: hexFill(`url(#${id}g)`),
    texture: speckles(random, 90, ['#5d5b57', '#d8d6d1', '#6f6c66', '#a9a49a', '#4a4844'], 0.5, 2.6),
    ...DARK_LABEL,
  }),
  granite: (id, random) => ({
    defs: linear(`${id}g`, ['#dba49a', '#b07a72', '#8a5852']),
    body: hexFill(`url(#${id}g)`),
    texture: speckles(random, 120, ['#1d1514', '#2b201e', '#f4ece6', '#6d5b58', '#e9c9c0'], 0.5, 2.4),
    sweep: { opacity: 0.35, duration: '6s' },
    ...DARK_LABEL,
  }),
  marble: (id, random) => {
    const veins = Array.from({ length: 6 }, (_, i) => {
      let x = 10 + random() * 30;
      let y = 10 + random() * 100;
      let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      for (let k = 0; k < 4; k += 1) {
        const nx = x + 18 + random() * 14;
        const ny = y + (random() - 0.5) * 34;
        const qx = (x + nx) / 2 + (random() - 0.5) * 16;
        const qy = (y + ny) / 2 + (random() - 0.5) * 16;
        d += ` Q${qx.toFixed(1)} ${qy.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
        x = nx;
        y = ny;
      }
      const gold = i === 2;
      const width = (0.5 + random() * 1.3).toFixed(2);
      const opacity = gold ? 0.8 : 0.25 + random() * 0.35;
      return <path key={i} d={d} fill="none" stroke={gold ? '#c9a45c' : '#8f877c'} strokeWidth={width} opacity={opacity} strokeLinecap="round" />;
    });
    return {
      defs: linear(`${id}g`, ['#fdfcf9', '#ebe7df', '#d6d0c5']),
      body: hexFill(`url(#${id}g)`),
      texture: veins,
      sweep: { opacity: 0.8, duration: '5s' },
      labelFill: 'rgba(90,80,65,.35)',
      labelHighlight: 'rgba(255,255,255,.9)',
    };
  },
  obsidian: (id) => ({
    defs: (
      <>
        <radialGradient id={`${id}g`} cx="32%" cy="25%" r="85%">
          <stop offset="0" stopColor="#4b4163" />
          <stop offset=".45" stopColor="#17131f" />
          <stop offset="1" stopColor="#050408" />
        </radialGradient>
        {rotatingSpectrum(`${id}ir`, ['#5ef2ff', '#b05cff', '#ff5cc8', '#ffd25c', '#5ef2ff'], '6s')}
      </>
    ),
    body: hexFill(`url(#${id}g)`),
    texture: (
      <>
        <ellipse cx="42" cy="36" rx="30" ry="12" fill="#fff" opacity=".1" transform="rotate(-28 42 36)" />
        <path d="M30 80 L52 58 L46 92 Z" fill="#fff" opacity=".04" />
      </>
    ),
    overlay: <polygon points={HEX_POINTS} fill="none" stroke={`url(#${id}ir)`} strokeWidth="3" strokeLinejoin="round" />,
    sweep: { opacity: 0.25, duration: '5.5s', delay: '1s' },
    labelFill: 'rgba(255,255,255,.14)',
    labelHighlight: 'rgba(176,92,255,.5)',
  }),
  gold: (id, random) => {
    const lines: ReactNode[] = [];
    for (let y = 14, i = 0; y < 108; y += 1.6, i += 1) {
      const light = random() > 0.5;
      lines.push(<line key={i} x1="10" x2="110" y1={y} y2={y} stroke={light ? '#fff' : '#6b4a0a'} strokeWidth=".5" opacity={(random() * 0.14).toFixed(3)} />);
    }
    return {
      defs: linear(`${id}g`, ['#fff4b8', '#f1c445', '#b9821a', '#f7d56a', '#a26f12'], true),
      body: hexFill(`url(#${id}g)`),
      texture: lines,
      overlay: [sparkle(88, 34, 7, 0), sparkle(34, 82, 4.5, 1.2)],
      sweep: { opacity: 0.9, duration: '3.5s', width: 18 },
      labelFill: 'rgba(110,70,0,.4)',
      labelHighlight: 'rgba(255,250,210,.6)',
    };
  },
  diamond: (id) => {
    const table = hexPoints(60, 60, 20);
    const shades = ['#ffffff', '#c9ecff', '#8fd0fb', '#e6f7ff', '#6cbcf2', '#b5e2ff'];
    const facets = HEX.flatMap((corner, i) => {
      const j = (i + 1) % 6;
      return [
        <polygon key={`a${i}`} points={pointList([corner, HEX[j], table[j]])} fill={shades[i]} />,
        <polygon key={`b${i}`} points={pointList([corner, table[j], table[i]])} fill={shades[(i + 3) % 6]} />,
      ];
    });
    return {
      defs: rotatingSpectrum(`${id}rb`, ['#ff5c8a', '#ffd25c', '#7dff8a', '#5ce1ff', '#9b6bff', '#ff5c8a'], '8s'),
      body: (
        <>
          {facets}
          <polygon points={pointList(table)} fill="#f1faff" />
        </>
      ),
      texture: (
        <>
          <rect width="120" height="120" fill={`url(#${id}rb)`} opacity=".38" style={{ mixBlendMode: 'color' }} />
          <g fill="none" stroke="#fff" strokeWidth=".7" opacity=".75">
            {HEX.map(([x, y], i) => <line key={i} x1={x} y1={y} x2={table[i][0]} y2={table[i][1]} />)}
            <polygon points={pointList(table)} />
          </g>
        </>
      ),
      overlay: [sparkle(86, 30, 8, 0), sparkle(30, 46, 5, 0.8), sparkle(78, 88, 6, 1.6)],
      sweep: { opacity: 0.9, duration: '3.8s', width: 20 },
      labelFill: 'rgba(30,90,140,.35)',
      labelHighlight: 'rgba(255,255,255,.9)',
    };
  },
};
