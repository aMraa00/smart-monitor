/**
 * Friendly placeholder for a legitimately empty state.
 * Never used for errors - those render through `error` text on the page.
 */
export function EmptyState({ icon = '📭', title, hint, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="empty-state__title">{title}</p>
      {hint && <p className="empty-state__hint">{hint}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export default EmptyState;
