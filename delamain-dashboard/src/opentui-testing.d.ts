declare module "@opentui/core/testing" {
  export function createTestRenderer(options: {
    height: number;
    width: number;
  }): Promise<{
    captureCharFrame(): string;
    renderOnce(): Promise<void>;
    renderer: any;
  }>;
}
