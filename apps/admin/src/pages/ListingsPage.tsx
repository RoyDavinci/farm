import { money, type Listing } from '@zuru/shared';
import { useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty, Toolbar } from '../ui';
export default function ListingsPage({ listings }: { listings: Listing[] }) {
  const { busy, action, go, openTimeline, openReview } = useAdmin();
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  return (
    <section className="card">
      <Toolbar search={search} setSearch={setSearch} placeholder="Search products or sellers" />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Produce</th>
              <th>Seller</th>
              <th>Price</th>
              <th>Available stock</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listings
              .filter((l) =>
                `${l.title} ${l.business_name}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((l) => (
                <tr key={l.id}>
                  <td>
                    <b>{l.title}</b>
                    <small>{l.category}</small>
                  </td>
                  <td>{l.business_name}</td>
                  <td>
                    {money(l.price_kobo)} / {l.unit}
                  </td>
                  <td>
                    {l.stock} {l.unit}
                  </td>
                  <td>
                    <Badge status={l.status} />
                  </td>
                  <td>
                    <button
                      disabled={busy}
                      className="secondary compact"
                      onClick={() => {
                        const reason = window.prompt('Reason for changing listing visibility');
                        if (reason)
                          void action(
                            () =>
                              request('post', '/admin/listings/{id}/moderate', {
                                params: { id: l.id },
                                body: {
                                  status: l.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                                  reason,
                                },
                              }),
                            'Listing updated.',
                          );
                      }}
                    >
                      {l.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!listings.length && (
        <Empty
          title="The market is getting ready"
          text="Approved sellers can add their first product listings from the mobile app."
        />
      )}
    </section>
  );
}
