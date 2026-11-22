import { useVideoPlayer, VideoView } from 'expo-video';
import { View, Text } from 'react-native';
export default function StatusVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <View>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: false }}
        style={{ width: '100%', height: 360, backgroundColor: '#0e3220' }}
        accessibilityLabel="Product status video"
      />
      <Text style={{ fontSize: 11, color: '#567264', marginTop: 5 }}>
        Tap play to watch. Videos do not play automatically.
      </Text>
    </View>
  );
}
