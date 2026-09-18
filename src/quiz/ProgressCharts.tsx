import { useState } from 'react';
import type { ActivityCell, ProgressKpis, SkillStat, TrendPoint } from './progressStats';

const shortDate = (at: number | Date) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Headline numbers as tiles; the delta carries an arrow and a sign, never color alone. */
export function StatTiles({ kpis, streak }: { kpis: ProgressKpis; streak: number }) {
  const delta = kpis.delta;
  return (
    <div className="pg-tiles">
      <div className="pg-tile pg-tile-hero">
        <small>Latest</small>
        <strong>{kpis.latest}%</strong>
        {delta !== null ? (
          <span className="pg-delta" title="Change since the previous attempt">
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {delta > 0 ? '+' : ''}
            {delta} vs previous
          </span>
        ) : (
          <span className="pg-delta">First attempt</span>
        )}
      </div>
      <div className="pg-tile">
        <small>Average</small>
        <strong>{kpis.average}%</strong>
      </div>
      <div className="pg-tile">
        <small>Best</small>
        <strong>{kpis.best}%</strong>
      </div>
      <div className="pg-tile">
        <small>Attempts</small>
        <strong>{kpis.count}</strong>
        {streak > 1 ? <span className="pg-delta">{streak}-day streak</span> : null}
      </div>
    </div>
  );
}

const W = 320;
const H = 132;
const PAD = { left: 30, right: 10, top: 10, bottom: 20 };

/** Score over attempts, with the average as a dashed reference and a hover crosshair. */
export function TrendChart({ points, average }: { points: TrendPoint[]; average: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (percent: number) => PAD.top + (1 - percent / 100) * innerH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.percent).toFixed(1)}`).join(' ');
  const active = hover !== null ? points[hover] : null;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i;
    }
    setHover(nearest);
  };

  return (
    <div className="pg-chart" onPointerLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Score trend over ${points.length} attempts, average ${average} percent`}
        onPointerMove={onMove}
      >
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line className="pg-grid" x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="pg-axis" x={PAD.left - 6} y={y(tick) + 3.5} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        <line className="pg-avg" x1={PAD.left} x2={W - PAD.right} y1={y(average)} y2={y(average)} />
        <text className="pg-axis" x={W - PAD.right} y={y(average) - 4} textAnchor="end">
          avg {average}%
        </text>
        {points.length > 1 ? <path className="pg-line" d={path} /> : null}
        {points.map((p, i) => (
          <circle key={p.id} className="pg-dot" cx={x(i)} cy={y(p.percent)} r={4} />
        ))}
        {active && hover !== null ? (
          <g>
            <line className="pg-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className="pg-dot-hover" cx={x(hover)} cy={y(active.percent)} r={6} />
          </g>
        ) : null}
        <text className="pg-axis" x={PAD.left} y={H - 5}>
          {shortDate(points[0].at)}
        </text>
        {points.length > 1 ? (
          <text className="pg-axis" x={W - PAD.right} y={H - 5} textAnchor="end">
            {shortDate(points[points.length - 1].at)}
          </text>
        ) : null}
      </svg>
      {active && hover !== null ? (
        <div
          className="pg-tooltip"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(active.percent) / H) * 100}%` }}
        >
          <strong>{active.percent}%</strong>
          <span>{active.title}</span>
          <small>{shortDate(active.at)}</small>
        </div>
      ) : null}
    </div>
  );
}

/** Accuracy by question type. Emphasis: the weakest skill gets the full accent, the rest recede. */
export function SkillBars({ skills }: { skills: SkillStat[] }) {
  return (
    <ul className="pg-skills">
      {skills.map((skill, index) => (
        <li key={skill.key} title={`${skill.label}: ${skill.percent}% across ${skill.questions} question${skill.questions === 1 ? '' : 's'}`}>
          <span className="pg-skill-label">{skill.label}</span>
          <span className="pg-track">
            <span
              className={`pg-fill ${index === 0 && skills.length > 1 ? 'weakest' : ''}`}
              style={{ width: `${Math.max(skill.percent, 2)}%` }}
            />
          </span>
          <span className="pg-skill-value">
            {skill.percent}%<small> · {skill.questions}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

const CELL = 11;
const GAP = 3;

/** Sessions per day for the last 12 weeks. */
export function ActivityHeatmap({ weeks }: { weeks: ActivityCell[][] }) {
  const width = weeks.length * (CELL + GAP) - GAP;
  const height = 7 * (CELL + GAP) - GAP;
  return (
    <svg className="pg-heat" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Quiz activity over the last 12 weeks">
      {weeks.map((week, w) =>
        week.map((cell, d) => (
          <rect
            key={`${w}-${d}`}
            className={`pg-cell level-${Math.min(cell.count, 3)}`}
            x={w * (CELL + GAP)}
            y={d * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={3}
          >
            <title>{`${shortDate(cell.date)} · ${cell.count} attempt${cell.count === 1 ? '' : 's'}`}</title>
          </rect>
        )),
      )}
    </svg>
  );
}
