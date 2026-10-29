import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActivityCell, ProgressKpis, SkillStat, TrendPoint } from './progressStats';

const shortDate = (at: number | Date) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Headline numbers as tiles; the delta carries an arrow and a sign, never color alone. */
export function StatTiles({ kpis }: { kpis: ProgressKpis }) {
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
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = hover !== null ? points[hover] : null;

  useEffect(() => {
    if (!expanded) return;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
    };
  }, [expanded]);

  const renderPlot = (large: boolean) => {
    const width = large ? 720 : W;
    const height = large ? 300 : H;
    const pad = large ? { left: 48, right: 18, top: 18, bottom: 30 } : PAD;
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (percent: number) => pad.top + (1 - percent / 100) * innerH;
    const path = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(point.percent).toFixed(1)}`).join(' ');
    const onMove = (event: React.PointerEvent<Element>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * width;
      let nearest = 0;
      for (let i = 1; i < points.length; i += 1) {
        if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i;
      }
      setHover(nearest);
    };
    const svg = (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Score trend over ${points.length} attempts, average ${average} percent`}
        onPointerMove={onMove}
      >
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line className="pg-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text className="pg-axis" x={pad.left - 6} y={y(tick) + 3.5} textAnchor="end">{tick}</text>
          </g>
        ))}
        <line className="pg-avg" x1={pad.left} x2={width - pad.right} y1={y(average)} y2={y(average)} />
        <text className="pg-axis" x={width - pad.right} y={y(average) - 4} textAnchor="end">avg {average}%</text>
        {points.length > 1 ? <path className="pg-line" d={path} /> : null}
        {points.map((point, i) => <circle key={point.id} className="pg-dot" cx={x(i)} cy={y(point.percent)} r={large ? 5 : 4} />)}
        {active && hover !== null ? (
          <g>
            <line className="pg-cross" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} />
            <circle className="pg-dot-hover" cx={x(hover)} cy={y(active.percent)} r={large ? 8 : 6} />
          </g>
        ) : null}
        <text className="pg-axis" x={pad.left} y={height - 5}>{shortDate(points[0].at)}</text>
        {points.length > 1 ? <text className="pg-axis" x={width - pad.right} y={height - 5} textAnchor="end">{shortDate(points[points.length - 1].at)}</text> : null}
      </svg>
    );

    return large ? (
      <div className="pg-chart-plot" onPointerLeave={() => setHover(null)}>{svg}</div>
    ) : (
      <div className="pg-chart-plot" onPointerLeave={() => setHover(null)}>
        <button
          ref={triggerRef}
          type="button"
          className="pg-chart-trigger"
          aria-label="Expand score trend chart"
          onClick={() => setExpanded(true)}
        >
          {svg}
        </button>
        <span className="pg-chart-hint">Click to expand</span>
      </div>
    );
  };

  const renderTooltip = (large: boolean) => {
    if (!active || hover === null) return null;
    const width = large ? 720 : W;
    const height = large ? 300 : H;
    const pad = large ? { left: 48, right: 18, top: 18, bottom: 30 } : PAD;
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const x = pad.left + (points.length === 1 ? innerW / 2 : (hover / (points.length - 1)) * innerW);
    const y = pad.top + (1 - active.percent / 100) * innerH;
    return (
      <div className="pg-tooltip" style={{ left: `${(x / width) * 100}%`, top: `${(y / height) * 100}%` }}>
        <strong>{active.percent}%</strong>
        <span>{active.title}</span>
        <small>{shortDate(active.at)}</small>
      </div>
    );
  };

  return (
    <>
      <div className="pg-chart">{renderPlot(false)}{renderTooltip(false)}</div>
      {expanded ? createPortal(
        <div
          className="pg-modal-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}
        >
          <section className="pg-modal" role="dialog" aria-modal="true" aria-labelledby="pg-modal-title">
            <header className="pg-modal-head">
              <div>
                <h2 id="pg-modal-title">Score trend</h2>
                <p>{points.length} attempts <span aria-hidden="true">·</span> {average}% average</p>
              </div>
              <button ref={closeRef} type="button" className="pg-modal-close" aria-label="Close score trend" onClick={() => setExpanded(false)}>×</button>
            </header>
            <div className="pg-modal-chart">{renderPlot(true)}{renderTooltip(true)}</div>
          </section>
        </div>,
        document.querySelector('.radix-themes') ?? document.body,
      ) : null}
    </>
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

/** Thirty compact squares, oldest first, showing the most recent calendar days. */
export function ActivityHeatmap({ days }: { days: ActivityCell[] }) {
  return (
    <div className="pg-heat" role="img" aria-label="Daily app activity for the past 30 days">
      {days.map((cell) => (
        <span
          key={cell.date.toISOString()}
          className={`pg-cell level-${Math.min(cell.count, 3)}`}
          title={`${shortDate(cell.date)} · ${cell.count > 0 ? 'Active' : 'No activity'}${cell.count > 1 ? ` · ${cell.count} quiz attempts` : ''}`}
        />
      ))}
    </div>
  );
}
