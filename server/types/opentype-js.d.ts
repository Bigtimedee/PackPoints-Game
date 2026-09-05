declare module "opentype.js" {
  export interface Path {
    toPathData(options?: number | { decimalPlaces?: number; flipY?: boolean }): string;
  }

  export interface Font {
    getPath(text: string, x: number, y: number, fontSize: number): Path;
    getAdvanceWidth(text: string, fontSize: number): number;
  }

  export function loadSync(path: string): Font;
  export function parse(buffer: Buffer | ArrayBuffer): Font;

  const opentype: {
    loadSync: typeof loadSync;
    parse: typeof parse;
  };

  export default opentype;
}
