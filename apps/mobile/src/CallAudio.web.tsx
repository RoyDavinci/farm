import { useEffect, useRef } from 'react';
export default function CallAudio({ stream }: { stream: any }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audio.current) {
      audio.current.srcObject = stream;
      void audio.current.play().catch(() => {});
    }
    return () => {
      if (audio.current) audio.current.srcObject = null;
    };
  }, [stream]);
  return <audio ref={audio} autoPlay controls aria-label="Voice call audio" />;
}
