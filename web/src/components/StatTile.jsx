import { describeCapability, isQualityOk } from '../utils/capabilities';
import { formatValue, formatRelative } from '../utils/formatters';
import Sparkline from './Sparkline';

/**
 * One measurement tile.
 *
 * The tile knows nothing about hardware: it receives a capability NAME and a
 * reading, and looks up its own label/unit/colour. That is what lets an
 * `agriculture` or `industrial` device render without a frontend change (§10.2).
 */
export function StatTile({ capability, reading, trend = [], time }) {
  const meta = describeCapability(capability);
  const raw = reading ? reading.value : null;
  const quality = reading ? reading.quality : null;
  const healthy = isQualityOk(quality);

  // Absolute pressure is unreadable in Pa - show hPa but keep the unit honest.
  const displayValue =
    raw === null || raw === undefined
      ? '—'
      : capability === 'pressure'
        ? formatValue(Number(raw) / 100, { decimals: 1 })
        : formatValue(raw, { decimals: meta.decimals });
  const displayUnit = capability === 'pressure' ? 'hPa' : meta.unit;

  return (
    <article className={`tile ${healthy ? '' : 'tile--warn'}`.trim()} style={{ '--tile-color': meta.color }}>
      <header className="tile__head">
        <span className="tile__icon" aria-hidden="true">
          {meta.icon}
        </span>
        <span className="tile__label">{meta.label}</span>
        {!healthy && <span className="tile__quality">{quality}</span>}
      </header>

      <div className="tile__value">
        {displayValue}
        <span className="tile__unit">{displayUnit}</span>
      </div>

      <footer className="tile__foot">
        <Sparkline values={trend} color={meta.color} />
        <span className="tile__time">{formatRelative(time)}</span>
      </footer>
    </article>
  );
}

export default StatTile;
