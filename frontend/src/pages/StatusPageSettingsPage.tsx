import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useRotateStatusSlug, useStatusPageSettings, useUpdateStatusPage } from '../api/hooks';

export function StatusPageSettingsPage() {
  const settings = useStatusPageSettings();
  const update = useUpdateStatusPage();
  const rotate = useRotateStatusSlug();
  const [title, setTitle] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    if (settings.data) setTitle(settings.data.title);
  }, [settings.data]);

  if (settings.isPending) return <p className="um-muted">Loading…</p>;
  if (settings.isError) return <p className="um-alert">{settings.error.message}</p>;

  const s = settings.data;
  const url = `${window.location.origin}/status/${s.slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the link is selectable anyway */
    }
  }

  function onSave(e: FormEvent) {
    e.preventDefault();
    update.mutate(title);
  }

  return (
    <div className="um-narrow">
      <h1>Status page</h1>
      <p className="um-muted">
        A public page anyone with the link can open. It lists monitors you've chosen to show, with their status
        and 30 days of uptime. URLs and error details stay private.
      </p>

      <section className="um-panel">
        <h2>Your link</h2>
        <div className="um-linkbox">
          <input readOnly value={url} aria-label="Status page link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="um-btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <a href={`/status/${s.slug}`} target="_blank" rel="noopener" className="um-btn um-btn--quiet">
            Open
          </a>
        </div>
        <p className="um-muted">
          {s.publicMonitors === 0 ? (
            <>
              No monitors are shown yet. Turn on "Show on my public status page" when you{' '}
              <Link to="/">edit a monitor</Link>.
            </>
          ) : (
            `${s.publicMonitors} ${s.publicMonitors === 1 ? 'monitor is' : 'monitors are'} shown.`
          )}
        </p>
      </section>

      <section className="um-panel">
        <h2>Page title</h2>
        <form className="um-inline-form" onSubmit={onSave}>
          <input
            maxLength={80}
            value={title}
            aria-label="Page title"
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="um-btn um-btn--primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save title'}
          </button>
        </form>
        {update.isSuccess && !update.isPending && <p className="um-ok">Title saved.</p>}
        {update.error && <p className="um-alert">{update.error.message}</p>}
      </section>

      <section className="um-panel">
        <h2>Change link</h2>
        <p className="um-muted">
          Shared the link somewhere you shouldn't have? Get a new one. The current link stops working within a minute
          (anyone who opened it recently may see a cached copy until then).
        </p>
        {confirmRotate ? (
          <div className="um-actions">
            <button
              type="button"
              className="um-btn um-btn--danger"
              disabled={rotate.isPending}
              onClick={() => rotate.mutate(undefined, { onSuccess: () => setConfirmRotate(false) })}
            >
              Replace link
            </button>
            <button type="button" className="um-btn um-btn--quiet" onClick={() => setConfirmRotate(false)}>
              Keep current link
            </button>
          </div>
        ) : (
          <button type="button" className="um-btn" onClick={() => setConfirmRotate(true)}>
            Get a new link
          </button>
        )}
      </section>
    </div>
  );
}
