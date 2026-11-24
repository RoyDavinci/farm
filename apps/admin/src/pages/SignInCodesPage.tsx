import { KeyRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Empty, Toolbar } from '../ui';

/**
 * People waiting for an email code to finish signing up or signing in. Codes are stored only
 * as hashes, so staff can't look one up: "Get a new code" replaces it and shows the new code
 * here once, to read out to the person (by phone or WhatsApp). Password-reset codes are never
 * shown. Every code issued is in the audit log.
 */
export default function SignInCodesPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]),
    [search, setSearch] = useState(''),
    [issued, setIssued] = useState<Record<string, string>>({});
  const load = useCallback(
    () =>
      void request('get', '/admin/sign-in-codes', { query: { email: search } as any })
        .then((r) => setRows(r as any[]))
        .catch((e) => setError((e as Error).message)),
    [search, setError],
  );
  useEffect(load, [load]);
  // People start a sign-up while staff watch this page: check again every 10 seconds.
  useEffect(() => {
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <section className="card">
      <Toolbar search={search} setSearch={setSearch} placeholder="Search by email or phone" />
      <p className="muted">
        Someone didn’t get their code by email or text? Ask them to stay on the code screen, then tap{' '}
        <b>Get a new code</b> and read it to them. The old code stops working. Codes expire
        10 minutes after they started.
      </p>
      {!rows.length ? (
        <Empty
          icon={<KeyRound />}
          title="Nobody waiting"
          text="Sign-ups and sign-ins waiting for a code show here."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>For</th>
                <th>Started</th>
                <th>Code</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name || '—'}</b>
                    <small>{r.email}</small>
                  </td>
                  <td>
                    <span className="badge">
                      {r.purpose === 'register' ? 'Sign up' : 'Sign in'}
                    </span>
                    {r.attempts > 0 && (
                      <small>
                        {r.attempts} wrong tr{r.attempts === 1 ? 'y' : 'ies'}
                      </small>
                    )}
                  </td>
                  <td>
                    {new Date(r.created_at).toLocaleTimeString()}
                    <small>expires {new Date(r.expires_at).toLocaleTimeString()}</small>
                  </td>
                  <td>
                    {issued[r.id] ? (
                      <b style={{ fontSize: 22, letterSpacing: 4, fontFamily: 'monospace' }}>
                        {issued[r.id]}
                      </b>
                    ) : (
                      <button
                        className="compact"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            const d = (await request('post', '/admin/sign-in-codes/{id}/issue', {
                              params: { id: r.id },
                            })) as any;
                            setIssued((m) => ({ ...m, [r.id]: d.code }));
                          }, 'New code ready. Read it to them now.')
                        }
                      >
                        <KeyRound size={14} /> Get a new code
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
