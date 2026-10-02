/** Indeterminate progress indicator used while a request is in flight. */
export function Spinner({ label = 'Loading', size = 20 }) {
  return (
    <span className="spinner" role="status" aria-label={label} style={{ width: size, height: size }} />
  );
}

export function LoadingBlock({ label = 'Loading' }) {
  return (
    <div className="loading-block">
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}

export default Spinner;
