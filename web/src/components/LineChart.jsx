import { useEffect, useRef, useState } from 'react';
import { formatTick, formatValue } from '../utils/formatters';

/** Container width, so the chart always draws 1:1 pixels (no stretched strokes). */
function useWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0] && entries[0].contentRect;
      const next = rect ? rect.width : fallback;
      if (next > 0) setWidth(Math.round(next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback]);

  return [ref, width];
}

/** Y scale that tolerates a flat series (min === max) without dividing by zero. */
function makeScale(values) {
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, span: 1 };
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }

  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad, span: max - min + pad * 2 };
}

/** Normalise API points (raw `value` or bucketed `avg`) into one shape. */
function normalise(points) {
  return points
    .map((p) => ({
      ts: new Date(p.ts).getTime(),
      value: p.value !== undefined ? p.value : p.avg,
      min: p.min,
      max: p.max,
    }))
    .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Time-series line chart drawn as plain SVG.
 *
 * Deliberately dependency-free: the dashboard ships no charting library, so a
 * new product model costs nothing extra. Bucketed series are drawn with their
 * min/max as a shaded band (the API returns avg/min/max for buckets).
 */
export function LineChart({
  points = [],
  color = '#38bdf8',
  unit = '',
  decimals = 1,
  bucket = 'raw',
  height = 220,
  emptyLabel = 'No data in this range',
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const series = normalise(points);

  const padding = { top: 14, right: 58, bottom: 26, left: 12 };
  const innerWidth = Math.max(width - padding.left - padding.right, 40);
  const innerHeight = Math.max(height - padding.top - padding.bottom, 40);

  if (series.length === 0) {
    return (
      <div ref={ref} className="chart chart--empty" style={{ height }}>
        <span>{emptyLabel}</span>
      </div>
    );
  }

  const bounds = makeScale(series.flatMap((p) => [p.value, p.min, p.max].filter((v) => Number.isFinite(v))));
  const ts0 = series[0].ts;
  const ts1 = series[series.length - 1].ts;
  const tsSpan = ts1 - ts0 || 1;

  const x = (ts) => padding.left + ((ts - ts0) / tsSpan) * innerWidth;
  const y = (value) => padding.top + innerHeight - ((value - bounds.min) / bounds.span) * innerHeight;

  const linePath = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const baseY = (padding.top + innerHeight).toFixed(2);
  const areaPath = `${linePath} L${x(ts1).toFixed(2)},${baseY} L${x(ts0).toFixed(2)},${baseY} Z`;

  const hasBand = series.some((p) => Number.isFinite(p.min));
  const bandPath =
    hasBand && series.length > 1
      ? [
          ...series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(2)},${y(Number.isFinite(p.max) ? p.max : p.value).toFixed(2)}`),
          ...series
            .slice()
            .reverse()
            .map((p) => `L${x(p.ts).toFixed(2)},${y(Number.isFinite(p.min) ? p.min : p.value).toFixed(2)}`),
          'Z',
        ].join(' ')
      : null;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: padding.top + ratio * innerHeight,
    value: bounds.max - ratio * bounds.span,
  }));

  function handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left - padding.left) / innerWidth, 0), 1);
    const target = ts0 + ratio * tsSpan;
    let best = series[0];
    for (const point of series) {
      if (Math.abs(point.ts - target) < Math.abs(best.ts - target)) best = point;
    }
    setHover({ ...best, x: x(best.ts) });
  }

  return (
    <div ref={ref} className="chart" style={{ height }}>
      <svg width={width} height={height} onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        {gridLines.map((line) => (
          <g key={line.value}>
            <line x1={padding.left} x2={padding.left + innerWidth} y1={line.y} y2={line.y} className="chart__grid" />
            <text x={padding.left + innerWidth + 6} y={line.y + 4} className="chart__axis">
              {formatValue(line.value, { decimals })}
            </text>
          </g>
        ))}

        {bandPath && <path d={bandPath} fill={color} opacity="0.16" />}
        <path d={areaPath} fill={color} opacity="0.1" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        <text x={padding.left} y={height - 8} className="chart__axis">
          {formatTick(ts0, bucket)}
        </text>
        <text x={padding.left + innerWidth} y={height - 8} textAnchor="end" className="chart__axis">
          {formatTick(ts1, bucket)}
        </text>
        <text x={padding.left + innerWidth + 6} y={padding.top - 4} className="chart__unit">
          {unit}
        </text>

        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={padding.top} y2={padding.top + innerHeight} className="chart__crosshair" />
            <circle cx={hover.x} cy={y(hover.value)} r="4" fill={color} stroke="#0b1220" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hover && (
        <div className="chart__tooltip" style={{ left: Math.min(hover.x + 12, Math.max(width - 150, 0)) }}>
          <strong>
            {formatValue(hover.value, { decimals })} {unit}
          </strong>
          <span>{formatTick(hover.ts, bucket)}</span>
        </div>
      )}
    </div>
  );
}

export default LineChart;
