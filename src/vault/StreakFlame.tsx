import { useId, type CSSProperties } from 'react';
import type { FlameStage } from './homeMilestones';
import { seededRandom, svgId } from './svgArt';

const FLAME = 'M50 6 C58 26 78 42 82 70 C86 100 70 128 50 128 C30 128 14 104 18 76 C20 60 28 50 34 40 C36 52 40 58 44 60 C42 42 44 22 50 6 Z';
const around = (scaleY: number, scaleX = scaleY) => `translate(50 128) scale(${scaleX} ${scaleY}) translate(-50 -128)`;

function Gradient({ id, stops }: { id: string; stops: [string, string] }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={stops[0]} />
      <stop offset="1" stopColor={stops[1]} />
    </linearGradient>
  );
}

/** Animated streak flame. Decorative: the streak number is rendered as text beside it. */
export function StreakFlame({ stage, width = 96, height = 132 }: { stage: FlameStage; width?: number; height?: number }) {
  const id = svgId(useId());
  if (stage.key === 'ember') return <ColdEmber id={id} width={width} height={height} />;

  const s = stage.scale;
  const random = seededRandom(stage.min + 7);
  const embers = Array.from({ length: stage.embers }, (_, i) => {
    const spark = Boolean(stage.sparks && i % 2);
    return {
      cx: 50 + (random() - 0.5) * 34 * s,
      cy: 118 - random() * 30 * s,
      r: spark ? 0.9 : 1.2 + random() * 1.1,
      fill: spark ? '#fff3c4' : stage.outer[1],
      style: {
        '--x': `${((random() - 0.5) * 30).toFixed(1)}px`,
        '--y': `${(-60 - random() * 50).toFixed(0)}px`,
        '--dur': `${(1.6 + random() * 1.8).toFixed(2)}s`,
        '--del': `${(random() * 3).toFixed(2)}s`,
      } as CSSProperties,
    };
  });

  return (
    <svg
      className={`streak-flame streak-flame-${stage.key}`}
      viewBox="0 0 100 140"
      width={width}
      height={height}
      aria-hidden="true"
      style={{ '--spd': stage.speed, '--glow': stage.glow } as CSSProperties}
    >
      <defs>
        <Gradient id={`${id}o`} stops={stage.outer} />
        <Gradient id={`${id}m`} stops={stage.mid} />
        <Gradient id={`${id}c`} stops={stage.core} />
        <radialGradient id={`${id}h`}>
          <stop offset="0" stopColor="#ffe680" stopOpacity=".7" />
          <stop offset=".6" stopColor="#ffcc33" stopOpacity=".18" />
          <stop offset="1" stopColor="#ffcc33" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}b`}>
          <stop offset="0" stopColor={stage.outer[1]} stopOpacity=".9" />
          <stop offset="1" stopColor={stage.outer[1]} stopOpacity="0" />
        </radialGradient>
      </defs>
      {stage.halo ? <circle className="streak-flame-halo" cx="50" cy="78" r="58" fill={`url(#${id}h)`} /> : null}
      <ellipse className="streak-flame-base" cx="50" cy="129" rx={34 * s} ry="6" fill={`url(#${id}b)`} />
      <g transform={around(s)}>
        <path className="streak-flame-layer streak-flame-outer" d={FLAME} fill={`url(#${id}o)`} />
        <g transform={around(0.7, -0.7)}>
          <path className="streak-flame-layer streak-flame-mid" d={FLAME} fill={`url(#${id}m)`} />
        </g>
        <g transform={around(0.4)}>
          <path className="streak-flame-layer streak-flame-core" d={FLAME} fill={`url(#${id}c)`} />
        </g>
      </g>
      {embers.map((ember, i) => (
        <circle key={i} className="streak-flame-ember" cx={ember.cx} cy={ember.cy} r={ember.r} fill={ember.fill} style={ember.style} />
      ))}
    </svg>
  );
}

function ColdEmber({ id, width, height }: { id: string; width: number; height: number }) {
  return (
    <svg className="streak-flame streak-flame-ember-stage" viewBox="0 0 100 140" width={width} height={height} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}k`} cx="40%" cy="30%">
          <stop offset="0" stopColor="#5a5a5a" />
          <stop offset="1" stopColor="#1c1c1c" />
        </radialGradient>
      </defs>
      <path className="streak-flame-smoke" d="M50 108 C44 98 56 90 50 80 C44 70 56 62 50 52" fill="none" stroke="#a0a0a0" strokeWidth="3" strokeLinecap="round" />
      <path className="streak-flame-smoke streak-flame-smoke-late" d="M54 108 C60 98 48 90 54 80 C60 70 48 62 54 54" fill="none" stroke="#a0a0a0" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M28 128 C26 116 38 108 50 110 C62 106 76 114 72 128 Z" fill={`url(#${id}k)`} />
      <path className="streak-flame-coal" d="M38 124 L46 117 L52 121 L60 115 M46 117 L48 126" fill="none" stroke="#ff6a1a" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
