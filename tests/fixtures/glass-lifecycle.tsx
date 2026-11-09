import { createRoot, type Root } from 'react-dom/client';
import { GlassSurface } from '../../src/liquidglass/GlassSurface';
import { LiquidGlass } from '../../src/liquidglass/vendor/index.js';
let root: Root | undefined;
const decode = HTMLImageElement.prototype.decode;
const init = LiquidGlass.init;
let rejectFirst: ((error: Error) => void) | undefined;
let firstImage = true;
Object.assign(window, {
  showGlass() {
    root = createRoot(document.getElementById('root')!);
    root.render(
      <GlassSurface>
        <div style={{ padding: 20 }}>Readable source and buttons stay in the DOM.</div>
      </GlassSurface>,
    );
  },
  hideGlass() {
    root?.unmount();
    root = undefined;
  },
  delayFirstInit(rejectable: boolean) {
    HTMLImageElement.prototype.decode = function () {
      if (firstImage) {
        firstImage = false;
        return new Promise(() => {});
      }
      return decode.call(this);
    };
    if (rejectable) {
      let first = true;
      LiquidGlass.init = (options) => {
        const actual = init.call(LiquidGlass, options);
        if (!first) return actual;
        first = false;
        return Promise.race([
          actual,
          new Promise<never>((_resolve, reject) => {
            rejectFirst = reject;
          }),
        ]);
      };
    }
  },
  rejectFirstInit() {
    rejectFirst?.(new Error('Delayed initialization failed'));
  },
});
