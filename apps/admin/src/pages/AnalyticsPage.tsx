import { useEffect, useState } from 'react';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
export default function AnalyticsPage() {
  const { setError } = useAdmin();
  const [data, setData] = useState<any>(null);
  const load = () => request('get', '/admin/analytics').then(setData);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Marketplace operational analytics</h2>
        <button onClick={() => void load().catch((e) => setError(e.message))}>Refresh</button>
      </div>
      <p>
        Rolling 30-day activity unless labelled otherwise. Instrumentation starts from this feature
        release; earlier searches and enquiries cannot be reconstructed.
      </p>
      {data && (
        <>
          {Object.entries(data)
            .filter(([k]) => !['notes', 'window_days'].includes(k))
            .map(([group, metrics]) => (
              <div className="settings-card" key={group}>
                <h3>{group}</h3>
                <div className="metrics">
                  {Object.entries(metrics as object).map(([key, value]) => (
                    <div className="metric" key={key}>
                      <span>{key.replaceAll('_', ' ')}</span>
                      <strong>{Number(value).toLocaleString()}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          <div className="settings-card">
            <h3>How to read these figures</h3>
            {data.notes.map((n: string) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
