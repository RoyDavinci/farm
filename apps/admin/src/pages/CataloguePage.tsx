import { useEffect, useState } from 'react';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
export default function CataloguePage() {
  const { action, busy, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]),
    [form, setForm] = useState({ name: '', active: true, rules: '', prohibited_terms: '' });
  const load = () => request('get', '/admin/catalogue').then(setRows);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card">
      <h2>Catalogue categories and content rules</h2>
      <p>
        Inactive categories and listings matching prohibited text are excluded from new purchases.
        Existing orders retain their history. Text rules assist moderation and require human review.
      </p>
      <label>
        Category name
        <input
          value={form.name}
          maxLength={50}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label>
        Seller rules
        <textarea
          value={form.rules}
          maxLength={4000}
          onChange={(e) => setForm({ ...form, rules: e.target.value })}
        />
      </label>
      <label>
        Prohibited phrases (one per line)
        <textarea
          value={form.prohibited_terms}
          onChange={(e) => setForm({ ...form, prohibited_terms: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.target.checked })}
        />
        Available for selling
      </label>
      <button
        disabled={busy || form.name.trim().length < 2}
        onClick={() =>
          void action(async () => {
            await request('put', '/admin/catalogue', {
              body: {
                ...form,
                prohibited_terms: form.prohibited_terms
                  .split('\n')
                  .map((t) => t.trim())
                  .filter(Boolean),
              },
            });
            await load();
          }, 'Category saved.')
        }
      >
        Save category
      </button>
      {rows.map((c) => (
        <div className="settings-card" key={c.name}>
          <h3>
            {c.name} · {c.active ? 'Active' : 'Inactive'}
          </h3>
          <p>{c.rules || 'No additional category rules.'}</p>
          <p>{c.prohibited_terms.length} prohibited phrases</p>
          <button
            onClick={() => setForm({ ...c, prohibited_terms: c.prohibited_terms.join('\n') })}
          >
            Edit
          </button>
        </div>
      ))}
    </section>
  );
}
