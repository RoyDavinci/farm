export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
}
export interface MapPanelProps {
  token: string | null;
  latitude?: number;
  longitude?: number;
  markers?: MapMarker[];
  selectable?: boolean;
  onPick?: (latitude: number, longitude: number) => void;
  onMarker?: (id: string) => void;
}
