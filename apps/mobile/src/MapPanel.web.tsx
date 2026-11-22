import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import type { MapPanelProps } from './MapPanel.types';
export default function MapPanel({
  token,
  latitude = 6.5244,
  longitude = 3.3792,
  markers = [],
  selectable,
  onPick,
  onMarker,
}: MapPanelProps) {
  const element = useRef<HTMLDivElement>(null),
    callbacks = useRef({ onPick, onMarker });
  callbacks.current = { onPick, onMarker };
  useEffect(() => {
    if (!token || !element.current) return;
    const map = new mapboxgl.Map({
      container: element.current,
      accessToken: token,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [longitude, latitude],
      zoom: selectable ? 12 : 10,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    for (const pin of markers) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = '●';
      el.style.cssText =
        'background:#1f754a;color:white;border:2px solid white;border-radius:50%;width:28px;height:28px;cursor:pointer';
      el.title = pin.label;
      el.setAttribute('aria-label', pin.label);
      el.onclick = (e) => {
        e.stopPropagation();
        callbacks.current.onMarker?.(pin.id);
      };
      new mapboxgl.Marker({ element: el }).setLngLat([pin.longitude, pin.latitude]).addTo(map);
    }
    let chosen: mapboxgl.Marker | undefined;
    if (selectable) {
      chosen = new mapboxgl.Marker({ color: '#b08740' })
        .setLngLat([longitude, latitude])
        .addTo(map);
      map.on('click', (e) => {
        chosen?.setLngLat(e.lngLat);
        callbacks.current.onPick?.(e.lngLat.lat, e.lngLat.lng);
      });
    }
    return () => map.remove();
  }, [token, latitude, longitude, JSON.stringify(markers), selectable]);
  if (!token)
    return (
      <View style={{ padding: 18, backgroundColor: '#e2f4eb', borderRadius: 10 }}>
        <Text style={{ color: '#477d62', fontSize: 12 }}>
          Map preview needs a Mapbox public token. GPS, coordinates and area search still work.
        </Text>
      </View>
    );
  return (
    <div
      ref={element}
      aria-label={selectable ? 'Choose your pickup pin' : 'Approximate seller map'}
      style={{ height: 300, width: '100%', borderRadius: 12, overflow: 'hidden' }}
    />
  );
}
