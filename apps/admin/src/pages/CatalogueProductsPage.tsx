import { ImagePlus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request, upload } from '../api';
import { Empty, Toolbar } from '../ui';

/**
 * The shared product catalogue sellers pick from. Staff add products and photos; seller photos
 * appear here too. "Needs photos" lists products sellers stock that have no photo, or whose photos
 * are already on 10+ listings (so the same picture is everywhere).
 */
export default function CatalogueProductsPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  const load = useCallback(
    () =>
      void request('get', '/admin/catalogue-products', {
        query: { q: search, needs_photos: filter === 'NEEDS PHOTOS' ? 'true' : 'false' } as any,
      })
        .then((r) => setRows(r as any[]))
        .catch((e) => setError((e as Error).message)),
    [search, filter, setError],
  );
  useEffect(load, [load]);
  const act = (fn: () => Promise<unknown>, message: string) =>
    void action(async () => {
      await fn();
      load();
    }, message);
  return (
    <section className="card">
      <Toolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search products"
        options={['ALL', 'NEEDS PHOTOS']}
        filter={filter}
        setFilter={setFilter}
      />
      {!rows.length ? (
        <Empty title="Nothing here" text="No products match." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Photos (listings using each)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                    <small>
                      {p.category} · per {p.unit} · {p.listings} listing
                      {p.listings === 1 ? '' : 's'}
                      {p.active ? '' : ' · switched off'}
                    </small>
                  </td>
                  <td>
                    <div className="row-actions">
                      {p.photos.map((f: any) => (
                        <span
                          key={f.id}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <img
                            src={f.url}
                            alt=""
                            width={44}
                            height={44}
                            style={{ objectFit: 'cover', borderRadius: 6 }}
                          />
                          <small>
                            {f.uses}× · {f.source.toLowerCase()}
                          </small>
                          <button
                            className="secondary compact"
                            title="Remove this photo"
                            disabled={busy}
                            onClick={() =>
                              window.confirm(
                                'Remove this photo? Listings using it switch to another.',
                              ) &&
                              act(
                                () =>
                                  request('post', '/admin/catalogue-photos/{id}/remove', {
                                    params: { id: f.id },
                                  }),
                                'Photo removed.',
                              )
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      ))}
                      {!p.photos.length && <small>No photo yet</small>}
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <label className="secondary compact button-like">
                        <ImagePlus size={14} /> Add photo
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file)
                              act(async () => {
                                const media = await upload<{ url: string }>(
                                  '/media',
                                  'image',
                                  file,
                                );
                                await request('post', '/admin/catalogue-products/{id}/photos', {
                                  params: { id: p.id },
                                  body: { url: media.url },
                                });
                              }, 'Photo added; listings without a photo now show it.');
                          }}
                        />
                      </label>
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() =>
                          act(
                            () =>
                              request('post', '/admin/catalogue-products/{id}/active', {
                                params: { id: p.id },
                                body: { active: !p.active },
                              }),
                            p.active ? 'Product switched off.' : 'Product switched on.',
                          )
                        }
                      >
                        {p.active ? 'Switch off' : 'Switch on'}
                      </button>
                    </div>
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
