export type StitchType = 'running' | 'satin' | 'fill';
export type Tool =
  | 'select'
  | 'rect'
  | 'circle'
  | 'triangle'
  | 'star'
  | 'path'
  | 'freehand'
  | 'text';

export interface StitchProperties {
  stitchType: StitchType;
  angle: number;    // 0–180 degrees
  density: number;  // pixel spacing between stitch lines
  color: string;    // hex color
}

export const DEFAULT_STITCH_PROPS: StitchProperties = {
  stitchType: 'fill',
  angle: 45,
  density: 8,
  color: '#3b5bdb',
};

export interface SerializedShape {
  type: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  radius?: number;
  angle: number;
  pathData?: string;
  stitchProps: StitchProperties;
}

export interface CanvasObjectInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  selected: boolean;
  color: string;
}

export interface ExportData {
  shapes: SerializedShape[];
  hoopCenterX: number;
  hoopCenterY: number;
  hoopSize: number;       // pixels
  hoopPhysicalMM: number; // default 150
}
