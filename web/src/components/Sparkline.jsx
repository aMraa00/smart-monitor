/**
 * Tiny trend line for tiles. No axes, no interaction - just direction.
 * Accepts plain numbers or { value } readings.
 */
export function Sparkline({ values = [], color = '#38bdf8', width = 120, height = 34 }) {
  const points = values
    .map((v) => (typeof v === 'object' && v !== null ? v.value : v))
    .filter((v) => Number.isFinite(Number(v)))
    .map(Number);

  if (points.length < 2) {
    return <div className="sparkline sparkline--empty" style={{ width, height }} aria-hidden="true" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);

  const d = points
    .map((value, index) => {
      const px = index * stepX;
      const py = height - 3 - ((value - min) / span) * (height - 6);
      return `${index === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  const rising = points[points.length - 1] >= points[0];

  return (
    <svg className="sparkline" width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" opacity={rising ? 1 : 0.75} />
    </svg>
  );
}

export default Sparkline;
