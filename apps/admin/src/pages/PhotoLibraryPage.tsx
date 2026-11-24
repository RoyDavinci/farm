import { ImagePlus, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request, upload } from '../api';
import { Empty, Toolbar } from '../ui';

/**
 * Products sellers listed without a photo. Each shows matching photos from the shared library
 * (Product catalogue); "Use this" puts one on the listing, marked as a representative photo, and
 * tells the seller. "Upload & clean" takes a new photo, cleans it (upright, trimmed, centred on
 * white) and saves it to the library under this product, so the next seller gets it too.
 */
export default function PhotoLibraryPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<any[] | null>(null),
    [search, setSearch] = useState('');
  const load = useCallback(
    () =>
      void request('get', '/admin/catalogue-products/bare-listings', { query: { q: search } })
        .then((r) => setRows(r as any[]))
        .catch((e) => setError((e as Error).message)),
    [search, setError],
  );
  useEffect(load, [load]);
  const act = (fn: () => Promise<unknown>, message: string) =>
    void action(async () => {
      await fn();
      load();
    }, message);
  const matched = (rows || []).filter((r) => r.suggestions.length).length;
  return (
    <section className="card">
      <Toolbar search={search} setSearch={setSearch} placeholder="Search products or shops" />
      <div
        className="row-actions"
        style={{ justifyContent: 'space-between', margin: '8px 0 14px' }}
      >
        <small>
          {rows ? `${rows.length} product${rows.length === 1 ? '' : 's'} without a photo` : '…'}
          {rows?.length ? ` · ${matched} with a match in the library` : ''}
        </small>
        <button
          disabled={busy || !matched}
          onClick={() =>
            window.confirm(
              `Give ${matched} product${matched === 1 ? '' : 's'} their best library photo? Sellers are told and can replace it.`,
            ) &&
            act(async () => {
              const r = await request('post', '/admin/catalogue-products/bare-listings/fill', {
                body: {},
              });
              return r;
            }, 'Photos added to every product with a match.')
          }
        >
          <Wand2 size={14} /> Fill all with best match
        </button>
      </div>
      {rows && !rows.length ? (
        <Empty title="Every product has a photo" text="Nothing to do here." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Matching photos in the library</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((l) => (
                <tr key={l.id}>
                  <td>
                    <b>{l.title}</b>
                    <small>
                      {l.business_name}
                      {l.area ? ` · ${l.area}` : ''} · {l.category} · per {l.unit}
                    </small>
                  </td>
                  <td>
                    <div className="row-actions">
                      {l.suggestions.map((f: any) => (
                        <span
                          key={f.id}
                          style={{
                            display: 'inline-flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <img
                            src={f.thumbnail_url}
                            alt={f.product}
                            title={f.product}
                            width={64}
                            height={64}
                            style={{
                              objectFit: 'cover',
                              borderRadius: 10,
                              border: '1px solid #dfeee6',
                            }}
                          />
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() =>
                              act(
                                () =>
                                  request(
                                    'post',
                                    '/admin/catalogue-products/bare-listings/{id}/photo',
                                    { params: { id: l.id }, body: { photo_id: f.id } },
                                  ),
                                `Photo added to “${l.title}”. The seller was told.`,
                              )
                            }
                          >
                            Use this
                          </button>
                        </span>
                      ))}
                      {!l.suggestions.length && <small>No match yet: upload one</small>}
                    </div>
                  </td>
                  <td>
                    <label className="secondary compact button-like">
                      <ImagePlus size={14} /> Upload & clean
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            act(async () => {
                              const media = await upload<{ url: string }>(
                                '/media?clean=true',
                                'image',
                                file,
                              );
                              await request(
                                'post',
                                '/admin/catalogue-products/bare-listings/{id}/photo',
                                { params: { id: l.id }, body: { url: media.url } },
                              );
                            }, `Photo cleaned, added to “${l.title}” and saved to the library.`);
                        }}
                      />
                    </label>
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
