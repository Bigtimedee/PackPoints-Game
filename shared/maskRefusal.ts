/** Boxes stored with a v4.6 bake refusal. Pixels are the upright source the resolver measured. */

export interface MaskPlateBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MaskRefusalOcrBox extends MaskPlateBox {
  text: string;
  /** Tesseract word confidence, 0–100. Null when the caller did not measure it. */
  confidence: number | null;
  zone: "top" | "middle" | "bottom";
}

export interface MaskRefusalCandidate {
  id: string;
  box: MaskPlateBox | null;
  accepted: boolean;
  why: string;
}
