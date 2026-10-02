/**
 * Small status pill.
 * tone: ok | warn | danger | neutral | info
 */
export function Badge({ tone = 'neutral', children, title }) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export default Badge;
