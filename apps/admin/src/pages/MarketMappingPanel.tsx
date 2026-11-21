import { useEffect, useState } from 'react';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
export default function MarketMappingPanel() {
  const { action, busy, setError } = useAdmin();
  const [data, setData] = useState<any>({ markets: [], waypoints: [], paths: [] }),
    [node, setNode] = useState({
      id: undefined as string | undefined,
      market_id: '',
      label: '',
      kind: 'ENTRANCE' as 'ENTRANCE' | 'LANDMARK' | 'SECTION' | 'STALL',
      latitude: '',
      longitude: '',
      verified: false,
      active: true,
    }),
    [path, setPath] = useState({
      market_id: '',
      from_id: '',
      to_id: '',
      metres: '',
      instructions: '',
      accessible: true,
      active: true,
    });
  const load = () => request('get', '/admin/markets/mapping').then(setData);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card">
      <h2>Verified market landmarks and walkways</h2>
      <p>
        Map actual entrances, sections and stalls after field verification. Unverified points do not
        appear in navigation. Keep residential collection addresses out of the public market map.
      </p>
      <h3>Landmark / stall</h3>
      <label>
        Market
        <select
          value={node.market_id}
          onChange={(e) => setNode({ ...node, market_id: e.target.value, id: undefined })}
        >
          <option value="">Choose market</option>
          {data.markets.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.city}
            </option>
          ))}
        </select>
      </label>
      <label>
        Label
        <input value={node.label} onChange={(e) => setNode({ ...node, label: e.target.value })} />
      </label>
      <label>
        Type
        <select
          value={node.kind}
          onChange={(e) => setNode({ ...node, kind: e.target.value as typeof node.kind })}
        >
          {['ENTRANCE', 'LANDMARK', 'SECTION', 'STALL'].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        Latitude
        <input
          value={node.latitude}
          onChange={(e) => setNode({ ...node, latitude: e.target.value })}
        />
      </label>
      <label>
        Longitude
        <input
          value={node.longitude}
          onChange={(e) => setNode({ ...node, longitude: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={node.verified}
          onChange={(e) => setNode({ ...node, verified: e.target.checked })}
        />
        Field-verified coordinates
      </label>
      <label>
        <input
          type="checkbox"
          checked={node.active}
          onChange={(e) => setNode({ ...node, active: e.target.checked })}
        />
        Active
      </label>
      <button
        disabled={
          busy ||
          !node.market_id ||
          node.label.trim().length < 2 ||
          !node.latitude ||
          !node.longitude
        }
        onClick={() =>
          void action(async () => {
            await request('put', '/admin/markets/waypoints', {
              body: { ...node, latitude: Number(node.latitude), longitude: Number(node.longitude) },
            });
            await load();
          }, 'Map point saved.')
        }
      >
        Save point
      </button>
      {data.waypoints
        .filter((n: any) => n.market_id === node.market_id)
        .map((n: any) => (
          <button
            key={n.id}
            onClick={() =>
              setNode({ ...n, latitude: String(n.latitude), longitude: String(n.longitude) })
            }
          >
            {n.label} · {n.kind} · {n.verified ? 'Verified' : 'Unverified'} ·{' '}
            {n.active ? 'Active' : 'Hidden'}
          </button>
        ))}
      <h3>Walkway connection</h3>
      <label>
        Market
        <select
          value={path.market_id}
          onChange={(e) => setPath({ ...path, market_id: e.target.value, from_id: '', to_id: '' })}
        >
          <option value="">Choose market</option>
          {data.markets.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {(['from_id', 'to_id'] as const).map((key) => (
        <label key={key}>
          {key === 'from_id' ? 'From' : 'To'}
          <select value={path[key]} onChange={(e) => setPath({ ...path, [key]: e.target.value })}>
            <option value="">Choose point</option>
            {data.waypoints
              .filter((n: any) => n.market_id === path.market_id)
              .map((n: any) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
          </select>
        </label>
      ))}
      <label>
        Walking distance (metres)
        <input
          type="number"
          value={path.metres}
          onChange={(e) => setPath({ ...path, metres: e.target.value })}
        />
      </label>
      <label>
        Directions
        <textarea
          value={path.instructions}
          onChange={(e) => setPath({ ...path, instructions: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={path.accessible}
          onChange={(e) => setPath({ ...path, accessible: e.target.checked })}
        />
        Step-free route
      </label>
      <label>
        <input
          type="checkbox"
          checked={path.active}
          onChange={(e) => setPath({ ...path, active: e.target.checked })}
        />
        Open walkway
      </label>
      <button
        disabled={busy || !path.from_id || !path.to_id || Number(path.metres) <= 0}
        onClick={() =>
          void action(async () => {
            await request('put', '/admin/markets/paths', {
              body: { ...path, metres: Number(path.metres) },
            });
            await load();
          }, 'Walkway saved.')
        }
      >
        Save walkway
      </button>
      {data.paths
        .filter((p: any) => p.market_id === path.market_id)
        .map((p: any) => (
          <div className="settings-card" key={p.id}>
            <p>
              {data.waypoints.find((n: any) => n.id === p.from_id)?.label} ↔{' '}
              {data.waypoints.find((n: any) => n.id === p.to_id)?.label} · {p.metres} m
            </p>
            <p>{p.instructions}</p>
            <button onClick={() => setPath({ ...p, metres: String(p.metres) })}>
              Edit walkway
            </button>
          </div>
        ))}
    </section>
  );
}
