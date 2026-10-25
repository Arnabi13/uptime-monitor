import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateMonitor, useMonitor, useUpdateMonitor } from '../api/hooks';
import type { Monitor, MonitorInput, MonitorMethod } from '../api/types';
import { formatInterval } from '../lib/format';

const INTERVALS = [60, 300, 900, 1800, 3600, 21_600, 86_400];
const TIMEOUTS = [5000, 10_000, 15_000, 30_000];

interface FormState {
  name: string;
  url: string;
  intervalSeconds: number;
  method: MonitorMethod;
  timeoutMs: number;
  expectedStatusCode: string; // '' = any 2xx/3xx
  isPublic: boolean;
}

const EMPTY: FormState = {
  name: '',
  url: '',
  intervalSeconds: 300,
  method: 'HEAD',
  timeoutMs: 10_000,
  expectedStatusCode: '',
  isPublic: false,
};

function fromMonitor(m: Monitor): FormState {
  return {
    name: m.name,
    url: m.url,
    intervalSeconds: m.intervalSeconds,
    method: m.method,
    timeoutMs: m.timeoutMs,
    expectedStatusCode: m.expectedStatusCode === null ? '' : String(m.expectedStatusCode),
    isPublic: m.isPublic,
  };
}

function toInput(f: FormState): MonitorInput {
  return {
    name: f.name.trim(),
    // Let people paste "example.com" — the API requires a scheme.
    url: /^https?:\/\//i.test(f.url.trim()) ? f.url.trim() : `https://${f.url.trim()}`,
    intervalSeconds: f.intervalSeconds,
    method: f.method,
    timeoutMs: f.timeoutMs,
    expectedStatusCode: f.expectedStatusCode === '' ? null : Number(f.expectedStatusCode),
    isPublic: f.isPublic,
  };
}

/** Only send what changed, so an edit to the name doesn't re-run the URL's DNS checks. */
function diff(before: MonitorInput, after: MonitorInput): Partial<MonitorInput> {
  const out: Partial<MonitorInput> = {};
  for (const key of Object.keys(after) as (keyof MonitorInput)[]) {
    if (after[key] !== before[key]) (out as Record<string, unknown>)[key] = after[key];
  }
  return out;
}

export function NewMonitorPage() {
  const navigate = useNavigate();
  const create = useCreateMonitor();
  return (
    <MonitorForm
      title="Add monitor"
      submitLabel="Add monitor"
      initial={EMPTY}
      pending={create.isPending}
      error={create.error?.message ?? null}
      cancelTo="/"
      onSubmit={(f) => create.mutate(toInput(f), { onSuccess: (m) => navigate(`/monitors/${m.id}`) })}
    />
  );
}

export function EditMonitorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const monitor = useMonitor(id);
  const update = useUpdateMonitor(id);

  if (monitor.isPending) return <p className="um-muted">Loading…</p>;
  if (monitor.isError) return <p className="um-alert">{monitor.error.message}</p>;

  const initial = fromMonitor(monitor.data);
  return (
    <MonitorForm
      title={`Edit ${monitor.data.name}`}
      submitLabel="Save changes"
      initial={initial}
      pending={update.isPending}
      error={update.error?.message ?? null}
      cancelTo={`/monitors/${id}`}
      onSubmit={(f) => {
        const changes = diff(toInput(initial), toInput(f));
        if (Object.keys(changes).length === 0) return navigate(`/monitors/${id}`);
        update.mutate(changes, { onSuccess: () => navigate(`/monitors/${id}`) });
      }}
    />
  );
}

function MonitorForm(props: {
  title: string;
  submitLabel: string;
  initial: FormState;
  pending: boolean;
  error: string | null;
  cancelTo: string;
  onSubmit: (f: FormState) => void;
}) {
  const [f, setF] = useState<FormState>(props.initial);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((s) => ({ ...s, [key]: value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    props.onSubmit(f);
  }

  return (
    <div className="um-narrow">
      <Link to={props.cancelTo} className="um-back">
        Back
      </Link>
      <h1>{props.title}</h1>

      <form className="um-form um-panel" onSubmit={onSubmit}>
        <label className="um-field">
          <span>Name</span>
          <input
            required
            maxLength={100}
            placeholder="Marketing site"
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </label>

        <label className="um-field">
          <span>URL</span>
          <input
            required
            inputMode="url"
            maxLength={2048}
            placeholder="https://example.com/health"
            value={f.url}
            onChange={(e) => set('url', e.target.value)}
          />
          <small>Must be reachable from the public internet.</small>
        </label>

        <fieldset className="um-field">
          <legend>Check every</legend>
          <div className="um-segmented">
            {INTERVALS.map((s) => (
              <label key={s} className={f.intervalSeconds === s ? 'is-on' : ''}>
                <input
                  type="radio"
                  name="interval"
                  value={s}
                  checked={f.intervalSeconds === s}
                  onChange={() => set('intervalSeconds', s)}
                />
                {formatInterval(s)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="um-check">
          <input type="checkbox" checked={f.isPublic} onChange={(e) => set('isPublic', e.target.checked)} />
          <span>
            Show on my public status page
            <small>Visitors see the name and status only, never the URL.</small>
          </span>
        </label>

        <details className="um-details">
          <summary>Request settings</summary>
          <div className="um-grid3">
            <label className="um-field">
              <span>Method</span>
              <select value={f.method} onChange={(e) => set('method', e.target.value as MonitorMethod)}>
                <option value="HEAD">HEAD (lighter)</option>
                <option value="GET">GET</option>
              </select>
            </label>
            <label className="um-field">
              <span>Timeout</span>
              <select value={f.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))}>
                {TIMEOUTS.map((t) => (
                  <option key={t} value={t}>
                    {t / 1000} seconds
                  </option>
                ))}
              </select>
            </label>
            <label className="um-field">
              <span>Expected status</span>
              <input
                type="number"
                min={100}
                max={599}
                placeholder="Any 2xx or 3xx"
                value={f.expectedStatusCode}
                onChange={(e) => set('expectedStatusCode', e.target.value)}
              />
            </label>
          </div>
          <small className="um-muted">
            Some servers reject HEAD requests. If a working site shows as down, switch to GET.
          </small>
        </details>

        {props.error && (
          <p className="um-alert" role="alert">
            {props.error}
          </p>
        )}

        <div className="um-actions">
          <button type="submit" className="um-btn um-btn--primary" disabled={props.pending}>
            {props.pending ? 'Saving…' : props.submitLabel}
          </button>
          <Link to={props.cancelTo} className="um-btn um-btn--quiet">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
