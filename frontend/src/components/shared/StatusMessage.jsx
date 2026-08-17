function StatusMessage({
  type = 'info',
  title,
  message,
  action,
  actionLabel,
}) {
  const roleMap = {
    loading: 'status',
    success: 'status',
    empty: 'status',
    error: 'alert',
    info: 'status',
  }

  return (
    <section
      className={`shared-status shared-status-${type}`}
      role={roleMap[type] || 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <div>
        <h2>{title}</h2>

        {message && <p>{message}</p>}
      </div>

      {action && actionLabel && (
        <button
          type="button"
          className="primary-button"
          onClick={action}
        >
          {actionLabel}
        </button>
      )}
    </section>
  )
}

export function LoadingState({ title = 'Loading...', message }) {
  return (
    <StatusMessage
      type="loading"
      title={title}
      message={message}
    />
  )
}

export function EmptyState({
  title = 'Nothing to show',
  message,
}) {
  return (
    <StatusMessage
      type="empty"
      title={title}
      message={message}
    />
  )
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}) {
  return (
    <StatusMessage
      type="error"
      title={title}
      message={message}
      action={onRetry}
      actionLabel="Retry"
    />
  )
}

export function SuccessState({
  title = 'Success',
  message,
}) {
  return (
    <StatusMessage
      type="success"
      title={title}
      message={message}
    />
  )
}