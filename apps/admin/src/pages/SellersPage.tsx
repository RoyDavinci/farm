import { statusLabel, type Seller } from '@ahia/shared';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { useAdmin } from '../AdminContext';
import { Badge, Empty, Toolbar } from '../ui';
export default function SellersPage({
  sellers,
}: {
  sellers: (Seller & { name: string; email: string })[];
}) {
  const { busy, action, go, openTimeline, openReview } = useAdmin();
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  const sellerRows = sellers.filter(
    (s) =>
      (filter === 'ALL' || s.status === filter) &&
      `${s.business_name} ${s.city} ${s.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="card">
      <Toolbar
        search={search}
        setSearch={setSearch}
        filter={filter}
        setFilter={setFilter}
        options={['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']}
        placeholder="Search sellers or cities"
      />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Seller</th>
              <th>Location</th>
              <th>Type</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sellerRows.map((s) => (
              <tr key={s.user_id}>
                <td>
                  <b>{s.business_name}</b>
                  <small>
                    {s.name} · {s.email}
                  </small>
                </td>
                <td>
                  {s.area}, {s.city}
                </td>
                <td>{statusLabel(s.business_type)}</td>
                <td>
                  <Badge status={s.status} />
                </td>
                <td>
                  <button className="secondary compact" onClick={() => openReview(s)}>
                    Review <ArrowUpRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sellerRows.length && (
        <Empty
          title="No sellers found"
          text="New registrations and their verification status appear here."
        />
      )}
    </section>
  );
}
