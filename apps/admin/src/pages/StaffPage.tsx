import { statusLabel } from '@farmers-market/shared';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty } from '../ui';

const roles = [
  ['owner', 'Everything, including settings and staff'],
  ['operations', 'Sellers, documents, listings, markets, users, reports'],
  ['finance', 'Payouts, reconciliation, ledger, disputes, promotions'],
  ['support', 'Disputes, reports, users, bookings, email queue'],
] as const;

export default function StaffPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(
    () =>
      (request('get', '/admin/staff') as Promise<any[]>)
        .then(setRows)
        .catch((e) => setError(e.message)),
    [setError],
  );
  useEffect(() => void load(), [load]);
  const save = (email: string, role: string | null, reason: string) =>
    action(
      async () => {
        await request('post', '/admin/staff', { body: { email, role, reason } });
        await load();
      },
      role ? `Role set to ${role}.` : 'Console access removed.',
    );
  return (
    <div className="settings-grid">
      <section className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.name}</b>
                    <small>{u.email}</small>
                  </td>
                  <td>
                    <Badge status={u.status === 'ACTIVE' ? 'ACTIVE' : u.status} />{' '}
                    {statusLabel(u.staff_role || 'none')}
                  </td>
                  <td>
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(`Reason for removing ${u.name}'s access`);
                        if (reason) void save(u.email, null, reason);
                      }}
                    >
                      Remove access
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty title="No staff yet" text="Add a teammate by email." />}
      </section>
      <section className="card settings-card">
        <h2>Add or change a role</h2>
        <p>The person must already have a Farmers Market account.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save(String(f.get('email')), String(f.get('role')), String(f.get('reason')));
          }}
        >
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Role
            <select name="role" defaultValue="support">
              {roles.map(([value, description]) => (
                <option key={value} value={value}>
                  {statusLabel(value)} — {description}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason (recorded in the audit log)
            <input name="reason" minLength={3} required />
          </label>
          <button className="primary" disabled={busy}>
            Save role <Check size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}
