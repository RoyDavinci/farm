import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MapPanelProps } from './MapPanel.types';
export default function MapPanel(props: MapPanelProps) {
  if (!props.token)
    return (
      <View style={{ padding: 18, backgroundColor: '#edf2e4', borderRadius: 10 }}>
        <Text style={{ color: '#788b64', fontSize: 12 }}>
          Configure a Mapbox public token to display the map. GPS and coordinate entry are
          available.
        </Text>
      </View>
    );
  const data = JSON.stringify({ ...props, onPick: undefined, onMarker: undefined }).replaceAll(
    '<',
    '\\u003c',
  );
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.js"></script><link href="https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.css" rel="stylesheet"><style>html,body,#map{margin:0;width:100%;height:100%}</style></head><body><div id="map"></div><script>const p=${data};mapboxgl.accessToken=p.token;const map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/streets-v12',center:[p.longitude??3.3792,p.latitude??6.5244],zoom:p.selectable?12:10});for(const m of p.markers||[]){const el=document.createElement('button');el.textContent='●';el.style.cssText='background:#365b38;color:white;border:2px solid white;border-radius:50%;width:28px;height:28px';el.onclick=()=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'marker',id:m.id}));new mapboxgl.Marker({element:el}).setLngLat([m.longitude,m.latitude]).addTo(map);}if(p.selectable){const chosen=new mapboxgl.Marker({color:'#a98e47'}).setLngLat([p.longitude??3.3792,p.latitude??6.5244]).addTo(map);map.on('click',e=>{chosen.setLngLat(e.lngLat);window.ReactNativeWebView.postMessage(JSON.stringify({type:'pick',latitude:e.lngLat.lat,longitude:e.lngLat.lng}));});}</script></body></html>`;
  return (
    <View style={{ height: 300, borderRadius: 12, overflow: 'hidden' }}>
      <WebView
        originWhitelist={['about:blank']}
        source={{ html }}
        onShouldStartLoadWithRequest={(r) => r.url === 'about:blank'}
        onMessage={(e) => {
          try {
            const d = JSON.parse(e.nativeEvent.data);
            if (
              d.type === 'pick' &&
              typeof d.latitude === 'number' &&
              typeof d.longitude === 'number'
            )
              props.onPick?.(d.latitude, d.longitude);
            if (d.type === 'marker' && typeof d.id === 'string') props.onMarker?.(d.id);
          } catch {}
        }}
      />
    </View>
  );
}
